/**
 * Brief 049 part A, ruling 14: a forget ends every running Errand and drops every waiting result before the fresh
 * call opens. Called by the forget executor's `close` step, which runs under the barrier the fence raised, so no
 * runner can write and no delivery can claim while it runs (each rechecks the barrier and the epoch). What an Errand
 * found is erased with it: its lines and its reads. Its Job is settled, so nothing picks it up again.
 *
 * Errands are read outside the step's transaction and each is reread inside it.
 */
import { type Errand, type ID, type Job, nextErrandStatus } from "@franki/core";
import { paths } from "../store/paths";
import type { StoredDoc, StorePort, Tx } from "../store/port";

/** At most this many Errands one forget drops in its one transaction (two writes each, under Firestore's 500). */
export const ERRANDS_DROP_MAX = 200;

/**
 * The owner's Errands that a forget must drop (every status but `dropped`), paged by document ID (Q28), so a result
 * left from long ago is found too. Past `ERRANDS_DROP_MAX` the rest wait for the next forget (contract question
 * E-266); every forget erases what it drops, so they never pile up.
 */
export async function errandsToDrop(store: Pick<StorePort, "query">, uid: string): Promise<ID[]> {
  const out: ID[] = [];
  let after: string | null = null;
  for (;;) {
    const page: StoredDoc<Errand>[] = await store.query<Errand>(uid, {
      collection: paths.collection(uid, "errands"),
      where: after === null ? [] : [{ field: "__name__", op: ">", value: after }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: 100,
    });
    for (const r of page) if (r.data.status !== "dropped" && out.length < ERRANDS_DROP_MAX) out.push(r.id as ID);
    if (page.length < 100 || out.length >= ERRANDS_DROP_MAX) return out;
    after = page[page.length - 1]!.id;
  }
}

/** Drops each Errand and settles its Job, inside the caller's transaction. Reads first, then writes. */
export async function dropErrandsInTx(tx: Tx, uid: string, errandIds: readonly ID[], now: string): Promise<number> {
  const docs = await Promise.all(errandIds.map(async (id) => ({ errand: await tx.get<Errand>(paths.errand(uid, id)), job: await tx.get<Job>(paths.job(uid, id)) })));
  let dropped = 0;
  for (const { errand, job } of docs) {
    if (errand === null || nextErrandStatus(errand.data.status, "forget") === null) continue;
    tx.update(errand.path, { ...errand.data, status: "dropped", lines: [], reads: [], endedAt: errand.data.endedAt ?? now, updatedAt: now } satisfies Errand);
    if (job !== null && job.data.status !== "complete" && job.data.status !== "failed") tx.update(job.path, { ...job.data, status: "complete", leaseToken: null, leaseUntil: null, updatedAt: now });
    dropped++;
  }
  return dropped;
}
