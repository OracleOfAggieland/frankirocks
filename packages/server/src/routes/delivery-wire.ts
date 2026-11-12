/**
 * Delivery's choice on the wire (brief 030 phase two, part A; brief 023 seams; brief 036 "Outcome").
 *
 * `open` and `state` each make one call here, after their own transaction has committed and after their own checks
 * (barrier, narrowing, ack). The Gate runs inside `chooseNow`, for every candidate, with the session's audience and
 * modifiers; this module passes those in and never gates a second way. A route with no Session passes no audience,
 * which `chooseNow` reads as `unknown` (the lead's ruling).
 *
 *   - `openingProactive`: the session's first line, `{ kind: "opening" }`. The open first runs `memoryTick` within
 *     what is left of its budget, so a moment that came due since the last tick can open. Coordinator ruling on
 *     brief 042: the open's budget is the contract and the line is optional. The whole of delivery (the tick, the
 *     choice, its reads and the render) runs under one deadline set from what is left when it starts, on the ops
 *     clock; past it the open answers with no `Proactive`, and the line waits for the idle whisper or the next open.
 *   - `idleProactive`: an idle whisper in an open session, `{ kind: "session", listening, silentMs }`. It runs only
 *     once the session has been silent for `IDLE_SILENCE_MS`, so the state route's one-a-second poll costs no scan
 *     while someone is talking.
 *
 * The Proactive is not part of the open's recorded answer: a replayed open (a lost answer) gets none, and the moment
 * stays leased for the next opening. Ruling, fails closed: a line is never sent twice from one render.
 */
import { IDLE_SILENCE_MS, PERMIT_TTL_MS, type ID, type Moment, type Proactive, type Session, type Stamp, type Turn, msFromTs, tsFromMs } from "@franki/core";
import { gateAudience } from "../audience";
import { raceLimit } from "../clock/timers";
import { paths } from "../store/paths";
import { type DeliveryVerdict, type SessionSignals, chooseNow, proactiveOf } from "../time/proactive";
import { writeGateDecision } from "../ledger/said";
import { heldPastDue, recordReminderHeld } from "../time/held-reminder";
import { memoryTick, scanMoments } from "../time/tick";
import { storeReader } from "../head-build";
import type { RouteContext } from "./runtime";

/** Kept back from the open's tick for the choice and the render (two reads and one small transaction). */
export const OPEN_DELIVERY_RESERVE_MS = 600;
/**
 * Store calls the open makes after delivery's deadline and before it answers: 0. The request ledger's answer is
 * completed inside the open's transaction, the prior Session's close runs before delivery, and `mutation` writes
 * nothing on success; an abandoned delivery read keeps running but is not awaited (`open-budget.test.ts` counts them).
 */
export const OPEN_CALLS_AFTER_DELIVERY = 0;
/**
 * Kept back from delivery's deadline for the open's own answer after it. With no store call left
 * (`OPEN_CALLS_AFTER_DELIVERY`), it covers only the route's return, the timer that fires the deadline running late
 * on a busy process, and the response's serialization; it is not sized for store round trips.
 */
export const OPEN_ANSWER_MARGIN_MS = 150;
/**
 * The state route's own budget, from its start on the ops clock: the browser gives a poll 1,500 ms
 * (`STATE_TIMEOUT_MS`), and 300 ms is left for the network. A silent poll's idle read costs 8 store calls with
 * nothing due (the session, the moment scan for check-ins, then the choice's core reads and scan) and more with
 * candidates, so at 75 ms a round trip it can pass the poll's own limit; it runs under what is left of this.
 */
export const STATE_BUDGET_MS = 1_200;
/** The most user Turns read to count turns since a check-in answer. Past it, the count is taken as 0 (fails closed). */
export const CHECKIN_TURNS_READ_MAX = 50;

/** The session's signals for delivery, from its stored row. */
export function signalsOf(s: Session, opsNow: number, turnsSinceCheckInAnswer: number | null): SessionSignals {
  const g = gateAudience(s, opsNow);
  return {
    audience: g.audience,
    rushed: g.modifiers.rushed,
    transition: s.transitionCandidateSeq !== null,
    crisis: g.modifiers.crisis,
    turnsSinceCheckInAnswer,
  };
}

/**
 * Turns since the owner answered a check-in in this session (spec §5: no insight within two turns of one). The
 * answer is the first user Turn after a check-in said in this session; null when none was said or none answered.
 */
