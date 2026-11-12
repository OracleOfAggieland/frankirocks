/**
 * Answers whose `item` names nothing on its own but whose span names something else, for property 4f of brief 018
 * task 0 (`writes/hard-rule-span-answers.property.test.ts`). Plain module, not guarded. Each case is one certain,
 * direct, one-item answer to an asked pending rule R with a gazetteer code. The span holds another allergen alias, a
 * word the gazetteer doesn't know, or an otherness word ("the other thing"); the item is the head noun, the cue
 * word, "nobody", or empty (report 012, "Open before wave B", item 1).
 */
import fc from "fast-check";
import { REGEX_TABLE, normalizeForRegex } from "../../intents/regex";
import { lookupAllergen } from "../gazetteer";
import { planHardRule } from "../hard-rule";
import type { FastItem, Polarity, Subject } from "../types";
import { validateItems } from "../validate";
import { ANSWER_PRIORS, type PriorKey } from "./arb-hard-rule-answers";
import { TURN_AT, TURN_EID, buildEvidence, emptyRules, hardRuleTurn, spanAt, validateContext } from "./arb-writes";

const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;

/** What the span names besides the item: [words, head noun or null]. */
export const OTHERS: readonly [string, string | null][] = [
  ["shellfish", null],
  ["sesame", null],
  ["kiwi", null],
  ["milk", null],
  ["peanuts", null],
  ["durian", null],
  ["the other thing", "thing"],
  ["that other stuff", "stuff"],
  ["another thing", "thing"],
  ["a different thing", "thing"],
  ["something else", null],
  ["some other food", "food"],
];

/** Sentence frames: {X} is the other thing named. */
export const FRAMES: readonly { text: string; polarity: Polarity; who: "self" | "nobody" | "brother" }[] = [
  { text: "Yes, I'm allergic to {X}.", polarity: "affirmed", who: "self" },
  { text: "I'm allergic to {X}, yes.", polarity: "affirmed", who: "self" },
  { text: "My brother is allergic to {X} too.", polarity: "affirmed", who: "brother" },
  { text: "No, I'm not allergic to {X}.", polarity: "denied", who: "self" },
  { text: "Nobody here is allergic to {X}, no.", polarity: "denied", who: "nobody" },
  { text: "No, nobody is allergic to {X}.", polarity: "denied", who: "nobody" },
];

export type ItemPick = "head" | "cue" | "nobody" | "empty";
const ASKABLE: readonly PriorKey[] = ["anonPeanut", "brotherPeanut", "anonKiwi", "selfShellfish"];

export interface SpanCase {
  frame: number;
  other: number;
  item: ItemPick;
  asked: PriorKey;
  others: PriorKey[];
}

export const spanCaseArb: fc.Arbitrary<SpanCase> = fc.record({
  frame: fc.nat(FRAMES.length - 1),
  other: fc.nat(OTHERS.length - 1),
  item: fc.constantFrom<ItemPick>("head", "cue", "nobody", "empty"),
  asked: fc.constantFrom(...ASKABLE),
  others: fc.subarray(Object.keys(ANSWER_PRIORS) as PriorKey[]),
});

/** One answering turn, validated and planned as the executor will; null when the case names R's own allergen. */
export function runSpanCase(c: SpanCase) {
  const R = { ...ANSWER_PRIORS[c.asked] };
  const frame = FRAMES[c.frame]!;
  const [other, head] = OTHERS[c.other]!;
  if (lookupAllergen(other).includes(R.code)) return null;
  const text = frame.text.replace("{X}", other);
  const cue = text.match(/allergic/)![0];
  const item = c.item === "head" ? (head ?? cue) : c.item === "cue" ? cue : c.item === "nobody" ? (/nobody/i.test(text) ? "nobody" : cue) : "";
  let subject: Subject = { entityId: null, mention: null, isSelf: frame.who === "self" };
  if (frame.who === "brother") subject = { entityId: null, mention: spanAt(TURN_EID, text, 0, "My brother".length), isSelf: false };
  const rules = emptyRules();
  rules.allergies.push(R);
  for (const k of c.others) if (k !== c.asked) rules.allergies.push({ ...ANSWER_PRIORS[k] });
  const phrase = text.replace(/[.!?]$/, "");
  const fi: FastItem = { kind: "allergy", subject, item, severity: "allergy", polarity: frame.polarity, act: "direct", span: spanAt(TURN_EID, text, 0, phrase.length) };
  const evidence = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
  const answering = { rule: R };
  const out = { items: [fi], need: "none" as const };
  const verdicts = validateItems(out, validateContext(evidence, { routes: new Set(["hardRule"]), speakerCertain: true, answering }));
  const trigger = { regex: RX4.test(normalizeForRegex(text)), candidate: true, asked: true };
  const plan = planHardRule(rules, verdicts, hardRuleTurn(evidence, out, { trigger, speakerCertain: true, answering }));
  const before = new Set(rules.allergies.map((r) => r.id));
  const added = plan.rules.allergies.filter((r) => !before.has(r.id));
  const what = `"${text}" (item "${item}") asked ${c.asked}`;
  return { R, v: verdicts[0]!, plan, added, what };
}
