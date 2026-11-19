/**
 * Brief 049 part A: an Errand's IDs, its Job and the reads every errand path shares. One Errand per Turn that asked
 * (ruling 3): its ID is a hash of the Session and the Turn, and its Job has the same ID.
 */
import { type Errand, type Hasher, type ID, type Job, tsFromMs } from "@franki/core";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { Reader, StoredDoc } from "../store/port";

export const errandIdOf = (hasher: Hasher, sessionId: string, turnId: string): ID => hasher.id(["errand", sessionId, turnId]) as ID;
/**
 * The delivery's decision row: one per offer of an Errand, so a second claim of the same attempt finds it (ruling 9;
 * review fix V2: a result is offered again, as attempt n + 1, only after attempt n expired with no receipt).
 */
export const errandDeliveryId = (hasher: Hasher, errandId: string, attempt = 1): ID => hasher.id(["ledger", "errandDelivery", errandId, String(attempt)]) as ID;
export const errandLedgerId = (hasher: Hasher, errandId: string): ID => hasher.id(["ledger", "errand", errandId]) as ID;

/** The most recent Errands one read looks at: more than any Session runs and keeps on screen at once. */
export const ERRANDS_READ_MAX = 12;

/** The owner's most recent Errands, newest first: one query, ordered by a single field (no composite index). */
export async function recentErrands(reader: Pick<Reader, "query">, uid: string): Promise<StoredDoc<Errand>[]> {
  return reader.query<Errand>({ collection: paths.collection(uid, "errands"), where: [], orderBy: { field: "startedAt", dir: "desc" }, limit: ERRANDS_READ_MAX });
}

/**
 * The owner's running Errands (ruling 7's count): the most recent ones, filtered in code, so no composite index is
 * needed. A run lasts at most `ERRAND_RUN_SPAN_MS` over at most two claims, so a running Errand is always among them.
 */
export async function runningErrands(reader: Pick<Reader, "query">, uid: string): Promise<StoredDoc<Errand>[]> {
  return (await recentErrands(reader, uid)).filter((r) => r.data.status === "running");
}

/** The Job that runs an Errand (ruling 4): due now, leased by the runner, at most `ERRAND_RUNS_MAX` claims. */
export function errandJob(x: { uid: string; errandId: ID; sessionId: ID; turnId: ID; opsNow: number; epoch: number; policyRev: number }): Job {
  const now = tsFromMs(x.opsNow);
  return {
    ...cFields(x.uid, now, x.epoch, x.policyRev),
    kind: "errand",
    status: "queued",
    priority: "interactive",
    nextAttemptAt: now,
    leaseUntil: null,
    leaseToken: null,
    generation: 0,
    attempts: 0,
    sourceIds: [x.errandId, x.sessionId, x.turnId],
    inputRevs: [],
    connectorId: null,
    syncGeneration: null,
    payload: {
      kind: "work",
      task: "errand",
      targets: [],
      class: null,
      fields: [],
      cursor: { fieldIndex: 0, offset: 0, afterId: null, leg: "exact" },
      query: null,
    },
    resultRefs: [],
    error: null,
    retainUntil: null,
  };
}

export const errandPath = (uid: string, errandId: string) => paths.errand(uid, errandId);
