/**
 * The real CallClosePort (brief 048 ruling 5): every registered call closes through the existing `hangup` Job, the
 * same Job a company hit uses. The fence's transaction makes each Session's Job due (`ensureHangupJob` requeues a
 * complete one), so a `complete` Job here is an attempt made after the fence. `close` runs one attempt when the Job
 * is due and reads its result:
 *
 *   complete              closed (every registered call confirmed hung up or gone)
 *   retry after a failure failed
 *   anything else         no answer (leased by another runner, missing, not yet due)
 *
 * Only `closed` counts, so a call that cannot be confirmed closed blocks completion. A phone call placed by
 * `make_phone_call` is not a registered browser call and is not closed here (ruling 5; listed as not built).
 */
import { type ID, type Job, msFromTs } from "@franki/core";
import { paths } from "../store/paths";
import { type HangupDeps, hangupJobId, runHangupJob } from "../worker/hangup";
import type { CallCloseAnswer, CallClosePort } from "./close-port";

export function hangupClosePort(uid: string, deps: HangupDeps, onClosed?: (sessionId: ID) => Promise<void>): CallClosePort {
  return {
    async close({ sessionId }): Promise<CallCloseAnswer> {
      const path = paths.job(uid, hangupJobId(sessionId, deps.hasher));
      let job = (await deps.store.get<Job>(uid, path))?.data;
      if (job === undefined) return undefined;
      const due = (job.status === "queued" || job.status === "retry") && msFromTs(job.nextAttemptAt) <= deps.clock.read().opsClock.now;
      if (due) {
        await runHangupJob(uid, hangupJobId(sessionId, deps.hasher), deps, onClosed);
        job = (await deps.store.get<Job>(uid, path))?.data;
      }
      if (job?.status === "complete") return "closed";
      if (job?.status === "retry" && job.attempts > 0) return "failed";
      return undefined;
    },
  };
}
