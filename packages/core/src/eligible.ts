/**
 * `eligible(x, c, s)` (contracts §4 and §7; R25; KC06). Pure: no clock, store, network or global state; identical
 * inputs give an identical ER. Invalid or missing input returns `{allow:false, reason:"ineligible"}` and never
 * throws. The clause table with implemented and unimplemented clauses is in design.md "Eligibility".
 *
 * Snapshot shape in this slice: `refs[i]` is the DocRef of `rows[i]` (the two arrays have equal length), so a
 * dependency `e:<eid>` (optionally `@<rev>`) is found by collection and ID.
 */
import { type Infer, type Schema, arr, bool, isPlainObject, nat, nullable, obj, oneOf, plainObject, str, validate } from "./schema/v";
import { Au, Cov, ID, Purpose, SC, TS, msFromTs } from "./schema/primitives";
import { CoreEpoch, Evidence, Job, Memory, Session } from "./schema/records";

export const ELIGIBILITY_STAGES = ["input", "read", "project", "commit", "toolReturn", "speech"] as const;
export const EligibilityStage = oneOf(ELIGIBILITY_STAGES);
export type EligibilityStage = Infer<typeof EligibilityStage>;

export const VERBS = ["say", "ask", "offer", "boost", "exclude", "truthWrite", "action", "card"] as const;

/** EC (contracts §4). `authorized` holds Auth rows, which this slice never creates; any entry is opaque. */
export const EC = obj({
  uid: str(128, { min: 1 }),
  epoch: nat(),
  policyRev: nat(),
  generation: nullable(nat()),
  stage: EligibilityStage,
  execution: oneOf(["browser", "serverForeground", "worker"]),
  operation: oneOf(VERBS),
  purpose: Purpose,
  worldNow: TS,
  opsNow: TS,
  asOf: nullable(TS),
  queryTargetTime: nullable(TS),
  audience: Au,
  turnId: nullable(ID),
  openedTopics: arr(ID, 16),
  authorized: arr(plainObject, 16),
  explicitRequest: bool,
  pendingId: nullable(ID),
  ownerConfirmed: bool,
  maintenanceOpId: nullable(ID),
  maintenanceTask: nullable(oneOf(["resolve", "sanitize", "purge"])),
  serviceAuthorized: bool,
  jobId: nullable(ID),
  leaseToken: nullable(ID),
  jobGeneration: nullable(nat()),
});
export type EC = Infer<typeof EC>;

export const DocRef = obj({ collection: SC, id: str(43, { min: 1 }), parentId: nullable(ID), rev: nat() });
export type DocRef = Infer<typeof DocRef>;

/** Rows this slice reads through `eligible`. */
export type Row = Memory | Evidence;
const ROW_SCHEMAS: Partial<Record<string, Schema<unknown>>> = { memories: Memory, evidence: Evidence };

export const Snapshot = obj({
  uid: str(128, { min: 1 }),
  epoch: CoreEpoch,
  session: nullable(Session),
  job: nullable(Job),
  localGeneration: nat(),
  refs: arr(DocRef, 4096),
  rows: arr(plainObject, 4096),
  blocks: arr(plainObject, 128),
  coverage: Cov,
  complete: bool,
});
export type Snapshot = Omit<Infer<typeof Snapshot>, "rows"> & { rows: Row[] };

export interface Dependent {
  ref: DocRef;
  row: Row;
}

export type EligibilityReason =
  | "ok"
  | "ineligible"
  | "tenant"
  | "barrier"
  | "dirty"
  | "time"
  | "authority"
  | "freshness"
  | "blocked"
  | "stale"
  | "flow"
  | "posture"
  | "sensitivity";

export interface ER {
  allow: boolean;
  reason: EligibilityReason;
}

const deny = (reason: EligibilityReason): ER => ({ allow: false, reason });
const OK: ER = { allow: true, reason: "ok" };

/**
 * Validation is memoized by object identity, so a Head build that checks 200 Memories against one Snapshot
 * validates the Snapshot once. The cache only skips repeated work; results are the same with or without it.
 */
const validSnapshots = new WeakSet<object>();
const validRows = new WeakSet<object>();
const validContexts = new WeakSet<object>();

function snapshotIndex(s: Snapshot): Map<string, Row> | null {
  if (!validSnapshots.has(s)) {
    if (!validate(Snapshot, s).ok || s.refs.length !== s.rows.length) return null;
    for (let i = 0; i < s.rows.length; i++) if (!rowOk(s.refs[i]!, s.rows[i])) return null;
    validSnapshots.add(s);
  }
  let index = indexes.get(s);
  if (index === undefined) {
    index = new Map();
    for (let i = 0; i < s.refs.length; i++) index.set(refKey(s.refs[i]!.collection, s.refs[i]!.id), s.rows[i]!);
    indexes.set(s, index);
  }
  return index;
}
const indexes = new WeakMap<object, Map<string, Row>>();

