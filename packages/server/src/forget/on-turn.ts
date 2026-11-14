/**
 * A forget admitted on `/api/turn` (brief 048 rulings 3, 4 and 5), written in the transaction that would have committed
 * the request turn. The request turn dies here:
 *
 *   - its Turn is written `dead`, with no Evidence and no root slices, so it is never a safe turn, never extracted
 *     and never chunked. Its text stays on the dead row only, where the forget's own resolve reads it by ID; no reader
 *     returns a dead turn (`turnEvidenceUsable`), closure unlinks it and purge empties it;
 *   - no Evidence, no Extract_Job, no hard-rule write, no typed-reply note, no Deck, no Permit for a call;
 *   - the fence (`fenceInTx`): epoch raised, barrier, burned bundle, the forget job and its pending receipt;
 *   - every Session with a registered call (every device) goes `closing` and gets its `hangup` Job, the company hit's
 *     own writer (`ensureHangupJob`), made due now;
 *   - the admission decision row and the request entry, as every turn writes them.
 *
 * The caller drives the job after the commit (`forget/drive.ts`).
 */
import { type Au, type ClockPair, type CoreEpoch, type Head, type ID, type Ledger, type Proactive, type SS, type RuleInput, type Session, type Stamp, type Turn, type TurnResponse, type Infer, tsFromMs, turnRef } from "@franki/core";
import { admitRule } from "../admission/seam";
import { type RequestKey, completeRequest } from "../ledger/request";
import { statusOf } from "../routes/turn";
import { barrierError } from "../routes/errors";
import type { RouteContext } from "../routes/runtime";
import { SESSION_IDLE_MS, beginCloseInTx } from "../sessions";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { type TurnClass, userTurnRecords } from "../turns";
import { ensureHangupJob } from "../worker/hangup";
import { fenceInTx } from "./fence";
import { ackRule, ackTurnId, dueAcks, readAckCandidates, takeDueAck } from "./ack";

type TurnRes = Infer<typeof TurnResponse>;

/** Sessions the fence may hang up: the live ones with a registered or current call (every device). */
const LIVE_WITH_CALLS = ["minting", "active", "quarantined", "closing"] as const;
/** The most Sessions one forget reads for calls (the executor's close step reads 16). */
export const FORGET_HANGUP_SESSIONS_MAX = 16;

export interface ForgetTurnInput {
  req: Parameters<typeof userTurnRecords>[0]["req"] & { requestId: string };
  text: string;
  cls: TurnClass;
  pair: ClockPair;
  epoch: CoreEpoch;
  /** The Session as read, and as the turn found it after `expireLease`. */
  sessionPath: string;
  session: Session;
  rule: RuleInput;
  stamp: Stamp;
  base: TurnRes;
  key: RequestKey;
  judge: Turn["judge"];
  uncertainSpeaker: number;
}

export interface ForgetTurnResult {
  response: TurnRes;
  jobId: ID;
  hangupJobIds: ID[];
  /** What the typed answer needs to add the acknowledgment after the drive (ruling 8). */
  opId: ID;
  key: RequestKey;
  rule: RuleInput;
  sessionId: ID;
  requestId: string;
}

