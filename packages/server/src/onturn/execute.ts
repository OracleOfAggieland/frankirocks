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

type CompileRun = Pick<HardRuleRun, "uid" | "epoch" | "bundle" | "context" | "clock" | "audience" | "generation" | "hasher">;

/** The bundle after a rules change: the Head compiled from the context plus the new rules (G16), else `dirty`. */
function recompiled(run: CompileRun, rules: CoreRules): CoreBundle {
  const ec = foregroundEC(run.uid, run.epoch, run.clock, run.generation);
  const compiled = compileHead({ memories: run.context.memories, ec, snapshot: run.context.snapshot, rules, audience: run.audience, clock: run.clock });
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

  const ev = turnEvidence(run.evidence.record, run.evidence.eid, H);
  const out = run.slots.kind === "valid" ? run.slots.out : null;
  const known = subjectIndex(run.context.memories, rules0, H);
  const verdicts: ItemVerdict[] =
    out === null
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
  const plan = planHardRule(rules0, verdicts, { evidence: ev, trigger: run.trigger, out, speakerCertain: run.speakerCertain, answering, hasher: H });
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
  const entry: OnTurnHandled = { route: "hardRule", outcome: plan.outcome.kind, keys: [], refs: [], ruleKeys: [...keys.values()].slice(0, RULE_KEYS_MAX) };
  const handled = [...(rules.handled ?? []).filter((h) => h.eid !== run.evidence.eid), { eid: run.evidence.eid, turnId: run.turnId, entries: [entry] }].slice(-HANDLED_RING_MAX);

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
  const rulesChanged = rules.rulesRev !== run.rules.rulesRev;

  let bundle: CoreBundle | null = null;
  let kinds = plan.note;
  if (rulesChanged) {
    bundle = recompiled(run, rules);
    // G16: a failed compile keeps the old Head, and nothing says anything was saved.
    if (bundle.state === "dirty") kinds = [];
  }

  const cut = plan.outcome.kind === "ruleKept" && plan.outcome.why === "denied";
  const write: TurnWrite = rulesChanged ? { kind: "committed", routes: ["hardRule"], note: null, deckRaised: true } : kinds.length > 0 || cut ? { kind: "kept", routes: ["hardRule"], note: null, cut } : { kind: "none" };
  return { rules, rulesChanged, bundle, outcome: plan.outcome, kinds, write, entry };
}