export async function turnsSinceCheckInAnswer(ctx: RouteContext, s: Session, sessionId: string): Promise<number | null> {
  const reader = storeReader(ctx.deps.store, ctx.uid);
  const moments = (await scanMoments(reader, ctx.uid)) ?? null;
  if (moments === null) return 0;
  const started = msFromTs(s.startedAt);
  const said = moments
    .map((d) => d.data)
    .filter((m: Moment) => m.kind === "checkIn" && m.saidAt !== null && msFromTs(m.saidAt) >= started)
    .map((m) => msFromTs(m.saidAt!));
  if (said.length === 0) return null;
  const last = Math.max(...said);
  const turns = await reader.query<Turn>({ collection: paths.turns(ctx.uid, sessionId), where: [], orderBy: { field: "seq", dir: "asc" }, limit: CHECKIN_TURNS_READ_MAX });
  if (turns.length >= CHECKIN_TURNS_READ_MAX) return 0;
  const after = turns.filter((t) => t.data.role === "user" && msFromTs(t.data.committedAt) > last).length;
  return after === 0 ? null : after - 1;
}

/**
 * A failed choice or render says nothing (fails closed) and never fails the route that already committed: the moment
 * stays leased and is offered again. Logged by name only.
 */
async function deliver(ctx: RouteContext, mode: Parameters<typeof chooseNow>[1], stamp: Omit<Stamp, "turnId">, signals: SessionSignals, deadline = Infinity): Promise<Proactive | null> {
  try {
    return await deliverOnce(ctx, mode, stamp, signals, deadline);
  } catch (e) {
    ctx.deps.log("delivery.failed", { mode: mode.kind, error: e instanceof Error ? e.name : "unknown" });
    return null;
  }
}

async function deliverOnce(ctx: RouteContext, mode: Parameters<typeof chooseNow>[1], stamp: Omit<Stamp, "turnId">, signals: SessionSignals, deadline: number): Promise<Proactive | null> {
  const { choice, moments, verdicts } = await chooseNow(ctx, mode, signals);
  if (verdicts !== undefined && verdicts.length > 0 && ctx.deps.clock.read().opsClock.now < deadline) await writeVerdictRows(ctx, stamp, signals, verdicts);
  if (choice.spoken === null) return null;
  const id = choice.spoken.momentId as ID;
  const m = moments.get(id);
  if (m === undefined) return null;
  // Idle only: a line rendered for an earlier poll is still under its Permit, so the browser has it and nothing is
  // sent twice (the state route is polled once a second). Past the Permit's life an unadmitted line is offered again.
  // An open is a new session, whose browser holds no earlier Permit, so it renders afresh.
  if (mode.kind === "session" && m.rendered !== null && ctx.deps.clock.read().opsClock.now - msFromTs(m.rendered.at) < PERMIT_TTL_MS) return null;
  // Past the deadline nothing is rendered: the route has answered, or is about to, without this line.
  if (ctx.deps.clock.read().opsClock.now >= deadline) return null;
  const turnId = ctx.deps.hasher.id(["proactiveTurn", stamp.sessionId, id, m.generation]) as ID;
  return proactiveOf(ctx, id, m, { ...stamp, turnId });
}

/**
 * Brief 042 item 4: the rows for delivery's own Gate verdicts that were not `say`, IDs and reason codes only, at most
 * one per candidate per Session: the rows' turn is the Session's delivery turn (`deliveryTurnId`), so the row ID is
 * the same for every poll and open of that Session and a second write finds it stored. A `card` verdict is recorded
 * with the Gate's own outcome for it, `steered`. At most `DELIVERY_ROWS_MAX` a call; the rest wait for the next.
 */
export const DELIVERY_ROWS_MAX = 8;
export const deliveryTurnId = (hasher: { id(parts: unknown): string }, sessionId: string): ID => hasher.id(["deliveryVerdicts", sessionId]) as ID;

async function writeVerdictRows(ctx: RouteContext, stamp: Omit<Stamp, "turnId">, signals: SessionSignals, verdicts: readonly DeliveryVerdict[]): Promise<void> {
  const { uid, deps } = ctx;
  const turnId = deliveryTurnId(deps.hasher, stamp.sessionId);
  await deps.store.transaction(uid, async (tx) => {
    const at = { uid, now: tsFromMs(deps.clock.read().opsClock.now), epoch: stamp.epoch, policyRev: stamp.policyRev };
    for (const v of verdicts.slice(0, DELIVERY_ROWS_MAX)) {
      const row = { candidateId: v.momentId, refs: [{ type: "moment" as const, id: v.momentId, rev: v.rev }], noteIds: [], momentId: v.momentId, sessionId: stamp.sessionId as ID, turnId, audience: signals.audience ?? "unknown", permitKind: "proactive" as const };
      await writeGateDecision(tx, deps.hasher, at, v.result, row);
      // Brief 042 item 3: a reminder held for a crisis past its due time is recorded, to be said late.
      if (v.moment !== undefined && v.worldNow !== undefined && heldPastDue(v.moment, v.result, v.worldNow)) await recordReminderHeld(tx, uid, v.momentId, v.moment, deps.clock.read().opsClock.now, deps.hasher);
    }
  });
}

