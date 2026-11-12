/**
 * Delivery's choice on the wire (brief 030 phase two, part A; brief 023 seams; brief 036 "Outcome").
 *
 * `open` and `state` each make one call here, after their own transaction has committed and after their own checks
 * (barrier, narrowing, ack). The Gate runs inside `chooseNow`, for every candidate, with the session's audience and
 * modifiers; this module passes those in and never gates a second way. A route with no Session passes no audience,
 * which `chooseNow` reads as `unknown` (the lead's ruling).
 *
 *   - `openingProactive`: the session's first line, `{ kind: "opening" }`. The open first runs `memoryTick` within
 *     what is left of its budget, so a moment that came due since the last tick can open.
 *   - `idleProactive`: an idle whisper in an open session, `{ kind: "session", listening, silentMs }`. It runs only
 *     once the session has been silent for `IDLE_SILENCE_MS`, so the state route's one-a-second poll costs no scan
 *     while someone is talking.
 *
 * The Proactive is not part of the open's recorded answer: a replayed open (a lost answer) gets none, and the moment
 * stays leased for the next opening. Ruling, fails closed: a line is never sent twice from one render.
 */
import { IDLE_SILENCE_MS, PERMIT_TTL_MS, type ID, type Moment, type Proactive, type Session, type Stamp, type Turn, msFromTs } from "@franki/core";
import { gateAudience } from "../audience";
import { raceLimit } from "../clock/timers";
import { paths } from "../store/paths";
import { type SessionSignals, chooseNow, proactiveOf } from "../time/proactive";
import { memoryTick, scanMoments } from "../time/tick";
import { storeReader } from "../head-build";
import type { RouteContext } from "./runtime";

/** Kept back from the open's tick for the choice and the render (two reads and one small transaction). */
export const OPEN_DELIVERY_RESERVE_MS = 600;
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
async function deliver(ctx: RouteContext, mode: Parameters<typeof chooseNow>[1], stamp: Omit<Stamp, "turnId">, signals: SessionSignals): Promise<Proactive | null> {
  try {
    return await deliverOnce(ctx, mode, stamp, signals);
  } catch (e) {
    ctx.deps.log("delivery.failed", { mode: mode.kind, error: e instanceof Error ? e.name : "unknown" });
    return null;
  }
}

async function deliverOnce(ctx: RouteContext, mode: Parameters<typeof chooseNow>[1], stamp: Omit<Stamp, "turnId">, signals: SessionSignals): Promise<Proactive | null> {
  const { choice, moments } = await chooseNow(ctx, mode, signals);
  if (choice.spoken === null) return null;
  const id = choice.spoken.momentId as ID;
  const m = moments.get(id);
  if (m === undefined) return null;
  // Idle only: a line rendered for an earlier poll is still under its Permit, so the browser has it and nothing is
  // sent twice (the state route is polled once a second). Past the Permit's life an unadmitted line is offered again.
  // An open is a new session, whose browser holds no earlier Permit, so it renders afresh.
  if (mode.kind === "session" && m.rendered !== null && ctx.deps.clock.read().opsClock.now - msFromTs(m.rendered.at) < PERMIT_TTL_MS) return null;
  const turnId = ctx.deps.hasher.id(["proactiveTurn", stamp.sessionId, id, m.generation]) as ID;
  return proactiveOf(ctx, id, m, { ...stamp, turnId });
}

/** The opening line of a fresh session, or null. `budgetMs` is what is left of the open's budget. */
export async function openingProactive(ctx: RouteContext, stamp: Omit<Stamp, "turnId">, budgetMs: number): Promise<Proactive | null> {
  const doc = await ctx.deps.store.get<Session>(ctx.uid, paths.session(ctx.uid, stamp.sessionId));
  if (doc === null) return null;
  await raceLimit(memoryTick(ctx), Math.max(0, budgetMs - OPEN_DELIVERY_RESERVE_MS), ctx.deps.timers);
  const ops = ctx.deps.clock.read().opsClock.now;
  return deliver(ctx, { kind: "opening" }, stamp, signalsOf(doc.data, ops, null));
}

/**
 * An idle whisper for a live, listening session, or null. The session is read after the state route's own write,
 * and nothing else is read until it has been silent for `IDLE_SILENCE_MS` (its last turn or receipt, and the last
 * speech start the browser reported).
 */
export async function idleProactive(ctx: RouteContext, stamp: Omit<Stamp, "turnId">): Promise<Proactive | null> {
  const doc = await ctx.deps.store.get<Session>(ctx.uid, paths.session(ctx.uid, stamp.sessionId));
  if (doc === null || (doc.data.status !== "active" && doc.data.status !== "minting")) return null;
  const s = doc.data;
  const ops = ctx.deps.clock.read().opsClock.now;
  const lastSound = Math.max(msFromTs(s.lastTurnAt), s.lastSpeechStartedOpsAt === null ? 0 : msFromTs(s.lastSpeechStartedOpsAt));
  const silentMs = ops - lastSound;
  if (!(silentMs >= IDLE_SILENCE_MS)) return null;
  const turns = await turnsSinceCheckInAnswer(ctx, s, stamp.sessionId);
  return deliver(ctx, { kind: "session", listening: true, silentMs }, stamp, signalsOf(s, ops, turns));
}
