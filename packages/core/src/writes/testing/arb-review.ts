/**
 * Generators for the four properties of brief 032 (the review of the hard-rule route). Plain module, not guarded.
 *
 * An owner's sentence that affirms an allergy to a gazetteer item, in several shapes (plain, "can't eat ... I'm
 * allergic", "A, not B", "B. A too.", a brother's), with the items a careful model would return for it. The FastSlots
 * answer is any of: the careful items with any change (wrong polarity, act, span or item), some items dropped, an
 * empty answer with any `need`, or no answer at all (invalid or late). Plus one validate-and-plan helper.
 */
import fc from "fast-check";
import type { CoreRules } from "../../schema/records";
import { lookupAllergen } from "../gazetteer";
import { planHardRule } from "../hard-rule";
import type { FastItem, FastSlotsOut, HardRulePlan, Need, Polarity, Subject } from "../types";
import { validateItems } from "../validate";
import { type ItemChange, TURN_AT, TURN_EID, buildEvidence, changeItem, emptyRules, hardRuleTurn, itemChangeArb, personEid, spanAt, validateContext } from "./arb-writes";
import { NAMED } from "./arb-hard-rule";

type Rule = CoreRules["allergies"][number];

export const BROTHER_EID = personEid("brother");
export const SELF: Subject = { entityId: null, mention: null, isSelf: true };
const NOBODY: Subject = { entityId: null, mention: null, isSelf: false };

export type Shape = "plain" | "cantEat" | "notOther" | "tooLater" | "allergyTo" | "brother" | "brotherCantHave";

export interface Stated {
  text: string;
  /** The allergen the sentence affirms, and the subject it is affirmed for ("self" or the brother's EID). */
  allergen: string;
  subject: string;
  /** The items a careful model would return. */
  careful: FastItem[];
}

const at = (text: string, phrase: string, from = 0) => {
  const i = text.indexOf(phrase, from);
  return spanAt(TURN_EID, text, i, i + phrase.length);
};
const allergyItem = (text: string, phrase: string, word: string, polarity: Polarity, subject: Subject): FastItem => ({
  kind: "allergy",
  subject,
  item: word,
  severity: "allergy",
  polarity,
  act: "direct",
  span: at(text, phrase),
});
const brotherSubject = (text: string): Subject => ({ entityId: null, mention: at(text, "My brother"), isSelf: false });

/** One owner's sentence affirming `a` (and naming `b` where the shape needs a second allergen). */
export function stated(shape: Shape, a: string, b: string): Stated {
  switch (shape) {
    case "plain": {
      const t = `I'm allergic to ${a}.`;
      return { text: t, allergen: a, subject: "self", careful: [allergyItem(t, `I'm allergic to ${a}`, a, "affirmed", SELF)] };
    }
    case "cantEat": {
      const t = `I can't eat ${a}, I'm allergic.`;
      return { text: t, allergen: a, subject: "self", careful: [allergyItem(t, `I can't eat ${a}, I'm allergic`, a, "affirmed", SELF)] };
    }
    case "notOther": {
      const t = `I'm allergic to ${a}, not ${b}.`;
      return { text: t, allergen: a, subject: "self", careful: [allergyItem(t, `I'm allergic to ${a}`, a, "affirmed", SELF), allergyItem(t, `not ${b}`, b, "denied", SELF)] };
    }
    case "tooLater": {
      const t = `I'm allergic to ${b}. ${a[0]!.toUpperCase()}${a.slice(1)} too.`;
      const second = `${a[0]!.toUpperCase()}${a.slice(1)} too`;
      return { text: t, allergen: a, subject: "self", careful: [allergyItem(t, `I'm allergic to ${b}`, b, "affirmed", SELF), allergyItem(t, second, a, "affirmed", SELF)] };
    }
    case "allergyTo": {
      const t = `Heads up, I have a bad allergy to ${a}.`;
      return { text: t, allergen: a, subject: "self", careful: [allergyItem(t, `I have a bad allergy to ${a}`, a, "affirmed", SELF)] };
    }
    case "brother": {
      const t = `My brother is allergic to ${a}.`;
      return { text: t, allergen: a, subject: BROTHER_EID, careful: [allergyItem(t, `My brother is allergic to ${a}`, a, "affirmed", brotherSubject(t))] };
    }
    case "brotherCantHave": {
      const t = `My brother can't have ${a}. He's allergic.`;
      return { text: t, allergen: a, subject: BROTHER_EID, careful: [allergyItem(t, `My brother can't have ${a}`, a, "affirmed", brotherSubject(t))] };
    }
  }
}

