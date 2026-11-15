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
  type RouteNoteKind,
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
import { type OnTurnContext, correctionTargets, entitiesFor, packetTargets, readOnTurnContext, subjectIndex, truthOrderTargets } from "./context";
import { type HardRuleRun, executeHardRule, planOnTurnMemory } from "./execute";
import { storeReader } from "../head-build";
import { anyMemoryRoute, candidateOpens, memoryCandidates, memoryRegexOpens, orRoutes } from "./trigger";
import { TYPED_ROUTE_BUDGET_MS, planKey, typedCareNote, typedLineNote, typedRouteReply } from "./typed";
import { traceFastSlots } from "../live-test/trace";

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
 * The FastSlots call (6.1): at once on a regex hit (RX4, RX6 or RX7) or an asked question, else when the parse returns
 * a hardRule, correct or transition candidate; never otherwise. The context is read right before the call. The
 * correct route's targets go in the packet when that route is known to be open when the call starts (brief 025).
 */
export async function runHardRuleSlots(
  ctx: Pick<RouteContext, "uid" | "deps">,
  a: { eid: string; text: string; typed: boolean; regex: boolean; askedRuleId: string | null; asked: boolean; pre: PreRoute; generation: number; slowP: Promise<SlowParse | null> },
): Promise<RouteRun | null> {
  const { uid, deps } = ctx;
  const now = () => deps.clock.read().opsClock.now;
  const memRegex = memoryRegexOpens({ text: a.text, cls: "U", transcriptState: "final", supersedes: false });
  let step = nextSlots(initialSlots(a.regex || anyMemoryRoute(memRegex)), { kind: "ready", asked: a.asked, at: now() });
  let parsedFirst: SlowParse | null | undefined;
  if (!step.start) {
    if (step.phase.kind === "notNeeded") return null;
    parsedFirst = await a.slowP;
    step = nextSlots(step.phase, { kind: "parsed", route: candidateOpens(parsedFirst) || anyMemoryRoute(memoryCandidates(parsedFirst)), at: now() });
    if (!step.start) return null;
  }
  const context = await readSnapshot(deps.store, uid, (reader) => readOnTurnContext(reader, uid, a.pre.epoch, a.generation));
  const correctKnown = memRegex.correct || (parsedFirst !== undefined && memoryCandidates(parsedFirst).correct);
  const shownTargets = correctKnown ? correctionTargets(context, [a.text]) : new Map();
  const known = subjectIndex(context.memories, a.pre.rules, deps.hasher);
  // Brief 025 task D2: the transition route's truth-order rows, code's pick, kept out of the packet.
  const transitionKnown = memRegex.transition || (parsedFirst !== undefined && memoryCandidates(parsedFirst).transition);
  const targets = transitionKnown ? new Map([...truthOrderTargets(context, a.text, known, deps.hasher), ...shownTargets]) : shownTargets;
  const input = {
    turn: { eid: a.eid, text: a.text, ownerConfirmed: a.typed },
    lastTurns: [],
    entities: entitiesFor(known, a.text),
    targets: packetTargets(shownTargets),
    pendingId: a.askedRuleId,
  };
  const slots = await deps.fastSlots.slots(input, FAST_SLOTS_DEADLINE_MS);
  traceFastSlots(deps.trace, slots, { eid: a.eid, typed: a.typed });
  // The routes the turn opened, once its parse is in (the turn waits for the parse anyway).
  const slow = parsedFirst !== undefined ? parsedFirst : await a.slowP.catch(() => null);
  const memoryRoutes = orRoutes(memRegex, memoryCandidates(slow));
  return { slots, context: { ...context, memoryRoutes, targets } };
}

export interface TypedPlan {
  key: string;
  /** The note kinds of the plan the reply was written from. */
  kinds: readonly RouteNoteKind[];
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
  const full = { ...run, rules: pre.rules, epoch: pre.epoch, bundle: pre.bundle, clock };
  // Brief 043, finding 2: the correct and transition routes are planned too, so the key matches the committed plan.
  const memory = await planOnTurnMemory(storeReader(deps.store, ctx.uid), full);
  const planned = executeHardRule({ ...full, memory });
  const head = planned.bundle?.head ?? pre.bundle.head;
  const key = planKey(planned.entry, planned.kinds);
  if (head === null) return { key, kinds: planned.kinds, reply: null };
  const note = routeNote(planned.kinds, { noteId: deps.hasher.id(["routeNote", run.sessionId, run.turnId]), expiresAt: tsFromMs(clock.opsClock.now + ROUTE_NOTE_TTL_MS), privateAudience: run.audience === "private" });
  const left = TYPED_ROUTE_BUDGET_MS - TYPED_COMMIT_RESERVE_MS - (deps.clock.read().opsClock.now - startedAt);
  const reply = await typedRouteReply(ctx, { sessionId: run.sessionId, turnId: run.turnId }, head, note?.text ?? null, turns, run.evidence.record.text?.kind === "inline" ? run.evidence.record.text.text : "", left);
  return { key, kinds: planned.kinds, reply };
}

/**
 * The one Franki line of a typed route turn (brief 043, finding 2: there is always exactly one). A committed correction
 * gets its closed line (W-199). Otherwise the reply if its plan is the committed one; else the closed line for what
 * committed; else, when neither plan claims anything, the reply as an ordinary one (a deferral); else the closed care
 * line, which claims nothing.
 */
export function typedRouteNote(ctx: RouteContext, plan: TypedPlan, committed: { key: string; kinds: Parameters<typeof typedLineNote>[0] }, at: { sessionId: string; turnId: string; opsNow: number }): W {
  const noteId = ctx.deps.hasher.id(["note", at.sessionId, at.turnId]);
  const expiresAt = tsFromMs(at.opsNow + ROUTE_NOTE_TTL_MS);
  const closed = typedLineNote(committed.kinds, noteId, expiresAt);
  if (closed !== null && committed.kinds.some((k) => CORRECTION_KINDS.has(k))) return closed;
  if (plan.reply !== null && plan.key === committed.key) return plan.reply;
  if (closed !== null) return closed;
  if (plan.reply !== null && plan.kinds.length === 0 && committed.kinds.length === 0) return plan.reply;
  return typedCareNote(noteId, expiresAt);
}

const CORRECTION_KINDS: ReadonlySet<RouteNoteKind> = new Set(["corrected", "renamed", "retracted"]);
