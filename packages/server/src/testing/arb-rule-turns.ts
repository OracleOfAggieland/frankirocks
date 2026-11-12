/**
 * Allergy turn sequences and their driver, for the route properties of brief 012 wave B (task B1): P3 route
 * (`routes/turn.rule-every-head.property.test.ts`), P4 route (`routes/turn.fail-closed.property.test.ts`), P8
 * (`routes/turn.rule-lineage.property.test.ts`) and P9 (`routes/turn.no-ack-before-commit.property.test.ts`).
 * Plain module.
 *
 * A sequence is 1 to 6 turns, typed or ASR, from templates: allergies for the owner and the brother, two allergens,
 * hedges, jokes ("Mondays", "so intolerant", "allergy pill"), denials, hypotheticals, short answers and plain filler.
 * Each turn draws its Fake_FastSlots answer (the template's items, a partial set, none, invalid, transport or never)
 * and its Fake Decisions answer (a hardRule candidate or not, an uncertain speaker or not, company or not, or a
 * failed parse). The driver opens a Session, posts each turn, runs what was scheduled, polls the state route, and
 * records what the properties read: the responses, the Decks, `core/rules`, `core/bundle` and the turn's Evidence.
 */
import { type CoreBundle, type CoreRules, type Deck, type Evidence, type FastItem, type FastSlotsInput, type Span, type Turn, REGEX_TABLE, normalizeForRegex } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { decisionAnswer } from "./decisions";
import { fail, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { stateRoute } from "../routes/state";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import type { FakeSlotsAnswer } from "./fake-fast-slots";
import { type TestRig, callRoute, failingStore, settle, testRig } from "./fakes";
import { asrTurn, openTestSession, typedTurn } from "./session-fixtures";

export const UID = "owner-1";
const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;

export const RULE_ALLERGENS = ["shellfish", "peanuts", "sesame", "kiwi", "milk"] as const;
type A = (typeof RULE_ALLERGENS)[number];

export type TemplateKind =
  | "self"
  | "selfAndBrother"
  | "brother"
  | "two"
  | "curry"
  | "mondays"
  | "intolerant"
  | "pill"
  | "denial"
  | "global"
  | "quoted"
  | "me"
  | "yes"
  | "itWas"
  | "filler";

export const TEMPLATE_KINDS: readonly TemplateKind[] = ["self", "selfAndBrother", "brother", "two", "curry", "mondays", "intolerant", "pill", "denial", "global", "quoted", "me", "yes", "itWas", "filler"];

const SELF = { entityId: null, mention: null, isSelf: true };
const NOBODY = { entityId: null, mention: null, isSelf: false };

const spanOf = (eid: string, text: string, phrase: string): Span => {
  const start = text.indexOf(phrase);
  return { eid, fieldPath: "text", start, end: start + phrase.length, quote: phrase };
};

const allergy = (eid: string, text: string, phrase: string, item: string, over: Partial<Extract<FastItem, { kind: "allergy" }>> = {}): FastItem => ({
  kind: "allergy",
  subject: SELF,
  item,
  severity: "allergy",
  polarity: "affirmed",
  act: "direct",
  span: spanOf(eid, text, phrase),
  ...over,
});

/** A template's text and the items a careful model returns for it. */
export function template(kind: TemplateKind, a: A, b: A): { text: string; items: (eid: string) => FastItem[] } {
  switch (kind) {
    case "self": {
      const text = `I'm allergic to ${a}.`;
      return { text, items: (e) => [allergy(e, text, `I'm allergic to ${a}`, a)] };
    }
    case "selfAndBrother": {
      const text = `I'm allergic to ${a}, and my brother's in trouble again.`;
      return { text, items: (e) => [allergy(e, text, `I'm allergic to ${a}`, a)] };
    }
    case "brother": {
      const text = `My brother is allergic to ${a}.`;
      return { text, items: (e) => [allergy(e, text, `My brother is allergic to ${a}`, a, { subject: { entityId: null, mention: spanOf(e, text, "My brother"), isSelf: false } })] };
    }
    case "two": {
      const second = b === a ? (a === "milk" ? "kiwi" : "milk") : b;
      const text = `I'm allergic to ${a} and ${second}.`;
      const phrase = text.slice(0, -1);
      return { text, items: (e) => [allergy(e, text, phrase, a), allergy(e, text, phrase, second)] };
    }
    case "curry": {
      const text = "I think I might be allergic to something in that curry.";
      return { text, items: (e) => [allergy(e, text, "I think I might be allergic to something in that curry", "something", { polarity: "uncertain" })] };
    }
    case "mondays":
      return { text: "I'm allergic to Mondays.", items: () => [] };
    case "intolerant":
      return { text: "My boss is so intolerant.", items: () => [] };
    case "pill":
      return { text: "I took an allergy pill this morning.", items: () => [] };
    case "denial": {
      const text = `I'm not allergic to ${a}.`;
      return { text, items: (e) => [allergy(e, text, `I'm not allergic to ${a}`, a, { polarity: "denied" })] };
    }
    case "global": {
      const text = "I don't have any allergies.";
      return { text, items: (e) => [allergy(e, text, "I don't have any allergies", "any allergies", { polarity: "denied" })] };
    }
    case "quoted": {
      const text = `My doctor thinks I might be allergic to ${a}.`;
      return { text, items: (e) => [allergy(e, text, text.slice(0, -1), a, { act: "quoted", polarity: "uncertain" })] };
    }
    case "me":
      return { text: "Me.", items: (e) => [allergy(e, "Me.", "Me", "")] };
    case "yes":
      return { text: "Yes.", items: (e) => [allergy(e, "Yes.", "Yes", "yes", { subject: NOBODY })] };
    case "itWas": {
      const text = `It was the ${a}.`;
      return { text, items: (e) => [allergy(e, text, `It was the ${a}`, a, { subject: NOBODY })] };
    }
    case "filler":
      return { text: "We watched a film about trains.", items: () => [] };
  }
}

export type SlotsMode = "valid" | "partial" | "empty" | "invalid" | "transport" | "never";

export interface TurnSpec {
  kind: TemplateKind;
  a: A;
  b: A;
  source: "typed" | "asr";
  slots: SlotsMode;
  hardRuleP: number;
  uncertainSpeaker: number;
  company: boolean;
  parseFails: boolean;
  /** P9: this turn's first transaction attempt fails after its body ran. */
  commitFails: boolean;
}

export const turnSpecArb: fc.Arbitrary<TurnSpec> = fc.record({
  kind: fc.constantFrom(...TEMPLATE_KINDS),
  a: fc.constantFrom(...RULE_ALLERGENS),
  b: fc.constantFrom(...RULE_ALLERGENS),
  source: fc.constantFrom<"typed" | "asr">("typed", "asr"),
  slots: fc.constantFrom<SlotsMode>("valid", "valid", "valid", "partial", "empty", "invalid", "transport", "never"),
  hardRuleP: fc.constantFrom(0.01, 0.9),
  uncertainSpeaker: fc.constantFrom(0.01, 0.01, 0.4),
  company: fc.constantFrom(false, false, false, true),
  parseFails: fc.constantFrom(false, false, false, false, true),
  commitFails: fc.constant(false),
});

export const sequenceArb = (turn: fc.Arbitrary<TurnSpec> = turnSpecArb) => fc.array(turn, { minLength: 1, maxLength: 6 });

function slotsAnswer(spec: TurnSpec, items: (eid: string) => FastItem[]): (input: FastSlotsInput) => FakeSlotsAnswer {
  return (input) => {
    const all = items(input.turn.eid);
    switch (spec.slots) {
      case "valid":
        return { kind: "valid", out: { items: all, need: "none" }, ms: 120 };
      case "partial":
        return { kind: "valid", out: { items: all.slice(0, Math.max(0, all.length - 1)), need: "none" }, ms: 120 };
      case "empty":
        return { kind: "valid", out: { items: [], need: "none" }, ms: 120 };
      case "invalid":
        return { kind: "invalid", reason: "shape", path: "$.items", ms: 120 };
      case "transport":
        return { kind: "transport", ms: 5 };
      case "never":
        return { kind: "never" };
    }
  };
}

export interface TurnTrace {
  spec: TurnSpec;
  text: string;
  /** RX4 matched the text, or the parse returned a hardRule candidate. */
  triggered: boolean;
  regex: boolean;
  status: number;
  response: any;
  /** Responses of attempts that failed before the retry (P9: they must claim nothing). */
  failed: any[];
  evidenceId: string | null;
  evidence: Evidence | null;
  rulesBefore: CoreRules;
  rulesAfter: CoreRules;
  bundleAfter: CoreBundle;
  /** Decks returned after this turn: the turn's own and a state poll's. */
  decks: Deck[];
}

export interface Trace {
  rig: TestRig;
  sessionId: string;
  turns: TurnTrace[];
}

const rulesOf = async (store: StorePort) => (await store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
const bundleOf = async (store: StorePort) => (await store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;

/** The `handled` entries the route recorded for an Evidence, read without assuming the field exists yet. */
export function handledFor(rules: CoreRules, eid: string | null): { route: string; outcome: string; ruleKeys: { subjectId: string | null; code: string }[]; refs: { id: string }[] }[] {
  if (eid === null) return [];
  const ring = (rules as unknown as { handled?: { eid: string; entries: any[] }[] }).handled ?? [];
  return ring.filter((h) => h.eid === eid).flatMap((h) => h.entries);
}

/** Runs a sequence on a fresh rig; with `failingTurns`, those turns' first commit attempt fails. */
export async function runRuleSequence(seq: readonly TurnSpec[]): Promise<Trace> {
  const rig = testRig();
  let failNext = false;
  rig.deps.store = failingStore(rig.store, () => {
    if (!failNext) return false;
    failNext = false;
    return true;
  });
  rig.openai.always("responses.create", ok(completed("All right.")));
  const s = await openTestSession(rig);
  let stamp = s.stamp;
  const turns: TurnTrace[] = [];
  for (let i = 0; i < seq.length; i++) {
    const spec = seq[i]!;
    const n = i + 1;
    const t = template(spec.kind, spec.a, spec.b);
    const regex = RX4.test(normalizeForRegex(t.text));
    if (spec.parseFails) rig.openai.script("decisions.create", fail(new Error("transport")));
    else rig.openai.script("decisions.create", ok(decisionAnswer({ hardRule: spec.hardRuleP, uncertainSpeaker: spec.uncertainSpeaker, company: spec.company ? 0.9 : 0.01 })));
    rig.fastSlots.script(slotsAnswer(spec, t.items));
    const rulesBefore = await rulesOf(rig.store);
    const body = spec.source === "asr" ? asrTurn(stamp, n, t.text, [{ itemId: `item_${n}`, commitSeq: n }]) : typedTurn(stamp, n, t.text);
    failNext = spec.commitFails;
    const failed: any[] = [];
    let res = await callRoute(rig, turnRoute, body);
    // A failed commit leaves the request free for the retry, as the browser would send it.
    if (res.status !== 200) {
      failed.push(res.body);
      res = await callRoute(rig, turnRoute, body);
    }
    await settle(rig.sched.runAll(), rig.clock, rig.timers);
    const decks: Deck[] = [];
    if (res.body?.deck) decks.push(res.body.deck);
    if (res.body?.stamp) stamp = { ...stamp, epoch: res.body.stamp.epoch, policyRev: res.body.stamp.policyRev, bundleRev: res.body.stamp.bundleRev, rulesRev: res.body.stamp.rulesRev };
    const state = await callRoute(rig, stateRoute, { sessionId: s.sessionId, generation: 1, seen: { epoch: stamp.epoch, policyRev: stamp.policyRev, bundleRev: stamp.bundleRev, rulesRev: stamp.rulesRev }, ackStamp: null, speechStartedOpsAt: null });
    if (state.body?.deck) {
      decks.push(state.body.deck);
      const d: Deck = state.body.deck;
      stamp = { ...stamp, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev };
    }
    const turn = await rig.store.get<Turn>(UID, paths.turn(UID, s.sessionId, testId(`turn-${n}`)));
    const evidenceId = turn?.data.evidenceId ?? null;
    const evidence = evidenceId === null ? null : ((await rig.store.get<Evidence>(UID, paths.evidence(UID, evidenceId)))?.data ?? null);
    const parsedHit = !spec.parseFails && spec.hardRuleP >= 0.2;
    turns.push({ spec, text: t.text, triggered: regex || parsedHit, regex, status: res.status, response: res.body, failed, evidenceId, evidence, rulesBefore, rulesAfter: await rulesOf(rig.store), bundleAfter: await bundleOf(rig.store), decks });
  }
  return { rig, sessionId: s.sessionId, turns };
}

/** The Evidence text of a trace turn. */
export const evidenceText = (e: Evidence | null): string => (e?.text?.kind === "inline" ? e.text.text : "");