export const SHAPES: readonly Shape[] = ["plain", "cantEat", "notOther", "tooLater", "allergyTo", "brother", "brotherCantHave"];

/** Two different named allergens with no code in common. */
export const allergenPairArb: fc.Arbitrary<[string, string]> = fc
  .tuple(fc.constantFrom(...NAMED), fc.constantFrom(...NAMED))
  .filter(([a, b]) => {
    const ca = new Set(lookupAllergen(a));
    return a !== b && !lookupAllergen(b).some((c) => ca.has(c)) && ca.size > 0;
  });

/** Any FastSlots answer for `careful`: changed items, dropped items, an empty answer, or none at all. */
export type AnswerSpec = { kind: "none" } | { kind: "empty"; need: Need } | { kind: "items"; need: Need; picks: { keep: boolean; change: ItemChange | null }[]; noSubject: boolean[] };

export const needArb: fc.Arbitrary<Need> = fc.oneof({ weight: 4, arbitrary: fc.constant<Need>("none") }, { weight: 1, arbitrary: fc.constantFrom<Need>("subject", "target", "meaning", "speaker", "time") });

export const answerArb: fc.Arbitrary<AnswerSpec> = fc.oneof(
  { weight: 1, arbitrary: fc.constant({ kind: "none" as const }) },
  { weight: 1, arbitrary: needArb.map((need) => ({ kind: "empty" as const, need })) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("items" as const),
      need: needArb,
      picks: fc.array(fc.record({ keep: fc.boolean(), change: fc.option(itemChangeArb, { freq: 2 }) }), { minLength: 2, maxLength: 2 }),
      noSubject: fc.array(fc.boolean(), { minLength: 2, maxLength: 2 }),
    }),
  },
);

/** The FastSlots answer the spec describes, or null for no answer (invalid or late). */
export function answerFor(spec: AnswerSpec, careful: readonly FastItem[], text: string): FastSlotsOut | null {
  if (spec.kind === "none") return null;
  if (spec.kind === "empty") return { items: [], need: spec.need };
  const items = careful.flatMap((it, i) => {
    const p = spec.picks[i]!;
    if (!p.keep) return [];
    const changed = p.change === null ? it : changeItem(it, p.change, text);
    return [spec.noSubject[i] && changed.kind === "allergy" ? { ...changed, subject: NOBODY } : changed];
  });
  return { items, need: spec.need };
}

/** Prior rules that never name the turn's codes: other people's and other allergens'. */
export function unrelatedPriors(codes: ReadonlySet<string>, picks: readonly number[]): Rule[] {
  const pool: [string, string | null, string, "active" | "pending"][] = [
    ["pkiwi", "self", "kiwi", "active"],
    ["psoy", BROTHER_EID, "soy", "pending"],
    ["plupin", null, "lupin", "pending"],
    ["pmilk", personEid("maya"), "milk", "active"],
    ["psesame", null, "sesame", "pending"],
  ];
  return pool
    .filter((_, i) => picks.includes(i))
    .filter(([, , code]) => !codes.has(code))
    .map(([id, subjectId, code, state]) => ({ id: id.padEnd(43, "x").slice(0, 43), subjectId, code, state, anonymous: subjectId === null, proof: null, proofRev: null, rootKeys: [], dependsOn: [] }));
}

/** Validates and plans one non-answering turn on U text, as the executor does. */
export function planTurn(text: string, out: FastSlotsOut | null, rules: CoreRules, speakerCertain: boolean, answering: { rule: Rule | null } | null = null): HardRulePlan {
  const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
  const verdicts = out === null ? [] : validateItems(out, validateContext(e, { routes: new Set(["hardRule"]), speakerCertain, answering }));
  return planHardRule(rules, verdicts, hardRuleTurn(e, out, { speakerCertain, answering, trigger: { regex: true, candidate: false, asked: answering !== null } }));
}

/** True when `code` is filtered for `subject`: its own rule, an anonymous one, or an `unresolved` filter for either. */
export const filteredFor = (rules: CoreRules, subject: string, code: string): boolean =>
  rules.allergies.some((r) => (r.code === code || r.code === "unresolved") && (r.anonymous || r.subjectId === subject));

export { emptyRules };
