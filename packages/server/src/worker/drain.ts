/**
 * Extract drain (design "Extraction worker", "Draining"). Runs the Owner's due `queued` and `retry` Extract_Jobs
 * one after another (the sequential floor), using the Q17 shape filtered to `kind:"extract"`. It starts none while
 * one is leased elsewhere: it polls until that job finishes, or until its lease expires and it requeues it (Q18).
 * Polls start 100 ms apart and double to 1 s, and never wait past the earliest lease expiry.
 * It has no wait limit of its own: session open races it against what is left of its budget, and close and
 * /api/turn schedule it.
 */
import { type Job, msFromTs, tsFromMs } from "@franki/core";
import { liveTimers } from "../clock/timers";
import type { RouteDeps } from "../routes/runtime";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import { runExtractJob } from "./extract";
import { dueJobs } from "./jobs";

/** First wait for a job leased elsewhere, short so session open's drain race sees a job that finishes soon. */
export const DRAIN_POLL_MS = 100;
/** Longest wait: a worker that died holding a 75 s extract lease costs one poll (3 queries) a second, not ten. */
export const DRAIN_POLL_MAX_MS = 1_000;
/** Jobs one drain call runs at most; the next drain picks up the rest. */
const DRAIN_MAX_JOBS = 50;

type DrainDeps = Pick<RouteDeps, "store" | "openai" | "clock" | "hasher" | "env"> & Partial<Pick<RouteDeps, "timers" | "log">>;

async function leasedExtractJobs(deps: DrainDeps, uid: string): Promise<{ id: string; expired: boolean; leaseUntil: number }[]> {
  const now = tsFromMs(deps.clock.read().opsClock.now);
  const rows = await deps.store.query<Job>(uid, {
    collection: paths.collection(uid, "jobs"),
    where: [{ field: "status", op: "==", value: "leased" }],
    orderBy: { field: "leaseUntil", dir: "asc" },
    limit: 100,
  });
  return rows
    .filter((r) => r.data.kind === "extract")
    .map((r) => ({
      id: r.id,
      expired: r.data.leaseUntil !== null && r.data.leaseUntil <= now,
      leaseUntil: r.data.leaseUntil === null ? Number.POSITIVE_INFINITY : msFromTs(r.data.leaseUntil),
    }));
}

async function requeue(deps: DrainDeps, uid: string, jobId: string): Promise<void> {
  const now = tsFromMs(deps.clock.read().opsClock.now);
  await deps.store
    .transaction(uid, async (tx) => {
      const doc = await tx.get<Job>(paths.job(uid, jobId));
      if (doc === null || doc.data.status !== "leased" || doc.data.leaseUntil === null || doc.data.leaseUntil > now) return;
      tx.update(doc.path, { ...doc.data, status: "retry", leaseToken: null, leaseUntil: null, nextAttemptAt: now, updatedAt: now });
    })
    .catch((error: unknown) => {
      if (!isStoreError(error, "staleRevision")) throw error;
    });
}

export async function drainExtractJobs(uid: string, deps: DrainDeps): Promise<void> {
  const timers = deps.timers ?? liveTimers;
  let ran = 0;
  let poll = DRAIN_POLL_MS;
  for (;;) {
    const leased = await leasedExtractJobs(deps, uid);
    for (const job of leased) if (job.expired) await requeue(deps, uid, job.id);
    const running = leased.filter((j) => !j.expired);
    if (running.length > 0) {
      // One Extract_Job at a time for an Owner, even across drains (each turn schedules one). A turn's packet reads
      // the Memories the turns before it wrote, so a correction said while the fact's job is still running elsewhere
      // waits for that job instead of missing what it corrects. At most until the earliest lease expires, and no wait
      // after a requeue: a dead worker's job runs on time.
      const untilExpiry = Math.min(...running.map((j) => j.leaseUntil)) - deps.clock.read().opsClock.now;
      await timers.sleep(Math.max(0, Math.min(poll, untilExpiry)));
      poll = Math.min(2 * poll, DRAIN_POLL_MAX_MS);
      continue;
    }
    poll = DRAIN_POLL_MS;
    const [next] = await dueJobs(deps.store, uid, deps.clock.read().opsClock.now, "extract");
    if (next === undefined || ran >= DRAIN_MAX_JOBS) return;
    ran++;
    try {
      await runExtractJob(uid, next, { ...deps, timers });
    } catch (error) {
      // The attempt's commit lost a race (a lost claim is a skip, not an error): whoever took the job carries on,
      // or the job is requeued once its lease expires.
      if (!isStoreError(error, "staleRevision")) throw error;
    }
  }
}
