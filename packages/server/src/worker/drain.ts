/**
 * Extract drain (design "Extraction worker", "Draining"). Runs the Owner's due `queued` and `retry` Extract_Jobs
 * one after another (the sequential floor), using the Q17 shape filtered to `kind:"extract"`. While jobs are leased
 * elsewhere it polls every 100 ms until they finish, or until their lease expires and it requeues them (Q18).
 * It has no wait limit of its own: session open races it against 3,000 ms, and close and /api/turn schedule it.
 */
import { type Job, tsFromMs } from "@franki/core";
import { liveTimers } from "../clock/timers";
import type { RouteDeps } from "../routes/runtime";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import { runExtractJob } from "./extract";
import { dueJobs } from "./jobs";

export const DRAIN_POLL_MS = 100;
/** Jobs one drain call runs at most; the next drain picks up the rest. */
const DRAIN_MAX_JOBS = 50;

type DrainDeps = Pick<RouteDeps, "store" | "openai" | "clock" | "hasher" | "env"> & Partial<Pick<RouteDeps, "timers">>;

async function leasedExtractJobs(deps: DrainDeps, uid: string): Promise<{ id: string; expired: boolean }[]> {
  const now = tsFromMs(deps.clock.read().opsClock.now);
  const rows = await deps.store.query<Job>(uid, {
    collection: paths.collection(uid, "jobs"),
    where: [{ field: "status", op: "==", value: "leased" }],
    orderBy: { field: "leaseUntil", dir: "asc" },
    limit: 100,
  });
  return rows.filter((r) => r.data.kind === "extract").map((r) => ({ id: r.id, expired: r.data.leaseUntil !== null && r.data.leaseUntil <= now }));
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
  for (;;) {
    const due = await dueJobs(deps.store, uid, deps.clock.read().opsClock.now, "extract");
    for (const jobId of due) {
      if (ran >= DRAIN_MAX_JOBS) return;
      ran++;
      try {
        await runExtractJob(uid, jobId, { ...deps, timers });
      } catch (error) {
        // Another drain claimed or committed the same job first; it carries on there.
        if (!isStoreError(error, "staleRevision")) throw error;
      }
    }
    const leased = await leasedExtractJobs(deps, uid);
    if (leased.length === 0 && due.length === 0) return;
    for (const job of leased) if (job.expired) await requeue(deps, uid, job.id);
    if (due.length === 0) await timers.sleep(DRAIN_POLL_MS);
  }
}
