/**
 * Firestore_Store: the Store_Port on the Firebase Admin SDK (R7.6, R7.7). Records live under `users/{uid}` with the
 * contracts §1 collection names. Same semantics as the Memory_Store, checked by the shared conformance suite on
 * the emulator (CI). Transactions run with `maxAttempts: 1`, so neither store retries; contention is staleRevision.
 */
import type { Evidence, Hasher, Memory } from "@franki/core";
import { FieldPath, type Firestore, type Query, type Transaction } from "firebase-admin/firestore";
import { checkImmutable, checkRecord, lineageFailures, throwOnLineage } from "./checks";
import { StoreError, isStoreError } from "./errors";
import { checkQuerySpec } from "./memory-store";
import { type ParsedPath, parseDocPath } from "./paths";
import type { QuerySpec, StoredDoc, StorePort, Tx } from "./port";

type Data = Record<string, unknown>;

interface PendingWrite {
  parsed: ParsedPath;
  kind: "create" | "update";
  record: Data;
  expectRev: number | undefined;
}

/** gRPC codes the store maps: ABORTED (contention) and ALREADY_EXISTS become staleRevision. */
const ABORTED = 10;
const ALREADY_EXISTS = 6;

function mapError(error: unknown): unknown {
  if (isStoreError(error)) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === ABORTED || code === ALREADY_EXISTS) return new StoreError("staleRevision", "transaction contention or existing record");
  return error;
}

export class FirestoreStore implements StorePort {
  constructor(
    private readonly db: Firestore,
    private readonly hasher: Hasher,
  ) {}

  private buildQuery(uid: string, spec: QuerySpec): Query {
    checkQuerySpec(uid, spec);
    let q: Query = this.db.collection(spec.collection);
    for (const f of spec.where) q = q.where(f.field === "__name__" ? FieldPath.documentId() : f.field, f.op, f.value);
    q = q.orderBy(spec.orderBy.field === "__name__" ? FieldPath.documentId() : spec.orderBy.field, spec.orderBy.dir);
    return q.limit(spec.limit);
  }

  async get<T = Data>(uid: string, path: string): Promise<StoredDoc<T> | null> {
    const p = parseDocPath(uid, path);
    const snap = await this.db.doc(path).get();
    return snap.exists ? { path, id: p.id, data: snap.data() as T } : null;
  }

  async query<T = Data>(uid: string, spec: QuerySpec): Promise<StoredDoc<T>[]> {
    const snap = await this.buildQuery(uid, spec).get();
    return snap.docs.map((d) => ({ path: d.ref.path, id: d.id, data: d.data() as T }));
  }

  async transaction<R>(uid: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
    try {
      return await this.db.runTransaction((t) => this.runOnce(uid, t, fn), { maxAttempts: 1 });
    } catch (error) {
      throw mapError(error);
    }
  }

  private async runOnce<R>(uid: string, t: Transaction, fn: (tx: Tx) => Promise<R>): Promise<R> {
    const reads = new Map<string, number | null>();
    let rereadConflict: string | null = null;
    const writes = new Map<string, PendingWrite>();
    const observe = (path: string, rev: number | null) => {
      if (!reads.has(path)) reads.set(path, rev);
      else if (reads.get(path) !== rev) rereadConflict ??= path;
    };

    const tx: Tx = {
      get: async <T>(path: string) => {
        const p = parseDocPath(uid, path);
        const snap = await t.get(this.db.doc(path));
        const data = snap.exists ? (snap.data() as Data) : undefined;
        observe(path, data === undefined ? null : (data.rev as number));
        return data === undefined ? null : ({ path, id: p.id, data: data as T } satisfies StoredDoc<T>);
      },
      query: async <T>(spec: QuerySpec) => {
        const snap = await t.get(this.buildQuery(uid, spec));
        const rows = snap.docs.map((d) => ({ path: d.ref.path, id: d.id, data: d.data() as T }));
        for (const r of rows) observe(r.path, (r.data as Data).rev as number);
        return rows;
      },
      create: (path, record) => {
        const parsed = parseDocPath(uid, path);
        if (writes.has(path)) throw new StoreError("invalidInput", "record written twice in one transaction", path);
        writes.set(path, { parsed, kind: "create", record: structuredClone(record as Data), expectRev: undefined });
      },
      update: (path, record, expectRev) => {
        const parsed = parseDocPath(uid, path);
        if (writes.has(path)) throw new StoreError("invalidInput", "record written twice in one transaction", path);
        if (expectRev === undefined && !reads.has(path)) {
          throw new StoreError("invalidInput", "update needs a read in this transaction or an expected rev", path);
        }
        writes.set(path, { parsed, kind: "update", record: structuredClone(record as Data), expectRev });
      },
    };

    const result = await fn(tx);

    for (const w of writes.values()) checkRecord(uid, w.parsed, { ...w.record, rev: 1 });

    // Every remaining read happens before the first write, as Firestore transactions require.
    const current = new Map<string, Data | undefined>();
    for (const w of writes.values()) {
      const snap = await t.get(this.db.doc(w.parsed.path));
      current.set(w.parsed.path, snap.exists ? (snap.data() as Data) : undefined);
    }
    for (const w of writes.values()) {
      if (w.parsed.collection !== "memories") continue;
      const failures = await lineageFailures(
        w.record as unknown as Memory,
        async (eid) => {
          const path = `users/${uid}/evidence/${eid}`;
          const pending = writes.get(path);
          if (pending !== undefined) return pending.record as unknown as Evidence;
          const snap = await t.get(this.db.doc(path));
          return snap.exists ? (snap.data() as Evidence) : null;
        },
        this.hasher,
      );
      throwOnLineage(w.parsed.path, failures);
    }

    if (rereadConflict !== null) throw new StoreError("staleRevision", "record changed between two reads", rereadConflict);
    const finals: [PendingWrite, Data][] = [];
    for (const w of writes.values()) {
      const now = current.get(w.parsed.path);
      let rev: number;
      if (w.kind === "create") {
        if (now !== undefined) throw new StoreError("staleRevision", "record already exists", w.parsed.path);
        rev = 1;
      } else {
        if (now === undefined) throw new StoreError("staleRevision", "record does not exist", w.parsed.path);
        if (w.expectRev !== undefined && w.expectRev !== now.rev) throw new StoreError("staleRevision", "expected rev does not match", w.parsed.path);
        if (reads.has(w.parsed.path) && reads.get(w.parsed.path) !== now.rev) {
          throw new StoreError("staleRevision", "record changed since it was read", w.parsed.path);
        }
        rev = (now.rev as number) + 1;
      }
      const final = { ...w.record, rev };
      checkRecord(uid, w.parsed, final);
      if (now !== undefined) checkImmutable(w.parsed, now, final);
      finals.push([w, final]);
    }
    for (const [w, final] of finals) {
      const ref = this.db.doc(w.parsed.path);
      if (w.kind === "create") t.create(ref, final);
      else t.set(ref, final);
    }
    return result;
  }
}
