/**
 * The hardRule executor (brief 012 design 3.0 steps 1, 2, 6, 7 and 8; wave B is hardRule only, so there are no
 * targets and no Memory writes). It runs inside the turn's transaction on the `core/rules` that transaction read,
 * and returns what the transaction writes: the next `core/rules` (open proposals applied first, the plan, subject
 * labels, the `handled` ring entry and the open question), the next `core/bundle` when the rules changed, and the
 * `TurnWrite` and route note kinds `admitRule` and `writeRule` read. It writes nothing itself.
 *
 * - The Head is compiled from the context read before the transaction plus the new rules (G16). A failed compile
 *   leaves the bundle `dirty` with the old Head and sends no route note; the rules still commit.
 * - The turn is an answer only when `core/rules.ask` is asked in this Session both at arrival and in the
 *   transaction (3.0).
 * - The ledger decisions `planHardRule` returns are not written as rows in wave B: the `handled` entry records the
 *   outcome and every code a denial named (a ruling for the report).
 */
import {
  type Au,
  type ClockPair,
  type CoreBundle,
  type CoreEpoch,
  type CoreRules,
  type Evidence,
  type FastSlotsResult,
  HANDLED_RING_MAX,
  type HardRuleOutcome,
  type HardRulePlan,
  type HeadMemory,
  type Route,
  type Snapshot,
  type Hasher,
  type ID,
  type ItemVerdict,
  NO_ASK,
  type OnTurnHandled,
  type RouteNoteKind,
  type TurnWrite,
  canonicalJSON,
  compileHead,
  pendingNext,
  planHardRule,
  tsFromMs,
  utf8,
  validateItems,
} from "@franki/core";
import { foregroundEC } from "../head-build";
import { DECK_TTL_MS } from "../sessions";
import { type OnTurnContext, entitiesFor, subjectIndex, turnEvidence } from "./context";
import { applyProposals } from "./proposals";
import type { Tx } from "../store/port";
import { type MemoryOutcome, NO_MEMORY, overlay, planMemoryRoutes, writeMemoryCommands } from "./memory-route";
import { askedHere } from "./trigger";

type Asked = NonNullable<ReturnType<typeof askedHere>>;

export interface HardRuleRun {
  uid: string;
  sessionId: string;
  turnId: string;
  clientSeq: number;
  generation: number;
  source: "asr" | "typed";
  rules: CoreRules;
  epoch: CoreEpoch;
  bundle: CoreBundle;
  evidence: { eid: string; record: Evidence };
  slots: FastSlotsResult;
  trigger: { regex: boolean; candidate: boolean; asked: boolean };
  /** The question as it stood at arrival; the turn answers it only if it still stands. */
  askedAtArrival: Asked | null;
  speakerCertain: boolean;
  context: OnTurnContext;
  clock: ClockPair;
  audience: Au;
  hasher: Hasher;
  /** G1: the reply was already admitted under fastO (brief 025, task D2). */
  fastO?: boolean;
  /** The correct and transition routes' plan, made in the transaction by `executeOnTurn`. */
  memory?: MemoryOutcome;
}

export interface HardRuleResult {
  rules: CoreRules;
  /** `rulesRev` rose: the Deck rises and the bundle is recompiled. */
  rulesChanged: boolean;
  bundle: CoreBundle | null;
  outcome: HardRuleOutcome;
  kinds: RouteNoteKind[];
  write: TurnWrite;
  entry: OnTurnHandled;
}

const SUBJECT_LABELS_MAX = 256;
const RULE_KEYS_MAX = 32;
/** `handled` holds at most this many entries per turn, one per route (`HandledEntry.entries: arr(OnTurnHandledRecord, 3)`). */
const HANDLED_ENTRIES_MAX = 3;

type CompileRun = Pick<HardRuleRun, "uid" | "epoch" | "bundle" | "context" | "clock" | "audience" | "generation" | "hasher">;

/** The bundle after a rules change: the Head compiled from the context plus the new rules (G16), else `dirty`. */
function recompiled(run: CompileRun, rules: CoreRules, laid: { memories: HeadMemory[]; snapshot: Snapshot } | null = null): CoreBundle {
  const ec = foregroundEC(run.uid, run.epoch, run.clock, run.generation);
  const compiled = compileHead({ memories: laid?.memories ?? run.context.memories, ec, snapshot: laid?.snapshot ?? run.context.snapshot, rules, audience: run.audience, clock: run.clock });
  const at = tsFromMs(run.clock.opsClock.now);
  if (!compiled.ok) return { ...run.bundle, state: "dirty", rulesRev: rules.rulesRev, updatedAt: at };
  const head = compiled.head;
  return {
    ...run.bundle,
    state: "clean",
    bundleRev: run.bundle.bundleRev + 1,
    rulesRev: rules.rulesRev,
    head,
    headHash: run.hasher.sha256(utf8(head.text)),
    selectedRefs: head.selectedRefs,
    compiledAt: at,
    expiresAt: tsFromMs(run.clock.opsClock.now + DECK_TTL_MS),
    updatedAt: at,
  };
}

