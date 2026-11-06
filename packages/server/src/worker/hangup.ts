/**
 * Hangups and the durable `hangup` Job (R11.3, R14.2, R14.3; KS07; design "Close").
 *
 * `hangupAll` hangs up call IDs in parallel within a budget; an outcome still unknown at the budget counts as a
 * failure. A Session has at most one `hangup` Job (ID `H("job","hangup",sessionId)`), written by close or by a
 * failed expiry or prior-session close. Each attempt runs `hangupAll` under one deadline, so it ends well inside its
 * 30 s lease. The job retries with backoff 1, 2, 5, 10 s and then every 60 s, and never becomes `complete` until
 * every registered call ID is confirmed hung up or gone; then a `closing` Session becomes `closed` with `closedAt`.
 * `driveHangupJob` runs the first attempts in-process right after a close answers; tick's Q17 runs the steady 60 s
 * retries.
 */
import { type CoreEpoch, type Hasher, type ID, type Job, type Session, idParts, msFromTs, tsFromMs } from "@franki/core";
import { type Timers, raceLimit } from "../clock/timers";
import type { OpenAIPort } from "../openai/fake";
import type { Log } from "../routes/runtime";
import { HANGUP_CALL_DEADLINE_MS, hangupCall } from "../openai/realtime-calls";
import { paths } from "../store/paths";
import type { StorePort, Tx } from "../store/port";
import { claimJob, workJob } from "./jobs";

export const HANGUP_BACKOFF_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000];
export const HANGUP_STEADY_MS = 60_000;
/**
 * One deadline for all of an attempt's hangups, which run in parallel. One after another, three or four slow calls
 * (up to 10 s each) would outlive the 30 s lease, and Q18 would hand the Job to a second runner mid-attempt.
 */
export const JOB_HANGUP_DEADLINE_MS = HANGUP_CALL_DEADLINE_MS;

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
  log?: Log;
}

/** One hangup, with its outcome and time logged (no call ID beyond a short prefix). */
async function loggedHangup(deps: Pick<HangupDeps, "openai" | "clock" | "log">, callId: string): Promise<void> {
  const t0 = deps.clock.read().opsClock.now;
  try {
    const outcome = await hangupCall(deps.openai, callId);
    deps.log?.("hangup.call", { call: callId.slice(0, 12), outcome, ms: deps.clock.read().opsClock.now - t0 });
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    deps.log?.("hangup.call", { call: callId.slice(0, 12), outcome: "failed", status: typeof status === "number" ? status : "none", ms: deps.clock.read().opsClock.now - t0 });
    throw error;
  }
}

/** True only when every call is confirmed hung up or gone within `budgetMs`. */
export async function hangupAll(
  callIds: readonly string[],
  deps: Pick<HangupDeps, "openai" | "timers" | "clock"> & Partial<Pick<HangupDeps, "log">>,
  budgetMs: number,
): Promise<boolean> {
  if (callIds.length === 0) return true;
  let allOk = true;
  const work = Promise.all(
    callIds.map((id) =>
      loggedHangup(deps, id).catch(() => {
        allOk = false;
      }),
    ),
  );
  const finished = await raceLimit(work, budgetMs, deps.timers);
  return finished && allOk;
}

export const hangupJobId = (sessionId: ID, hasher: Hasher): ID => hasher.id(idParts.hangupJob(sessionId));

/**
 * Writes (or re-queues) the Session's `hangup` Job inside a transaction. An existing Job that is not `complete` is
 * made due now, so a second close can unstick it: a `queued` or `retry` Job waiting for a later attempt, and a
 * lease that expired with its runner (back to `retry`, as Q18 does). A live lease is left to its runner.
 */
export async function ensureHangupJob(tx: Tx, uid: string, sessionId: ID, sessionRev: number, now: number, hasher: Hasher): Promise<ID> {
  const jobId = hangupJobId(sessionId, hasher);
  const existing = await tx.get<Job>(paths.job(uid, jobId));
  const ts = tsFromMs(now);
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
    tx.update(existing.path, { ...existing.data, status: "queued", nextAttemptAt: ts, updatedAt: ts });
  } else if ((existing.data.status === "queued" || existing.data.status === "retry") && existing.data.nextAttemptAt > ts) {
    tx.update(existing.path, { ...existing.data, nextAttemptAt: ts, updatedAt: ts });
  } else if (existing.data.status === "leased" && existing.data.leaseUntil !== null && existing.data.leaseUntil <= ts) {
    tx.update(existing.path, { ...existing.data, status: "retry", leaseToken: null, leaseUntil: null, nextAttemptAt: ts, updatedAt: ts });
  }
  return jobId;
}

/** `requeued`: the attempt lost its lease before its commit (requeued, maybe claimed elsewhere) and committed nothing. */
export type HangupJobResult = "complete" | "retry" | "requeued" | "skipped";

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
  const ok = await hangupAll(session?.data.registeredCallIds ?? [], deps, JOB_HANGUP_DEADLINE_MS);
  const now = deps.clock.read().opsClock.now;
  let closed = false;
  const result = await deps.store.transaction(uid, async (tx): Promise<HangupJobResult> => {
    const job = await tx.get<Job>(paths.job(uid, jobId));
    // Lost the lease (requeued after expiry, maybe claimed elsewhere): this attempt commits nothing, and is not
    // `complete` even if every hangup answered, since only the lease holder may finish the Job.
    if (job === null || job.data.leaseToken !== lease.token || job.data.generation !== lease.generation) return "requeued";
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
      return "retry";
    }
    tx.update(job.path, { ...job.data, status: "complete", attempts, leaseToken: null, leaseUntil: null, error: null, updatedAt: tsFromMs(now) });
    const s = await tx.get<Session>(paths.session(uid, sessionId));
    if (s !== null && s.data.status === "closing") {
      tx.update(s.path, { ...s.data, status: "closed", closedAt: tsFromMs(now), updatedAt: tsFromMs(now) });
      closed = true;
    }
    return "complete";
  });
  if (closed) await onClosed(sessionId);
  return result;
}

/** Attempts a driver makes before leaving the Job to tick (the first, then one per backoff step). */
const DRIVE_MAX_ATTEMPTS = HANGUP_BACKOFF_MS.length + 1;

/**
 * Runs a `hangup` Job in this process right after a close answers: an attempt now, then one each time the Job
 * comes due again, for as long as it comes due within the 1, 2, 5, 10 s backoff. Stops when the Job completes, is
 * leased by another runner, or its next attempt is the steady 60 s one, which tick's Q17 makes.
 */
export async function driveHangupJob(
  uid: string,
  jobId: ID,
  deps: HangupDeps,
  onClosed: (sessionId: ID) => Promise<void> = async () => {},
): Promise<HangupJobResult> {
  const windowEnd = deps.clock.read().opsClock.now + HANGUP_BACKOFF_MS.reduce((a, b) => a + b, 0);
  let result: HangupJobResult = "skipped";
  for (let attempt = 1; attempt <= DRIVE_MAX_ATTEMPTS * 2; attempt++) {
    result = await runHangupJob(uid, jobId, deps, onClosed);
    deps.log?.("hangup.attempt", { attempt, result });
    if (result === "complete") return result;
    const job = await deps.store.get<Job>(uid, paths.job(uid, jobId));
    if (job === null || (job.data.status !== "queued" && job.data.status !== "retry")) return result;
    const due = msFromTs(job.data.nextAttemptAt);
    if (due > windowEnd) return result;
    await deps.timers.sleep(Math.max(0, due - deps.clock.read().opsClock.now));
  }
  return result;
}
