/**
 * Memory_Store: the in-memory Store_Port used by every unit and property test (R7.2, R7.3, R7.9).
 * Commits are atomic because the final check-and-apply phase runs with no `await` in it.
 */
import type { Evidence, Hasher, Memory } from "@franki/core";
import { checkImmutable, checkRecord, lineageFailures, throwOnLineage } from "./checks";
import { StoreError } from "./errors";
import { matchQueryShape } from "./indexes";
import { type ParsedPath, parseCollectionPath, parseDocPath } from "./paths";
import { type FieldValue, MAX_QUERY_LIMIT, type QuerySpec, type Reader, type StoredDoc, type StorePort, type Tx } from "./port";

type Data = Record<string, unknown>;

interface PendingWrite {
  parsed: ParsedPath;
  kind: "create" | "update";
  record: Data;
  expectRev: number | undefined;
}

const clone = <T>(v: T): T => structuredClone(v);

function typeRank(v: unknown): number {
  if (v === null) return 0;
  if (typeof v === "boolean") return 1;
  if (typeof v === "number") return 2;
  if (typeof v === "string") return 3;
  return 4;
}

/** Firestore value order for the field types this slice queries: null < boolean < number < string. */
export function compareValues(a: unknown, b: unknown): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (a === b) return 0;
  if (typeof a === "boolean") return a ? 1 : -1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

function matches(value: unknown, op: QuerySpec["where"][number]["op"], target: FieldValue): boolean {
  if (op === "==") return typeRank(value) === typeRank(target) && compareValues(value, target) === 0;
  // Range filters only match values of the same type, as in Firestore.
  if (typeRank(value) !== typeRank(target) || value === null) return false;
  const c = compareValues(value, target);
  switch (op) {
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    case ">=":
      return c >= 0;
  }
}

export function checkQuerySpec(uid: string, spec: QuerySpec) {
  const parsed = parseCollectionPath(uid, spec.collection);
  if (!Number.isSafeInteger(spec.limit) || spec.limit < 1 || spec.limit > MAX_QUERY_LIMIT) {
    throw new StoreError("invalidInput", `query limit must be 1 to ${MAX_QUERY_LIMIT}`, spec.collection);
  }
  const shape = matchQueryShape(parsed.collection, spec);
  if (shape === null) throw new StoreError("invalidInput", "query shape has no declared index", spec.collection);
  return { parsed, shape };
}

export class MemoryStore implements StorePort {
  private readonly docs = new Map<string, Data>();

  constructor(private readonly hasher: Hasher) {}

  async get<T = Data>(uid: string, path: string): Promise<StoredDoc<T> | null> {
    const p = parseDocPath(uid, path);
    const d = this.docs.get(path);
    return d === undefined ? null : { path, id: p.id, data: clone(d) as T };
  }

  async query<T = Data>(uid: string, spec: QuerySpec): Promise<StoredDoc<T>[]> {
    return this.runQuery(uid, spec) as StoredDoc<T>[];
  }

  /** Plain reads: the Memory_Store holds no locks, so they never block a transaction either. */
  async snapshot<R>(uid: string, fn: (reader: Reader) => Promise<R>): Promise<R> {
    return fn({ get: <T>(path: string) => this.get<T>(uid, path), query: <T>(spec: QuerySpec) => this.query<T>(uid, spec) });
  }