/**
 * Open proposals on a turn the route didn't run on (G39): applied first, the Head recompiled when a rule was added.
 * No route note: nothing was said on this turn.
 */
export function applyOpenProposals(run: CompileRun & { rules: CoreRules }): { rules: CoreRules; rulesChanged: boolean; bundle: CoreBundle | null } | null {
  const applied = applyProposals(run.rules);
  if (!applied.changed) return null;
  const rulesChanged = applied.rules.rulesRev !== run.rules.rulesRev;
  return { rules: applied.rules, rulesChanged, bundle: rulesChanged ? recompiled(run, applied.rules) : null };
}

export function executeHardRule(run: HardRuleRun): HardRuleResult {
  const { hasher: H } = run;
  const applied = applyProposals(run.rules);
  const rules0 = applied.rules;
  const now = askedHere(rules0, run.sessionId);
  const answeringQ = run.askedAtArrival !== null && now !== null && canonicalJSON(now) === canonicalJSON(run.askedAtArrival) ? now : null;
  const answering = answeringQ === null ? null : { rule: answeringQ.ruleId === null ? null : (rules0.allergies.find((r) => r.id === answeringQ.ruleId) ?? null) };
  // Brief 025: a turn that opened only the correct or transition route plans no rule (G38). Callers that pass no
  // `memoryRoutes` (a supersede, a repair) run the hardRule route as before.
  const hardRuleOpen = run.context.memoryRoutes === undefined || run.trigger.regex || run.trigger.candidate || run.trigger.asked;
  const memory = run.memory ?? NO_MEMORY;

  const ev = turnEvidence(run.evidence.record, run.evidence.eid, H);
  const out = run.slots.kind === "valid" ? run.slots.out : null;
  const known = subjectIndex(run.context.memories, rules0, H);
  const verdicts: ItemVerdict[] =
    out === null || !hardRuleOpen
      ? []
      : validateItems(out, {
          evidence: ev,
          source: run.source,
          speakerCertain: run.speakerCertain,
          routes: new Set(["hardRule"]),
          answering,
          known,
          entities: entitiesFor(known, ev.text),
          targets: new Map(),
          worldNow: run.clock.worldClock.now,
          hasher: H,
        });
  const plan: HardRulePlan = hardRuleOpen
    ? planHardRule(rules0, verdicts, { evidence: ev, trigger: run.trigger, out, speakerCertain: run.speakerCertain, answering, hasher: H })
    : { rules: rules0, outcome: { kind: "pendingKept", ruleIds: [] }, note: [], ledger: [] };
  let rules: CoreRules = plan.rules;

  // Subject labels (CQ 103): the owner's word for a subject a rule names, kept once per subject.
  const labels = [...(rules.subjectLabels ?? [])];
  for (const v of verdicts) {
    if (v.kind !== "allergy" || (v.v.kind !== "affirm" && v.v.kind !== "unsure")) continue;
    const { subject, label } = v.v;
    if (subject === null || subject === "self" || label === null || label.trim() === "") continue;
    if (labels.some((l) => l.subjectId === subject) || !rules.allergies.some((r) => r.subjectId === subject)) continue;
    if (labels.length < SUBJECT_LABELS_MAX) labels.push({ subjectId: subject, label: label.trim().slice(0, 80) });
  }

  // What the route handled (section 5): every slot written, kept or resolved. A denial's codes are not keys (brief 032
  // H1): one that reached no slot was filed by coverage, so its slot is here, and a key with no subject would cover
  // any subject's affirmed item in extraction.
  const ids = new Set<ID>("ruleIds" in plan.outcome ? plan.outcome.ruleIds : []);
  const keys = new Map<string, { subjectId: string | null; code: string }>();
  for (const r of [...rules.allergies, ...rules0.allergies]) if (ids.has(r.id)) keys.set(`${r.anonymous ? "" : r.subjectId}|${r.code}`, { subjectId: r.anonymous ? null : r.subjectId, code: r.code });
  const hardRuleEntry: OnTurnHandled = { route: "hardRule", outcome: plan.outcome.kind, keys: [], refs: [], ruleKeys: [...keys.values()].slice(0, RULE_KEYS_MAX) };
  // Brief 025: the correct and transition entries beside it (section 5), at most `HANDLED_ENTRIES_MAX`.
  const entries = [...(hardRuleOpen ? [hardRuleEntry] : []), ...memory.entries].slice(0, HANDLED_ENTRIES_MAX);
  const entry = entries[0] ?? hardRuleEntry;
  const ring = (rules.handled ?? []).filter((h) => h.eid !== run.evidence.eid);
  const handled = (entries.length === 0 ? ring : [...ring, { eid: run.evidence.eid, turnId: run.turnId, entries }]).slice(-HANDLED_RING_MAX);

  // The open question (6.4), for this Session.
  const prior = rules0.ask ?? NO_ASK;
  let q = prior.sessionId === run.sessionId ? prior.q : pendingNext(prior.q, { kind: "sessionClosed" });
  if (answeringQ !== null) q = pendingNext(q, { kind: "userTurn", seq: run.clientSeq, final: true, slotsValid: run.slots.kind === "valid" });
  if (plan.outcome.kind === "pendingWritten" && plan.outcome.question !== null && plan.outcome.ruleIds.length > 0) q = pendingNext(q, { kind: "ask", ruleId: plan.outcome.ruleIds[0]!, seq: run.clientSeq });
  // W-187 (brief 025): a pending rule a denial reached but could not remove is asked about again.
  else if (plan.reask != null) q = pendingNext(q, { kind: "ask", ruleId: plan.reask, seq: run.clientSeq });
  const askedRule = q.kind === "none" ? null : q.ruleId;
  if (askedRule !== null && !rules.allergies.some((r) => r.id === askedRule && r.state === "pending")) q = pendingNext(q, { kind: "ruleGone", ruleId: askedRule });
  const ask = q.kind === "none" ? NO_ASK : { sessionId: run.sessionId, q };

  rules = { ...rules, subjectLabels: labels, handled, ask };
  const rulesRevChanged = rules.rulesRev !== run.rules.rulesRev;
  // G1: a transition-only write on a turn whose reply is already admitted under fastO writes no bundle.
  const headMoves = memory.changed && !(memory.transitionOnly && run.fastO === true);

  let bundle: CoreBundle | null = null;
  let kinds: RouteNoteKind[] = [...plan.note, ...memory.kinds];
  if (rulesRevChanged || headMoves) {
    const laid = memory.changed ? overlay(run.context, memory.overlay, { eid: run.evidence.eid, record: run.evidence.record, rev: run.evidence.record.rev }) : null;
    bundle = recompiled(run, rules, laid);
    // G16: a failed compile keeps the old Head, and nothing says anything was saved.
    if (bundle.state === "dirty") kinds = [];
  }

  const routes: Route[] = [
    ...(hardRuleOpen ? (["hardRule"] as const) : []),
    ...(memory.entries.some((e) => e.route === "correct") ? (["correct"] as const) : []),
    ...(memory.entries.some((e) => e.route === "transition") ? (["transition"] as const) : []),
  ];
  const cut = plan.outcome.kind === "ruleKept" && plan.outcome.why === "denied";
  const committed = rulesRevChanged || memory.changed;
  const write: TurnWrite = committed
    ? { kind: "committed", routes, note: null, deckRaised: bundle !== null }
    : kinds.length > 0 || cut || memory.same
      ? { kind: "kept", routes, note: null, cut }
      : { kind: "none" };
  // `rulesChanged` tells the caller the Deck rises: the rules or the Head changed.
  return { rules, rulesChanged: rulesRevChanged || bundle !== null, bundle, outcome: plan.outcome, kinds, write, entry };
}