/**
 * The opening line of a fresh session, or null. `budgetMs` is what is left of the open's budget; the open passes
 * the Session it just wrote, so no read is spent on it. Never answers after the deadline (fails closed: no line).
 */
export async function openingProactive(ctx: RouteContext, stamp: Omit<Stamp, "turnId">, budgetMs: number, session?: Session): Promise<Proactive | null> {
  const { deps } = ctx;
  const start = deps.clock.read().opsClock.now;
  const left = budgetMs - OPEN_ANSWER_MARGIN_MS;
  if (!(left > 0)) return null;
  const deadline = start + left;
  const work = (async (): Promise<Proactive | null> => {
    const s = session ?? (await deps.store.get<Session>(ctx.uid, paths.session(ctx.uid, stamp.sessionId)))?.data ?? null;
    if (s === null) return null;
    const tickLimit = deadline - OPEN_DELIVERY_RESERVE_MS - deps.clock.read().opsClock.now;
    if (tickLimit > 0) await raceLimit(memoryTick(ctx), tickLimit, deps.timers);
    const ops = deps.clock.read().opsClock.now;
    if (ops >= deadline) return null;
    return deliver(ctx, { kind: "opening" }, stamp, signalsOf(s, ops, null), deadline);
  })();
  return withinDeadline(work.catch((e: unknown) => logged(ctx, "opening", e)), deadline - start, deps.timers);
}

/** Logs a failed delivery read by name only, and says nothing. */
function logged(ctx: RouteContext, mode: string, e: unknown): null {
  ctx.deps.log("delivery.failed", { mode, error: e instanceof Error ? e.name : "unknown" });
  return null;
}

/**
 * The work's answer, or null once `ms` pass first (brief 045 finding 9: its failure is caught here too, so a read
 * outside `deliver`'s own try never fails the route). The work keeps running.
 */
async function withinDeadline<T>(work: Promise<T | null>, ms: number, timers: Parameters<typeof raceLimit>[2]): Promise<T | null> {
  const stop = new AbortController();
  const caught = work.catch(() => null);
  try {
    return await Promise.race([caught, timers.sleep(ms, stop.signal).then(() => null)]);
  } finally {
    stop.abort();
  }
}

/**
 * An idle whisper for a live, listening session, or null. The session is read after the state route's own write,
 * and nothing else is read until it has been silent for `IDLE_SILENCE_MS` (its last turn or receipt, and the last
 * speech start the browser reported).
 */
export async function idleProactive(ctx: RouteContext, stamp: Omit<Stamp, "turnId">, budgetMs = Infinity): Promise<Proactive | null> {
  if (!(budgetMs > 0)) return null;
  // Brief 045 finding 9: every read delivery makes is inside the catch; a store blip never fails the route.
  if (budgetMs === Infinity) return idleOnce(ctx, stamp, Infinity).catch((e: unknown) => logged(ctx, "session", e));
  const start = ctx.deps.clock.read().opsClock.now;
  return withinDeadline(idleOnce(ctx, stamp, start + budgetMs).catch((e: unknown) => logged(ctx, "session", e)), budgetMs, ctx.deps.timers);
}

async function idleOnce(ctx: RouteContext, stamp: Omit<Stamp, "turnId">, deadline: number): Promise<Proactive | null> {
  const doc = await ctx.deps.store.get<Session>(ctx.uid, paths.session(ctx.uid, stamp.sessionId));
  if (doc === null || (doc.data.status !== "active" && doc.data.status !== "minting")) return null;
  const s = doc.data;
  const ops = ctx.deps.clock.read().opsClock.now;
  const lastSound = Math.max(msFromTs(s.lastTurnAt), s.lastSpeechStartedOpsAt === null ? 0 : msFromTs(s.lastSpeechStartedOpsAt));
  const silentMs = ops - lastSound;
  if (!(silentMs >= IDLE_SILENCE_MS)) return null;
  const turns = await turnsSinceCheckInAnswer(ctx, s, stamp.sessionId);
  return deliver(ctx, { kind: "session", listening: true, silentMs }, stamp, signalsOf(s, ops, turns), deadline);
}
