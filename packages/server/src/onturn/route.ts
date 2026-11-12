/**
 * The hardRule route's steps outside the turn transaction (brief 012 design 3.0, 6.1, G17, G22): the arrival read,
 * the one FastSlots call per request through `nextSlots`, and the typed reply of G17 written from the planned Head.
 * `routes/turn.ts` calls these and runs `executeHardRule` in its transaction.
 */
import {
  type CoreBundle,
  type CoreEpoch,
  type CoreRules,
  type CoreState,
  FAST_SLOTS_DEADLINE_MS,
  type FastSlotsResult,
  ROUTE_NOTE_TTL_MS,
  type SafeTurn,
  type W,
  initialSlots,
  nextSlots,
  routeNote,
  tsFromMs,
  withRulesDefaults,
} from "@franki/core";
import { ownerClock } from "../core-docs";
import type { SlowParse } from "../intents/slow-parse";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import { readSnapshot } from "../store/port";
import { type OnTurnContext, entitiesFor, readOnTurnContext, subjectIndex } from "./context";
import { type HardRuleRun, executeHardRule } from "./execute";
import { candidateOpens } from "./trigger";
import { TYPED_ROUTE_BUDGET_MS, planKey, typedLineNote, typedRouteReply } from "./typed";

/** Time the typed path keeps for the transaction after its reply (G17's budget). */
const TYPED_COMMIT_RESERVE_MS = 1_000;

export interface PreRoute {
  rules: CoreRules;
  epoch: CoreEpoch;
  bundle: CoreBundle;
  state: CoreState;
}

/** The core documents read at arrival, outside the transaction. */
export async function readPreRoute(ctx: Pick<RouteContext, "uid" | "deps">): Promise<PreRoute> {
  const { uid, deps } = ctx;
  const [rules, epoch, bundle, state] = await Promise.all([
    deps.store.get<CoreRules>(uid, paths.core(uid, "rules")),
    deps.store.get<CoreEpoch>(uid, paths.core(uid, "epoch")),
    deps.store.get<CoreBundle>(uid, paths.core(uid, "bundle")),
    deps.store.get<CoreState>(uid, paths.core(uid, "state")),
  ]);
  return { rules: withRulesDefaults(rules!.data) as CoreRules, epoch: epoch!.data, bundle: bundle!.data, state: state!.data };
}

export interface RouteRun {
  slots: FastSlotsResult;
  context: OnTurnContext;
}

/**
 * The FastSlots call (6.1): at once on a regex hit or an asked question, else when the parse returns a hardRule
 * candidate; never otherwise. The context is read right before the call.
 */
export async function runHardRuleSlots(
  ctx: Pick<RouteContext, "uid" | "deps">,
  a: { eid: string; text: string; typed: boolean; regex: boolean; askedRuleId: string | null; asked: boolean; pre: PreRoute; generation: number; slowP: Promise<SlowParse | null> },
): Promise<RouteRun | null> {
  const { uid, deps } = ctx;
  const now = () => deps.clock.read().opsClock.now;
  let step = nextSlots(initialSlots(a.regex), { kind: "ready", asked: a.asked, at: now() });
  if (!step.start) {
    if (step.phase.kind === "notNeeded") return null;
    const slow = await a.slowP;
    step = nextSlots(step.phase, { kind: "parsed", route: candidateOpens(slow), at: now() });
    if (!step.start) return null;
  }
  const context = await readSnapshot(deps.store, uid, (reader) => readOnTurnContext(reader, uid, a.pre.epoch, a.generation));
  const input = {
    turn: { eid: a.eid, text: a.text, ownerConfirmed: a.typed },
    lastTurns: [],
    entities: entitiesFor(subjectIndex(context.memories, a.pre.rules, deps.hasher), a.text),
    targets: [],
    pendingId: a.askedRuleId,
  };
  const slots = await deps.fastSlots.slots(input, FAST_SLOTS_DEADLINE_MS);
  return { slots, context };
}

export interface TypedPlan {
  key: string;
  reply: W | null;
}

/** G17: plans outside the transaction, writes the reply from the planned Head, and records which plan it was. */
export async function planTypedReply(
  ctx: RouteContext,
  run: Omit<HardRuleRun, "rules" | "epoch" | "bundle" | "clock">,
  pre: PreRoute,
  turns: readonly SafeTurn[],
  startedAt: number,
): Promise<TypedPlan> {
  const { deps } = ctx;
  const clock = ownerClock(pre.state, deps.clock);
  const planned = executeHardRule({ ...run, rules: pre.rules, epoch: pre.epoch, bundle: pre.bundle, clock });
  const head = planned.bundle?.head ?? pre.bundle.head;
  const key = planKey(planned.entry, planned.kinds);
  if (head === null) return { key, reply: null };
  const note = routeNote(planned.kinds, { noteId: deps.hasher.id(["routeNote", run.sessionId, run.turnId]), expiresAt: tsFromMs(clock.opsClock.now + ROUTE_NOTE_TTL_MS), privateAudience: run.audience === "private" });
  const left = TYPED_ROUTE_BUDGET_MS - TYPED_COMMIT_RESERVE_MS - (deps.clock.read().opsClock.now - startedAt);
  const reply = await typedRouteReply(ctx, { sessionId: run.sessionId, turnId: run.turnId }, head, note?.text ?? null, turns, run.evidence.record.text?.kind === "inline" ? run.evidence.record.text.text : "", left);
  return { key, reply };
}

/** The one Franki line of a typed route turn: the reply if its plan committed, else the closed line. */
export function typedRouteNote(ctx: RouteContext, plan: TypedPlan, committed: { key: string; kinds: Parameters<typeof typedLineNote>[0] }, at: { sessionId: string; turnId: string; opsNow: number }): W | null {
  if (plan.reply !== null && plan.key === committed.key) return plan.reply;
  return typedLineNote(committed.kinds, ctx.deps.hasher.id(["note", at.sessionId, at.turnId]), tsFromMs(at.opsNow + ROUTE_NOTE_TTL_MS));
}