export async function forgetInTurn(tx: Tx, ctx: RouteContext, x: ForgetTurnInput): Promise<ForgetTurnResult> {
  const { uid, deps } = ctx;
  const ops = x.pair.opsClock.now;
  const now = tsFromMs(ops);
  const sessionId = x.req.sessionId as ID;
  const turnId = x.req.turnId as ID;
  const core = { epoch: x.epoch.epoch, policyRev: x.epoch.policyRev };
  const { turn: turn0 } = userTurnRecords({ uid, sessionId, req: x.req, text: x.text, cls: x.cls, clock: x.pair, core, hasher: deps.hasher });
  const deadItems = turn0.itemIds.map((itemId) => ({ sessionId, itemId }));

  const fenced = await fenceInTx(tx, uid, { sessionId, requestId: x.req.requestId, requestTurnIds: [turnId] }, ops, deps.hasher, { deadItems, touchSession: false });
  if (fenced.kind === "refused") throw barrierError();

  // Every registered call, on every device (ruling 5). The request's own Session is updated once, below.
  const sessions = await tx.query<Session>({ collection: paths.collection(uid, "sessions"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
  const withCalls = sessions
    .filter((r) => (LIVE_WITH_CALLS as readonly string[]).includes(r.data.status) && (r.data.callId !== null || r.data.registeredCallIds.length > 0))
    .slice(0, FORGET_HANGUP_SESSIONS_MAX);
  const hangupJobIds: ID[] = [];
  const ownCalls = x.session.callId !== null || x.session.registeredCallIds.length > 0;
  for (const r of withCalls) {
    if (r.id === sessionId) continue;
    await beginCloseInTx(tx, uid, r.id as ID, ops, null);
  }
  for (const r of withCalls) hangupJobIds.push(await ensureHangupJob(tx, uid, r.id as ID, r.data.rev, ops, deps.hasher));

  const turn: Turn = { ...turn0, state: "dead", evidenceId: null, rootSlices: [], parseState: "committed", judge: x.judge, uncertainSpeaker: x.uncertainSpeaker };
  tx.create(paths.turn(uid, sessionId, turnId), turn);
  const s = x.session;
  const committedParseSeq = s.committedParseSeq === x.req.clientSeq - 1 ? x.req.clientSeq : s.committedParseSeq;
  tx.update(x.sessionPath, {
    ...s,
    ...(ownCalls ? { status: "closing" as const, browserState: "CLOSED" as const } : {}),
    deadItemIds: [...new Set([...s.deadItemIds, ...turn0.itemIds])].slice(-64),
    nextClientSeq: x.req.clientSeq + 1,
    lastClientSeq: x.req.clientSeq,
    committedParseSeq,
    lastTurnAt: now,
    lastUserTurnOpsAt: now,
    expiresAt: tsFromMs(ops + SESSION_IDLE_MS),
    committedItemIds: [...s.committedItemIds, ...turn0.itemIds].slice(-64),
    updatedAt: now,
  } satisfies Session);

  const admitted = admitRule(
    tx,
    { uid, requestId: x.req.requestId, requestEntryId: x.key.keyHash, turnRef: turnRef(turnId, sessionId, 1), core, opsNow: ops, stamp: x.stamp, head: null, notes: [], turns: [], audioIds: turn0.itemIds, toolOutput: null, rule: x.rule },
    deps,
  );
  const status = statusOf(admitted.outcome);
  // The turn's forget receipt rides on its answer, so the false "gone" check knows the acknowledgment has one (ruling 11).
  const response: TurnRes = admitted.kind === "permit" ? { ...x.base, status, permit: admitted.permit, notes: [], receiptId: fenced.receiptId } : { ...x.base, status, permit: null, receiptId: fenced.receiptId };
  await completeRequest(tx, x.key, response, ops);
  return { response, jobId: fenced.jobId, hangupJobIds, opId: fenced.opId, key: x.key, rule: x.rule, sessionId, requestId: x.req.requestId };
}

type RequestEntry = Extract<Ledger, { kind: "request" }>;

/**
 * Ruling 8: a typed forget with no call open. If the receipt's `blockedAt` is set by the time the route answers, the
 * answer carries the acknowledgment as its one note, under a Permit from the Admission_Seam, and the op's delivery
 * row and the request entry's stored response are written in one transaction. If not, the answer is unchanged (no
 * line), and the state route returns the acknowledgment once it is ready. A forget in a call answers `blocked`: only
 * the fresh call acknowledges.
 */
export async function ackTypedForget(ctx: RouteContext, f: ForgetTurnResult): Promise<TurnRes> {
  const { uid, deps } = ctx;
  if (f.response.permit === null || f.response.permit.scope !== "ack" || f.response.notes.length > 0) return f.response;
  return deps.store.transaction(uid, async (tx) => {
    const [candidates, entry, epoch] = await Promise.all([readAckCandidates(tx, uid), tx.get<RequestEntry>(f.key.path), tx.get<CoreEpoch>(paths.core(uid, "epoch"))]);
    const due = await dueAcks(tx, uid, candidates.filter((c) => c.opId === f.opId), deps.hasher);
    if (due.length === 0 || entry === null || epoch === null) return f.response;
    const ops = deps.clock.read().opsClock.now;
    const stamp = f.response.stamp;
    const ack = await takeDueAck(tx, uid, due, { opsNow: ops, audience: f.rule.audience, turn: { sessionId: f.sessionId, turnId: stamp.turnId as ID } }, deps.hasher);
    if (ack === null) return f.response;
    const admitted = admitRule(
      tx,
      { uid, requestId: f.requestId, requestEntryId: f.key.keyHash, turnRef: turnRef(stamp.turnId as ID, f.sessionId, 1), core: { epoch: epoch.data.epoch, policyRev: epoch.data.policyRev }, opsNow: ops, stamp, head: null, notes: [], turns: [], audioIds: [], toolOutput: null, rule: ackRule(ack.line, f.rule.audience) },
      deps,
    );
    if (admitted.kind !== "permit") throw new Error("the acknowledgment's rule held");
    const response: TurnRes = { ...f.response, status: statusOf(admitted.outcome), permit: admitted.permit, notes: admitted.notes };
    tx.update(entry.path, { ...entry.data, updatedAt: tsFromMs(ops), payload: { ...entry.data.payload, response } });
    return response;
  });
}

/**
 * The state route's half of ruling 8: for a Session with no call, a due acknowledgment of a forget asked on that
 * Session, as the answer's `proactive`. Reads nothing more for a Session with a call, so a call's poll costs nothing.
 */
export async function typedAckOnState(
  tx: Tx,
  ctx: RouteContext,
  x: { sessionId: ID; session: Session; stamp: SS; head: Head; audience: Au; opsNow: number },
): Promise<Proactive | null> {
  const { uid, deps } = ctx;
  if (x.session.callId !== null || x.session.registeredCallIds.length > 0) return null;
  const candidates = await readAckCandidates(tx, uid);
  if (candidates.length === 0) return null;
  const due = await dueAcks(tx, uid, candidates, deps.hasher);
  if (due.length === 0) return null;
  const turnId = ackTurnId(deps.hasher, x.sessionId, due);
  const ack = await takeDueAck(tx, uid, due, { opsNow: x.opsNow, audience: x.audience, sessionId: x.sessionId, turn: { sessionId: x.sessionId, turnId } }, deps.hasher);
  if (ack === null) return null;
  const admitted = admitRule(
    tx,
    { uid, requestId: turnId, requestEntryId: null, turnRef: turnRef(turnId, x.sessionId, 1), core: { epoch: x.stamp.epoch, policyRev: x.stamp.policyRev }, opsNow: x.opsNow, stamp: { ...x.stamp, turnId }, head: x.head, notes: [], turns: [], audioIds: [], toolOutput: null, rule: ackRule(ack.line, x.audience) },
    deps,
  );
  if (admitted.kind !== "permit" || admitted.notes.length !== 1) throw new Error("the acknowledgment's rule held");
  return { turnId, permit: admitted.permit, whisper: admitted.notes[0]!, cards: [] };
}
