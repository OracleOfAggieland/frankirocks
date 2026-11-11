/**
 * Generators for the hardRule properties of brief 012 (design section 7, P4). Plain module, not guarded.
 *
 * A turn is a list of templates (gazetteer aliases, nested ones, an allergen off the table, jokes, hedges, generic
 * objects, denials, hypotheticals, a third person, EpiPen and anaphylaxis words, answers to a question, and filler),
 * each with the item a careful model would return for it, or none. The FastSlots result is the careful items with
 * changes, an empty valid answer, or a failed call. Prior rules, the asked question and the triggers are random.
 */
import fc from "fast-check";
import type { CoreRules } from "../../schema/records";
import type { FastItem, FastSlotsOut, Need, Polarity, Subject } from "../types";
import { TURN_EID, changeItem, emptyRules, itemChangeArb, spanAt } from "./arb-writes";

type AllergyRule = CoreRules["allergies"][number];

export const NAMED = ["shellfish", "peanuts", "sesame", "cashew nuts", "milk", "shrimp", "kiwi", "penicillin", "tree nuts", "latex", "eggs", "soy"] as const;

export type TemplateKind =
  | "self"
  | "other"
  | "nested"
  | "offTable"
  | "mondays"
  | "intolerantBoss"
  | "allergyPill"
  | "curry"
  | "hedge"
  | "denial"
  | "globalDenial"
  | "hypothetical"
  | "epipen"
  | "anaphylaxis"
  | "answer"
  | "noCue"
  | "filler";

export interface Template {
  kind: TemplateKind;
  allergen: string;
  relation: string;
}

export const templateArb: fc.Arbitrary<Template> = fc.record({
  kind: fc.constantFrom<TemplateKind>(
    "self",
    "other",
    "nested",
    "offTable",
    "mondays",
    "intolerantBoss",
    "allergyPill",
    "curry",
    "hedge",
    "denial",
    "globalDenial",
    "hypothetical",
    "epipen",
    "anaphylaxis",
    "answer",
    "noCue",
    "filler",
  ),
  allergen: fc.constantFrom(...NAMED),
  relation: fc.constantFrom("brother", "mum", "friend"),
});

const SELF = { entityId: null, mention: null, isSelf: true };
const NOBODY = { entityId: null, mention: null, isSelf: false };

type Maker = (at: number, all: string) => FastItem;

function allergyAt(t: string, item: string, polarity: Polarity, act: FastItem["act"], subject: (at: number, all: string) => Subject): Maker {
  return (at, all) => ({ kind: "allergy", subject: subject(at, all), item, severity: "unknown", polarity, act, span: spanAt(TURN_EID, all, at, at + t.length) });
}

function build(t: Template): { text: string; item: Maker | null } {
  const self = () => SELF;
  switch (t.kind) {
    case "self": {
      const s = `I'm allergic to ${t.allergen}`;
      return { text: `${s}.`, item: allergyAt(s, t.allergen, "affirmed", "direct", self) };
    }
    case "other": {
      const m = `My ${t.relation}`;
      const s = `${m} can't have ${t.allergen}`;
      return { text: `${s}.`, item: allergyAt(s, t.allergen, "affirmed", "direct", (at, all) => ({ entityId: null, mention: spanAt(TURN_EID, all, at, at + m.length), isSelf: false })) };
    }
    case "nested": {
      const s = "I'm allergic to nuts, especially cashews";
      return { text: `${s}.`, item: allergyAt(s, "nuts", "affirmed", "direct", self) };
    }
    case "offTable": {
      const s = "I'm allergic to durian";
      return { text: `${s}.`, item: allergyAt(s, "durian", "affirmed", "direct", self) };
    }
    case "mondays":
      return { text: "I'm allergic to Mondays.", item: null };
    case "intolerantBoss":
      return { text: "My boss is so intolerant.", item: null };
    case "allergyPill":
      return { text: "I took an allergy pill this morning.", item: null };
    case "curry": {
      const s = "I'm allergic to something in that curry";
      return { text: `${s}.`, item: allergyAt(s, "something", "uncertain", "direct", self) };
    }
    case "hedge": {
      const s = `I think I might be allergic to ${t.allergen}`;
      return { text: `${s}.`, item: allergyAt(s, t.allergen, "uncertain", "direct", self) };
    }
    case "denial": {
      const s = `I'm not allergic to ${t.allergen}`;
      return { text: `${s}.`, item: allergyAt(s, t.allergen, "denied", "direct", self) };
    }
    case "globalDenial": {
      const s = "I don't have any allergies";
      return { text: `${s}.`, item: allergyAt(s, "any allergies", "denied", "direct", self) };
    }
    case "hypothetical": {
      const s = `If I were allergic to ${t.allergen} I'd know by now`;
      return { text: `${s}.`, item: allergyAt(s, t.allergen, "affirmed", "hypothetical", self) };
    }
    case "epipen":
      return { text: "I always carry an EpiPen.", item: null };
    case "anaphylaxis": {
      const s = `I went into anaphylaxis from ${t.allergen} once`;
      return { text: `${s}.`, item: allergyAt(s, t.allergen, "affirmed", "direct", self) };
    }
    case "answer": {
      const s = `It was the ${t.allergen}`;
      return { text: `${s}.`, item: allergyAt(s, t.allergen, "affirmed", "direct", () => NOBODY) };
    }
    case "noCue": {
      const s = `I can't have ${t.allergen}, I swell up`;
      return { text: `${s}.`, item: allergyAt(s, t.allergen, "affirmed", "direct", self) };
    }
    case "filler":
      return { text: "We watched a film about trains 🚆.", item: null };
  }
}