/**
 * The executor in the turn's transaction (brief 025): plans the correct and transition routes with reads in `tx`,
 * then the hardRule route and the rest through `executeHardRule`, then writes the Memory Commands in `tx`.
 */
export async function executeOnTurn(tx: Tx, run: HardRuleRun): Promise<HardRuleResult> {
  const routes = run.context.memoryRoutes;
  let memory: MemoryOutcome = NO_MEMORY;
  if (routes !== undefined && (routes.correct || routes.transition) && run.slots.kind === "valid") {
    memory = await planMemoryRoutes(tx, {
      uid: run.uid,
      routes,
      out: run.slots.out,
      evidence: turnEvidence(run.evidence.record, run.evidence.eid, run.hasher),
      context: run.context,
      targets: run.context.targets ?? new Map(),
      speakerCertain: run.speakerCertain,
      source: run.source,
      worldNow: run.clock.worldClock.now,
      opsNow: run.clock.opsClock.now,
      epoch: run.epoch.epoch,
      policyRev: run.epoch.policyRev,
      hasher: run.hasher,
    });
  } else if (routes !== undefined && (routes.correct || routes.transition)) {
    // No usable answer: the correction or change is left to extraction (3.2, 3.3).
    const none = (route: "correct" | "transition"): OnTurnHandled => ({ route, outcome: "deferred", keys: [], refs: [], ruleKeys: [] });
    memory = { ...NO_MEMORY, entries: [...(routes.correct ? [none("correct")] : []), ...(routes.transition ? [none("transition")] : [])] };
  }
  const result = executeHardRule({ ...run, memory });
  // A failed compile still commits the writes (design 3.0 step 6).
  writeMemoryCommands(tx, run.uid, memory.commands);
  return result;
}
