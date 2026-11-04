/**
 * Hangups and the durable `hangup` Job (R11.3, R14.2, R14.3; KS07; design "Close").
 *
 * `hangupAll` hangs up call IDs in parallel within a budget; an outcome still unknown at the budget counts as a
 * failure. A failure writes one `hangup` Job for the Session (ID `H("job","hangup",sessionId)`). The job retries
 * with backoff 1, 2, 5, 10 s and then every 60 s, and never becomes `complete` until every registered call ID is
 * confirmed hung up or gone; then a `closing` Session becomes `closed` with `closedAt`.
 */
import { type CoreEpoch, type Hasher, type ID, type Job, type Session, idParts, tsFromMs } from "@franki/core";
import { type Timers, raceLimit, withDeadline } from "../clock/timers";
import type { OpenAIPort } from "../openai/fake";
import { hangupCall } from "../openai/realtime-calls";
import { paths } from "../store/paths";
import type { StorePort, Tx } from "../store/port";
import { claimJob, workJob } from "./jobs";

export const HANGUP_BACKOFF_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000];
export const HANGUP_STEADY_MS = 60_000;
/** Per-call deadline inside a job attempt; well under the 30 s lease. */
export const JOB_HANGUP_DEADLINE_MS = 5_000;

/** Delay before the next attempt, given the attempts made so far (1-based). */
export function hangupBackoff(attempts: number): number {
  return HANGUP_BACKOFF_MS[attempts - 1] ?? HANGUP_STEADY_MS;
}

export interface HangupDeps {
  store: StorePort;
  openai: OpenAIPort;
  hasher: Hasher;
  timers: Timers;
  clock: { read(): { opsClock: { now: number } } };
}

/** True only when every call is confirmed hung up or gone within `budgetMs`. */
export async function hangupAll(callIds: readonly string[], deps: Pick<HangupDeps, "openai" | "timers">, budgetMs: number): Promise<boolean> {
  if (callIds.length === 0) return true;
  let allOk = true;
  const work = Promise.all(
    callIds.map((id) =>
      hangupCall(deps.openai, id).catch(() => {
        allOk = false;
      }),
    ),
  );
  const finished = await raceLimit(work, budgetMs, deps.timers);
  return finished && allOk;
}

export const hangupJobId = (sessionId: ID, hasher: Hasher): ID => hasher.id(idParts.hangupJob(sessionId));

/** Writes (or re-queues) the Session's `hangup` Job inside a transaction. */
export async function ensureHangupJob(tx: Tx, uid: string, sessionId: ID, sessionRev: number, now: number, hasher: Hasher): Promise<ID> {
  const jobId = hangupJobId(sessionId, hasher);
  const existing = await tx.get<Job>(paths.job(uid, jobId));
  if (existing === null) {
    const epoch = await tx.get<CoreEpoch>(paths.core(uid, "epoch"));
    tx.create(
      paths.job(uid, jobId),
      workJob({
        uid,
        kind: "hangup",
        now,
        epoch: epoch?.data.epoch ?? 1,
        policyRev: epoch?.data.policyRev ?? 1,
        sourceIds: [sessionId],
        inputRevs: [{ id: sessionId, rev: sessionRev }],
        targets: [{ type: "session", id: sessionId, rev: sessionRev }],
        class: null,
        fields: [],
        priority: "control",
      }),
    );
  } else if (existing.data.status === "complete") {
    tx.update(existing.path, { ...existing.data, status: "queued", nextAttemptAt: tsFromMs(now), updatedAt: tsFromMs(now) });
  }
  return jobId;
}

export type HangupJobResult = "complete" | "retry" | "skipped";

/** Runs one attempt of a `hangup` Job. `onClosed` runs when this attempt moves the Session to `closed`. */
export async function runHangupJob(
  uid: string,
  jobId: ID,
  deps: HangupDeps,
  onClosed: (sessionId: ID) => Promise<void> = async () => {},
): Promise<HangupJobResult> {
  const lease = await claimJob(deps.store, uid, jobId, deps.clock.read().opsClock.now, deps.hasher);
  if (lease === null) return "skipped";
  const sessionId = lease.job.sourceIds[0]!;
  const session = await deps.store.get<Session>(uid, paths.session(uid, sessionId));
  const callIds = session?.data.registeredCallIds ?? [];
  let ok = true;
  for (const id of callIds) {
    try {
      await withDeadline(hangupCall(deps.openai, id), JOB_HANGUP_DEADLINE_MS, deps.timers);
    } catch {
      ok = false;
    }
  }
  const now = deps.clock.read().opsClock.now;
  let closed = false;
  await deps.store.transaction(uid, async (tx) => {
    const job = await tx.get<Job>(paths.job(uid, jobId));
    // Lost the lease (requeued after expiry and claimed elsewhere): this attempt commits nothing.
    if (job === null || job.data.leaseToken !== lease.token || job.data.generation !== lease.generation) return;
    const attempts = job.data.attempts + 1;
    if (!ok) {
      tx.update(job.path, {
        ...job.data,
        status: "retry",
        attempts,
        nextAttemptAt: tsFromMs(now + hangupBackoff(attempts)),
        leaseToken: null,
        leaseUntil: null,
        error: "DEPENDENCY",
        updatedAt: tsFromMs(now),
      });
      return;
    }
    tx.update(job.path, { ...job.data, status: "complete", attempts, leaseToken: null, leaseUntil: null, error: null, updatedAt: tsFromMs(now) });
    const s = await tx.get<Session>(paths.session(uid, sessionId));
    if (s !== null && s.data.status === "closing") {
      tx.update(s.path, { ...s.data, status: "closed", closedAt: tsFromMs(now), updatedAt: tsFromMs(now) });
      closed = true;
    }
  });
  if (closed) await onClosed(sessionId);
  return ok ? "complete" : "retry";
}
