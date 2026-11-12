/**
 * Head build at session open (R11.4, R26; design "Session open" step 3). Reads every Memory through Q28 pages
 * and the Evidence their `dependsOn` names, inside the caller's transaction, then runs the pure `compileHead`.
 */
import {
  type Au,
  type ClockPair,
  type CoreEpoch,
  type CoreRules,
  type DocRef,
  type EC,
  type Evidence,
  type HeadMemory,
  type HeadResult,
  type ID,
  type Memory,
  type Row,
  type Snapshot,
  compileHead,
  parseDep,
  tsFromMs,
} from "@franki/core";
import { forgetRowsFor } from "./forget/snapshot-rows";
import { paths } from "./store/paths";
import type { StorePort, Tx } from "./store/port";

type Reader = Pick<Tx, "query" | "get">;

const EVIDENCE_READ_BATCH = 16;

/** Every Memory of the Owner, in document-ID order, through Q28 pages of 100. */
export async function readAllMemories(reader: Reader, uid: string): Promise<HeadMemory[]> {
  const out: HeadMemory[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { id: string; data: Memory }[] = await reader.query<Memory>({
      collection: paths.collection(uid, "memories"),
      where: cursor === null ? [] : [{ field: "__name__", op: ">", value: cursor }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: 100,
    });
    out.push(...page.map((d) => ({ id: d.id, memory: d.data })));
    if (page.length < 100) return out;
    cursor = page[page.length - 1]!.id;
  }
}

/** A Reader over the Store_Port outside a transaction. */
export const storeReader = (store: StorePort, uid: string): Reader => ({
  get: (path) => store.get(uid, path),
  query: (spec) => store.query(uid, spec),
});

/** Builds the Snapshot for a set of Memories: the Memories plus each Evidence a dependsOn entry names. */
export async function snapshotFor(
  reader: Reader,
  uid: string,
  memories: readonly HeadMemory[],
  epoch: CoreEpoch,
  generation: number,
): Promise<Snapshot> {
  const refs: DocRef[] = [];
  const rows: Row[] = [];
  for (const m of memories) {
    refs.push({ collection: "memories", id: m.id, parentId: null, rev: m.memory.rev });
    rows.push(m.memory);
  }
  const eids = new Set<ID>();
  for (const m of memories) for (const d of m.memory.dependsOn) {
    const p = parseDep(d);
    if (p?.collection === "evidence") eids.add(p.id);
  }
  // Reads in parallel batches: one sequential read per Evidence cost ~100 ms each from a laptop to us-central1,
  // which used up the recall tool's time before its reader started. Order stays sorted by eid.
  const sorted = [...eids].sort();
  for (let i = 0; i < sorted.length; i += EVIDENCE_READ_BATCH) {
    const batch = sorted.slice(i, i + EVIDENCE_READ_BATCH);
    const docs = await Promise.all(batch.map((eid) => reader.get<Evidence>(paths.evidence(uid, eid))));
    docs.forEach((doc, j) => {
      if (doc === null) return;
      refs.push({ collection: "evidence", id: batch[j]!, parentId: null, rev: doc.data.rev });
      rows.push(doc.data);
    });
  }
  // Review 028 finding 3: the owner's forget blocks and overlays, so `eligible` denies what they name.
  const forget = await forgetRowsFor(reader, uid);
  const allRefs = [...refs, ...forget.refs];
  const allRows = [...rows, ...forget.rows];
  return {
    uid,
    epoch,
    session: null,
    job: null,
    localGeneration: generation,
    refs: allRefs.slice(0, 4096),
    rows: allRows.slice(0, 4096),
    blocks: forget.blocks,
    coverage: { state: "complete", from: null, to: null, missingRanges: [], generation: 0 },
    complete: allRefs.length <= 4096 && forget.complete,
  };
}

/** The server-foreground EC for a Head build or recall read. */
export function foregroundEC(uid: string, epoch: CoreEpoch, clock: ClockPair, generation: number): EC {
  return {
    uid,
    epoch: epoch.epoch,
    policyRev: epoch.policyRev,
    generation,
    stage: "project",
    execution: "serverForeground",
    operation: "say",
    purpose: "answer",
    worldNow: tsFromMs(clock.worldClock.now),
    opsNow: tsFromMs(clock.opsClock.now),
    asOf: null,
    queryTargetTime: null,
    audience: "private",
    turnId: null,
    openedTopics: [],
    authorized: [],
    explicitRequest: false,
    pendingId: null,
    ownerConfirmed: false,
    maintenanceOpId: null,
    maintenanceTask: null,
    serviceAuthorized: false,
    jobId: null,
    leaseToken: null,
    jobGeneration: null,
  };
}

export async function buildHead(
  reader: Reader,
  uid: string,
  core: { epoch: CoreEpoch; rules: CoreRules },
  clock: ClockPair,
  generation: number,
  /** Who may hear the call (task 45); private when absent, which compiles exactly as before. */
  audience?: Au,
): Promise<HeadResult> {
  const memories = await readAllMemories(reader, uid);
  const snapshot = await snapshotFor(reader, uid, memories, core.epoch, generation);
  return compileHead({ memories, ec: foregroundEC(uid, core.epoch, clock, generation), snapshot, rules: core.rules, clock, ...(audience === undefined ? {} : { audience }) });
}
