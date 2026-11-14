/**
 * Brief 049 part A, ruling 14: a forget ends every running Errand and drops every waiting result before the fresh
 * call opens. Called by the forget executor's `close` step, which runs under the barrier the fence raised, so no
 * runner can write, no delivery can claim and no Errand can start while it runs (each rechecks the barrier and the
 * epoch). What an Errand found is erased with it: its lines, its reads, its Gate inputs and its offer. Its Job is
 * settled, so nothing picks it up again.
 *
 * Review fix R12: an Errand holds what it found only while `retainUntil` is set (from its start until its result's
 * card window ends); a strip or a drop clears it. So the rows a forget must reach are exactly those with
 * `retainUntil` set (Q50), and each drop takes them out of that set: the forget drains it a bounded chunk per
 * transaction, with no cap on the total. The tick strips rows whose window has ended (`stripStaleErrands`).
 */
import { type Errand, type ID, type Job, errandWaiting, nextErrandStatus, tsFromMs } from "@franki/core";
import type { RouteContext } from "../routes/runtime";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import type { StoredDoc, StorePort, Tx } from "../store/port";

/** Errands one transaction drops at most (two writes each, under Firestore's 500). */
export const ERRANDS_DROP_CHUNK = 100;
/** Errands one tick strips at most; the rest wait for the next tick. */
export const ERRANDS_STRIP_MAX = 50;
/** A bound on the forget's drain, in chunks, so a store that never empties cannot hold the step (fails loudly). */
const DRAIN_CHUNKS_MAX = 1_000;

/** What a dropped or stripped Errand keeps of what it found: nothing. */
const BARE = { lines: [], reads: [], gate: null, offer: null, retainUntil: null } as const satisfies Partial<Errand>;

/** Q50: Errands holding anything, by `retainUntil`, soonest first. A row whose `retainUntil` is null is not listed. */
const holdingQuery = (uid: string, op: ">=" | "<=", value: string, limit: number) => ({
  collection: paths.collection(uid, "errands"),
  where: [{ field: "retainUntil", op, value }],
  orderBy: { field: "retainUntil", dir: "asc" as const },
  limit,
});

/** The first `limit` Errands that still hold anything (every one a forget must drop). */
export async function errandsToDrop(store: Pick<StorePort, "query">, uid: string, limit = ERRANDS_DROP_CHUNK): Promise<ID[]> {
  const page: StoredDoc<Errand>[] = await store.query<Errand>(uid, holdingQuery(uid, ">=", tsFromMs(0), limit));
  return page.map((r) => r.id as ID);
}

/**
 * Drops each Errand (or, one already ended, strips it bare) and settles its Job, inside the caller's transaction.
 * Reads first, then writes. Every listed row leaves the Q50 set, so a drain always progresses.
 */
export async function dropErrandsInTx(tx: Tx, uid: string, errandIds: readonly ID[], now: string): Promise<number> {
  const docs = await Promise.all(errandIds.map(async (id) => ({ errand: await tx.get<Errand>(paths.errand(uid, id)), job: await tx.get<Job>(paths.job(uid, id)) })));
  let dropped = 0;
  for (const { errand, job } of docs) {
    if (errand === null) continue;
    const next = nextErrandStatus(errand.data.status, "forget");
    tx.update(errand.path, { ...errand.data, ...BARE, status: next ?? errand.data.status, endedAt: errand.data.endedAt ?? now, updatedAt: now } satisfies Errand);
    if (job !== null && job.data.status !== "complete" && job.data.status !== "failed") tx.update(job.path, { ...job.data, status: "complete", leaseToken: null, leaseUntil: null, updatedAt: now });
    dropped++;
  }
  return dropped;
}

/**
 * Review fix T10: a disconnect drops every Errand of that owner run by one of `agentIds` that still holds anything
 * (running, waiting, or carded), as a forget does. One bounded page (`ERRANDS_DROP_CHUNK` holding rows); a row it
 * doesn't reach is still dropped by delivery's connector recheck.
 */
export async function dropErrandsOf(store: StorePort, uid: string, agentIds: readonly string[], now: string): Promise<number> {
  const page: StoredDoc<Errand>[] = await store.query<Errand>(uid, holdingQuery(uid, ">=", tsFromMs(0), ERRANDS_DROP_CHUNK));
  const ids = page.filter((r) => r.data.status !== "dropped" && r.data.agentIds.some((a) => agentIds.includes(a))).map((r) => r.id as ID);
  if (ids.length === 0) return 0;
  return store.transaction(uid, (tx) => dropErrandsInTx(tx, uid, ids, now));
}

/** Review fix R12: every Errand that holds anything, dropped a chunk per transaction, until none is left. */
export async function dropAllErrands(store: StorePort, uid: string, now: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < DRAIN_CHUNKS_MAX; i++) {
    const ids = await errandsToDrop(store, uid);
    if (ids.length === 0) return total;
    total += await store.transaction(uid, (tx) => dropErrandsInTx(tx, uid, ids, now));
  }
  throw new Error("errand drain did not empty");
}

/**
 * Review fix R12, the tick's part: Errands whose window ended are stripped bare, with no poll needed. A running one
 * is left for its runner (review fix R4 ends a stranded run); a waiting one goes `cardOnly` (it is past its five
 * minutes). Each row in its own transaction, rereading it; a lost race is left for the next tick.
 */
export async function stripStaleErrands(ctx: RouteContext): Promise<number> {
  const { uid, deps } = ctx;
  const nowTs = tsFromMs(deps.clock.read().opsClock.now);
  const page = await deps.store.query<Errand>(uid, holdingQuery(uid, "<=", nowTs, ERRANDS_STRIP_MAX));
  let stripped = 0;
  for (const r of page) {
    try {
      const done = await deps.store.transaction(uid, async (tx) => {
        const doc = await tx.get<Errand>(paths.errand(uid, r.id));
        const e = doc?.data ?? null;
        if (doc === null || e === null || e.status === "running" || e.retainUntil === null || e.retainUntil > nowTs) return false;
        const status = errandWaiting(e.status) ? (nextErrandStatus(e.status, "expired") ?? e.status) : e.status;
        tx.update(doc.path, { ...e, ...BARE, status, updatedAt: nowTs } satisfies Errand);
        return true;
      });
      if (done) stripped++;
    } catch (error) {
      if (!isStoreError(error, "staleRevision")) throw error;
    }
  }
  return stripped;
}