export function composeTemplates(ts: readonly Template[]): { text: string; items: FastItem[] } {
  let text = "";
  const pending: { at: number; f: Maker }[] = [];
  for (const t of ts) {
    const b = build(t);
    if (text !== "") text += " ";
    if (b.item !== null) pending.push({ at: text.length, f: b.item });
    text += b.text;
  }
  return { text, items: pending.map((p) => p.f(p.at, text)) };
}

/** A pending or active rule fixture with no proof (contracts §1's anonymous shape, or a known subject). */
export function fixtureRule(id: string, subjectId: string | null, code: string, state: "active" | "pending"): AllergyRule {
  return { id: id.padEnd(43, "x").slice(0, 43), subjectId, code, state, anonymous: subjectId === null, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
}

export const PRIOR_RULES = {
  anon: fixtureRule("anonunresolved", null, "unresolved", "pending"),
  anonPeanut: fixtureRule("anonpeanut", null, "peanut", "pending"),
  selfUnresolved: fixtureRule("selfunresolved", "self", "unresolved", "pending"),
  selfShellfish: fixtureRule("selfshellfish", "self", "shellfish", "active"),
} as const;

export const priorRulesArb: fc.Arbitrary<CoreRules> = fc.subarray(Object.keys(PRIOR_RULES) as (keyof typeof PRIOR_RULES)[]).map((keys) => {
  const r = emptyRules();
  for (const k of keys) r.allergies.push({ ...PRIOR_RULES[k] });
  return r;
});

export type SlotsAnswer = { kind: "careful" } | { kind: "empty"; need: Need } | { kind: "failed" };

export const slotsAnswerArb: fc.Arbitrary<SlotsAnswer> = fc.oneof(
  { weight: 5, arbitrary: fc.constant({ kind: "careful" as const }) },
  { weight: 1, arbitrary: fc.constantFrom<Need>("none", "subject", "meaning").map((need) => ({ kind: "empty" as const, need })) },
  { weight: 2, arbitrary: fc.constant({ kind: "failed" as const }) },
);

export const hardRuleTurnArb = fc
  .record({
    templates: fc.array(templateArb, { minLength: 1, maxLength: 4 }),
    changes: fc.array(fc.oneof({ weight: 3, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: itemChangeArb }), { minLength: 8, maxLength: 8 }),
    answer: slotsAnswerArb,
    need: fc.constantFrom<Need>("none", "none", "none", "subject", "meaning"),
    speakerCertain: fc.boolean(),
    candidate: fc.boolean(),
    asked: fc.constantFrom<"no" | "null" | "rule">("no", "no", "null", "rule"),
    rules: priorRulesArb,
  })
  .map((g) => {
    const { text, items: careful } = composeTemplates(g.templates);
    const items = careful.slice(0, 8).map((it, i) => (g.changes[i] === null ? it : changeItem(it, g.changes[i]!, text)));
    const out: FastSlotsOut | null = g.answer.kind === "failed" ? null : g.answer.kind === "empty" ? { items: [], need: g.answer.need } : { items, need: g.need };
    const pending = g.rules.allergies.filter((r) => r.state === "pending");
    const askedRule = g.asked === "rule" ? (pending[0] ?? null) : null;
    const answering = g.asked === "no" ? null : { rule: askedRule };
    return { ...g, text, careful, items, out, answering };
  });