function rowOk(ref: DocRef, row: unknown): row is Row {
  if (!isPlainObject(row)) return false;
  if (validRows.has(row)) return true;
  const schema = ROW_SCHEMAS[ref.collection];
  if (schema === undefined || !validate(schema, row).ok) return false;
  validRows.add(row);
  return true;
}

function contextOk(c: EC): boolean {
  if (!isPlainObject(c)) return false;
  if (validContexts.has(c)) return true;
  if (!validate(EC, c).ok) return false;
  validContexts.add(c);
  return true;
}

const refKey = (collection: string, id: string) => `${collection}/${id}`;

const DEP_PREFIX: Record<string, string> = { e: "evidence", m: "memories" };

/** Parses a `dependsOn` entry `<p>:<id>[@<rev>]`. */
export function parseDep(dep: string): { collection: string; id: string; rev: number | null } | null {
  const m = /^([a-z]):([A-Za-z0-9_-]{43})(?:@(\d+))?$/.exec(dep);
  if (m === null) return null;
  const collection = DEP_PREFIX[m[1]!];
  if (collection === undefined) return null;
  return { collection, id: m[2]!, rev: m[3] === undefined ? null : Number(m[3]) };
}

const isMemory = (ref: DocRef, _row: Row): _row is Memory => ref.collection === "memories";

function rowBlocked(ref: DocRef, row: Row): boolean {
  if (isMemory(ref, row)) return row.status === "blocked";
  return (row as Evidence).status === "blocked" || (row as Evidence).status === "purged";
}

/** A dependency that is wrong or retracted (Memory) or blocked or purged (any row) denies its dependents. */
function depBlocked(ref: { collection: string }, row: Row): boolean {
  if (ref.collection === "memories") {
    const status = (row as Memory).status;
    return status === "blocked" || status === "wrong" || status === "retracted";
  }
  return (row as Evidence).status === "blocked" || (row as Evidence).status === "purged";
}

export function eligible(x: Dependent, c: EC, s: Snapshot): ER {
  try {
    if (!isPlainObject(x) || !isPlainObject(x.ref) || !validate(DocRef, x.ref).ok || !rowOk(x.ref, x.row)) return deny("ineligible");
    if (!contextOk(c)) return deny("ineligible");
    const index = snapshotIndex(s);
    if (index === null) return deny("ineligible");
    const row = x.row;

    // 1, 1b: tenant and complete snapshot.
    if (row.uid !== c.uid || s.uid !== c.uid || s.epoch.uid !== c.uid) return deny("tenant");
    if (!s.complete) return deny("freshness");

    // 2, 3: barrier. Maintenance reads that match the barrier op are still denied for speech and tool returns,
    // and every other maintenance read is denied until F4 builds resolve/sanitize/purge.
    const barrier = s.epoch.barrier;
    if (barrier !== null) return deny("barrier");

    // 5: current epoch and policyRev.
    if (c.epoch !== s.epoch.epoch || c.policyRev !== s.epoch.policyRev) return deny("freshness");
    if (row.epoch < c.epoch || row.policyRev < c.policyRev) return deny("freshness");

    // 6, 7, 8: generation checks by execution.
    if (c.execution === "browser" && c.generation !== s.localGeneration) return deny("freshness");
    if (c.execution === "serverForeground" && s.session !== null && (c.generation === null || c.generation < s.session.generation)) {
      return deny("freshness");
    }
    if (c.execution === "worker") {
      if (s.job === null || c.leaseToken === null || c.leaseToken !== s.job.leaseToken || c.jobGeneration !== s.job.generation) {
        return deny("freshness");
      }
    }

    // 9: readable revision, complete dependencies, not dirty.
    if (row.dirty || !row.dependenciesComplete) return deny("dirty");

    // 10: the row itself blocked or purged.
    if (rowBlocked(x.ref, row)) return deny("blocked");

    // 11: dependencies. An older @rev alone is provenance and passes.
    for (const dep of row.dependsOn) {
      const parsed = parseDep(dep);
      if (parsed === null) return deny("blocked");
      const target = index.get(refKey(parsed.collection, parsed.id));
      if (target === undefined || target.uid !== c.uid) return deny("blocked");
      if (target.dirty) return deny("dirty");
      if (depBlocked(parsed, target)) return deny("blocked");
    }

    // 13: validForPurpose, partial: validFrom <= worldNow < validTo for Memories (asOf/queryTargetTime in F6).
    if (isMemory(x.ref, row)) {
      const world = msFromTs(c.worldNow);
      if (row.validFrom !== null && msFromTs(row.validFrom) > world) return deny("time");
      if (row.validTo !== null && world >= msFromTs(row.validTo)) return deny("time");
      // 14: authority, partial: speech and project need class U, C or O.
      if ((c.stage === "speech" || c.stage === "project") && !["U", "C", "O"].includes(row.sourceClass)) return deny("authority");
    }
    return OK;
  } catch {
    return deny("ineligible");
  }
}

/** The DocRef of a Memory or Evidence document. */
export function docRef(collection: "memories" | "evidence", id: string, rev: number): DocRef {
  return { collection, id, parentId: null, rev };
}
