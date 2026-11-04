/**
 * Session lifecycle shared by open, close and tick (R11.3, R14.2–R14.6; KV09, KS07).
 *
 * Closing is two steps around the hangups: `beginClose` marks the Session `closing` (or `closed` straight away
 * when it registered no call), then `finishClose` records the hangup outcome. A close route keeps a failed
 * Session `closing` with a `hangup` Job; session open's prior-session close marks it `closed` regardless and still
 * writes the Job (R11.3). Every move to `closed` calls `afterClosed`, which ensures Extract_Jobs (R14.5) and
 * schedules a drain.
 */
import { type CoreEpoch, type ID, type Session, type SS, type StateAck, msFromTs, tsFromMs } from "@franki/core";
import { cFields } from "./records";
import type { RouteContext } from "./routes/runtime";
import { paths } from "./store/paths";
import type { Tx } from "./store/port";
import { drainExtractJobs } from "./worker/drain";
import { ensureExtractJobs } from "./worker/extract-jobs";
import { ensureHangupJob } from "./worker/hangup";

export const SESSION_IDLE_MS = 10 * 60_000;
export const ACK_TTL_MS = 2_500;
export const DECK_TTL_MS = 60_000;

const OPEN_STATUSES: readonly Session["status"][] = ["minting", "active", "quarantined"];
export const LIVE_STATUSES: readonly Session["status"][] = ["minting", "active", "quarantined", "closing"];

export function stateAck(stamp: SS, opsNow: number): StateAck {
  return { stamp, issuedOpsAt: tsFromMs(opsNow), expiresOpsAt: tsFromMs(opsNow + ACK_TTL_MS) };
}

export function newSession(uid: string, init: { stamp: SS; now: number; startedBy: "user" | "franki" }): Session {
  const now = tsFromMs(init.now);
  return {
    ...cFields(uid, now, init.stamp.epoch, init.stamp.policyRev),
    status: "minting",
    browserState: "CONNECTING",
    generation: init.stamp.generation,
    startedBy: init.startedBy,
    callId: null,
    registeredCallIds: [],
    activeLeaseToken: null,
    startedAt: now,
    lastTurnAt: now,
    expiresAt: tsFromMs(init.now + SESSION_IDLE_MS),
    closedAt: null,
    waitDeadline: null,
    retainUntil: null,
    audience: "private",
    openedTopics: [],
    hiddenDisclosureGranted: [],
    committedItemIds: [],
    deadItemIds: [],
    lastClientSeq: 0,
    lastAdmittedSeq: 0,
    nextClientSeq: 1,
    committedParseSeq: 0,
    parseLease: null,
    lastSpeechStartedOpsAt: null,
    lastUserTurnOpsAt: null,
    stateAck: stateAck(init.stamp, init.now),
    modifiers: { rushed: null, crisis: null },
    transitionCandidateSeq: null,
    lastCheckInAnswerSeq: null,
    headMode: "full",
    responseIds: [],
    outstandingTools: [],
    update: null,
    activePlanId: null,
    pendingId: null,
    warmthLeaseId: null,
    referenceCount: 0,
  };
}

/**
 * Inside a transaction: moves a live Session to `closing`, or to `closed` when it has no registered call, and
 * clears `core/epoch.activeSessionId` when it names this Session. Returns the call IDs to hang up, or null when
 * the Session was not live.
 */
export async function beginCloseInTx(
  tx: Tx,
  uid: string,
  sessionId: ID,
  now: number,
  epochDoc?: { data: CoreEpoch } | null,
): Promise<{ callIds: string[]; closed: boolean } | null> {
  const doc = await tx.get<Session>(paths.session(uid, sessionId));
  if (doc === null || !LIVE_STATUSES.includes(doc.data.status)) return null;
  const s = doc.data;
  const ts = tsFromMs(now);
  const closed = s.registeredCallIds.length === 0;
  if (OPEN_STATUSES.includes(s.status) || closed) {
    tx.update(doc.path, { ...s, status: closed ? "closed" : "closing", browserState: "CLOSED", closedAt: closed ? ts : null, updatedAt: ts });
  }
  const epoch = epochDoc === undefined ? await tx.get<CoreEpoch>(paths.core(uid, "epoch")) : epochDoc;
  if (epochDoc === undefined && epoch !== null && epoch.data.activeSessionId === sessionId) {
    tx.update(paths.core(uid, "epoch"), { ...epoch.data, activeSessionId: null, activeCallId: null, updatedAt: ts });
  }
  return { callIds: [...s.registeredCallIds], closed };
}

export type CloseState = "closed" | "closing";

/**
 * Records the hangup outcome inside a transaction. `force` (session open's prior close) marks the Session closed
 * even when a hangup failed; the `hangup` Job still retries the calls.
 */
export async function finishCloseInTx(tx: Tx, uid: string, sessionId: ID, ok: boolean, now: number, ctx: RouteContext, force = false): Promise<CloseState> {
  const doc = await tx.get<Session>(paths.session(uid, sessionId));
  if (doc === null) return "closed";
  const s = doc.data;
  if (s.status === "closed") return "closed";
  if (!ok) await ensureHangupJob(tx, uid, sessionId, s.rev, now, ctx.deps.hasher);
  if (ok || force) {
    tx.update(doc.path, { ...s, status: "closed", closedAt: tsFromMs(now), updatedAt: tsFromMs(now) });
    return "closed";
  }
  return "closing";
}

/** After a Session reaches `closed`: ensure its Extract_Jobs (R14.5), then drain them in the background. */
export async function afterClosed(ctx: RouteContext, sessionId: ID): Promise<void> {
  await ensureExtractJobs(ctx.uid, sessionId, ctx.deps);
  ctx.schedule(() => drainExtractJobs(ctx.uid, ctx.deps));
}

export const isExpired = (s: Session, opsNow: number) => msFromTs(s.expiresAt) <= opsNow;