  private runQuery(uid: string, spec: QuerySpec): StoredDoc[] {
    checkQuerySpec(uid, spec);
    const prefix = `${spec.collection}/`;
    const rows: StoredDoc[] = [];
    for (const [path, data] of this.docs) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) continue;
      const id = path.slice(prefix.length);
      const valueOf = (field: string) => (field === "__name__" ? id : data[field]);
      if (valueOf(spec.orderBy.field) === undefined) continue;
      if (spec.where.every((f) => valueOf(f.field) !== undefined && matches(valueOf(f.field), f.op, f.value))) {
        rows.push({ path, id, data });
      }
    }
    const sign = spec.orderBy.dir === "asc" ? 1 : -1;
    const field = spec.orderBy.field;
    rows.sort((a, b) => {
      const va = field === "__name__" ? a.id : a.data[field];
      const vb = field === "__name__" ? b.id : b.data[field];
      return sign * (compareValues(va, vb) || compareValues(a.id, b.id));
    });
    return rows.slice(0, spec.limit).map((r) => ({ path: r.path, id: r.id, data: clone(r.data) }));
  }

  async transaction<R>(uid: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
    const reads = new Map<string, number | null>();
    let rereadConflict: string | null = null;
    const writes = new Map<string, PendingWrite>();

    const observe = (path: string, rev: number | null) => {
      if (!reads.has(path)) reads.set(path, rev);
      else if (reads.get(path) !== rev) rereadConflict ??= path;
    };
    const revOf = (d: Data | undefined) => (d === undefined ? null : (d.rev as number));

    const tx: Tx = {
      get: async <T>(path: string) => {
        const p = parseDocPath(uid, path);
        const d = this.docs.get(path);
        observe(path, revOf(d));
        return d === undefined ? null : ({ path, id: p.id, data: clone(d) as T } satisfies StoredDoc<T>);
      },
      query: async <T>(spec: QuerySpec) => {
        const rows = this.runQuery(uid, spec);
        for (const r of rows) observe(r.path, r.data.rev as number);
        return rows as StoredDoc<T>[];
      },
      create: (path, record) => {
        const parsed = parseDocPath(uid, path);
        if (writes.has(path)) throw new StoreError("invalidInput", "record written twice in one transaction", path);
        writes.set(path, { parsed, kind: "create", record: clone(record as Data), expectRev: undefined });
      },
      update: (path, record, expectRev) => {
        const parsed = parseDocPath(uid, path);
        if (writes.has(path)) throw new StoreError("invalidInput", "record written twice in one transaction", path);
        if (expectRev === undefined && !reads.has(path)) {
          throw new StoreError("invalidInput", "update needs a read in this transaction or an expected rev", path);
        }
        writes.set(path, { parsed, kind: "update", record: clone(record as Data), expectRev });
      },
    };

    const result = await fn(tx);

    // Schema, size and tenant checks; `rev` is set at apply, and any rev >= 1 validates the same way.
    for (const w of writes.values()) checkRecord(uid, w.parsed, { ...w.record, rev: 1 });
    // Async checks next. Evidence is never deleted or edited in place, so these stay valid until apply.
    for (const w of writes.values()) {
      if (w.parsed.collection !== "memories") continue;
      const failures = await lineageFailures(w.record as unknown as Memory, async (eid) => this.evidenceFor(uid, eid, writes), this.hasher);
      throwOnLineage(w.parsed.path, failures);
    }

    // Final phase: no awaits from here to the end, so check-and-apply is atomic.
    if (rereadConflict !== null) throw new StoreError("staleRevision", "record changed between two reads", rereadConflict);
    for (const [path, observed] of reads) {
      if (revOf(this.docs.get(path)) !== observed) throw new StoreError("staleRevision", "record changed since it was read", path);
    }
    const finals: [string, Data][] = [];
    for (const w of writes.values()) {
      const current = this.docs.get(w.parsed.path);
      let rev: number;
      if (w.kind === "create") {
        if (current !== undefined) throw new StoreError("staleRevision", "record already exists", w.parsed.path);
        rev = 1;
      } else {
        if (current === undefined) throw new StoreError("staleRevision", "record does not exist", w.parsed.path);
        const expected = reads.has(w.parsed.path) ? reads.get(w.parsed.path) : w.expectRev;
        if (w.expectRev !== undefined && w.expectRev !== current.rev) {
          throw new StoreError("staleRevision", "expected rev does not match", w.parsed.path);
        }
        if (expected !== current.rev) throw new StoreError("staleRevision", "record changed since it was read", w.parsed.path);
        rev = (current.rev as number) + 1;
      }
      const final = { ...w.record, rev };
      checkRecord(uid, w.parsed, final);
      if (current !== undefined) checkImmutable(w.parsed, current, final);
      finals.push([w.parsed.path, final]);
    }
    for (const [path, data] of finals) this.docs.set(path, data);
    return result;
  }

  private evidenceFor(uid: string, eid: string, writes: Map<string, PendingWrite>): Evidence | null {
    const path = `users/${uid}/evidence/${eid}`;
    const pending = writes.get(path);
    if (pending !== undefined) return pending.record as unknown as Evidence;
    const stored = this.docs.get(path);
    return stored === undefined ? null : (stored as unknown as Evidence);
  }

  /** Test helper: number of stored records under a collection path. */
  countUnder(collectionPath: string): number {
    let n = 0;
    for (const path of this.docs.keys()) if (parentOfPath(path) === collectionPath) n++;
    return n;
  }
}

function parentOfPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}
