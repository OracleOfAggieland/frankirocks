/**
 * Plain answers to Franki's own allergy question, for properties 4d and 4e of brief 012
 * (`writes/hard-rule-mine-answers.property.test.ts`, `writes/hard-rule-plain-answers.property.test.ts`). Plain module,
 * not guarded. Each case is one certain, direct, one-item answer to an asked pending rule from `ANSWER_PRIORS`,
 * validated and planned as the executor will. The lines are the ones a careful copy from the span gives when no
 * allergen is named (CQ 160).
 */
import fc from "fast-check";
import { REGEX_TABLE, normalizeForRegex } from "../../intents/regex";
import { planHardRule } from "../hard-rule";
import type { FastItem, ItemVerdict, Polarity, Subject } from "../types";
import { validateItems } from "../validate";
import { ANSWER_PRIORS, type PriorKey } from "./arb-hard-rule-answers";
import { TURN_AT, TURN_EID, buildEvidence, emptyRules, hardRuleTurn, spanAt, validateContext } from "./arb-writes";

const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;
const SELF: Subject = { entityId: null, mention: null, isSelf: true };
const NOBODY: Subject = { entityId: null, mention: null, isSelf: false };

/** Each line with the item a careful copy gives. */
export const SELF_AFFIRM: readonly [string, string][] = [
  ["Yes, I am allergic to that stuff.", "that stuff"],
  ["Yes, I'm allergic.", "allergic"],
  ["Yes, I have that allergy.", "that allergy"],
  ["I'm the one who's allergic.", "allergic"],
  ["Yes, I'm allergic to all of it.", "all of it"],
  ["Yes, I'm allergic to both.", "both"],
];
export const SELF_DENY: readonly [string, string][] = [
  ["No, I'm not allergic to that stuff.", "that stuff"],
  ["No, I'm not allergic to any of that.", "any of that"],
  ["No, I'm not allergic to those things.", "those things"],
  ["I'm not allergic to either.", "either"],
  ["No, I'm not allergic.", "allergic"],
  ["No, I don't have that allergy.", "that allergy"],
  ["No, I'm not allergic to that kind of thing.", "that kind of thing"],
];
export const NOBODY_DENY: readonly [string, string][] = [
  ["No, nobody has that allergy.", "that allergy"],
  ["No, nobody's allergic.", "allergic"],
  ["No, nobody is allergic to that stuff.", "that stuff"],
  ["No, nobody is allergic to either.", "either"],
];
export const NEG_MINE = ["Not mine.", "It's not mine.", "That's not mine.", "No, not mine.", "It isn't mine."] as const;
export const AFF_MINE = ["Mine.", "Mine too.", "Definitely mine.", "That one's mine.", "The allergy is mine.", "Mine, actually."] as const;
export const SOMEONE_DENY = ["My brother doesn't.", "No, not my sister.", "She isn't.", "Not my dad, no.", "No, my friend doesn't have it."] as const;

export type PlainKind = "selfAffirm" | "selfDeny" | "nobodyDeny" | "negMine" | "affMine" | "someoneDeny";
const ASKABLE: readonly PriorKey[] = ["anonPeanut", "brotherPeanut", "anonKiwi", "selfUnresolved", "anonUnresolved", "selfShellfish"];

export interface PlainCase {
  kind: PlainKind;
  pick: number;
  emptyItem: boolean;
  selfSubject: boolean;
  asked: PriorKey;
  others: PriorKey[];
  candidate: boolean;
}

export const plainCaseArb = (kinds: readonly PlainKind[]): fc.Arbitrary<PlainCase> =>
  fc.record({
    kind: fc.constantFrom(...kinds),
    pick: fc.nat(40),
    emptyItem: fc.boolean(),
    selfSubject: fc.boolean(),
    asked: fc.constantFrom(...ASKABLE),
    others: fc.subarray(Object.keys(ANSWER_PRIORS) as PriorKey[]),
    candidate: fc.boolean(),
  });

function lineOf(c: PlainCase): { text: string; item: string; polarity: Polarity; subject: Subject } {
  const from = <T>(xs: readonly T[]): T => xs[c.pick % xs.length]!;
  switch (c.kind) {
    case "selfAffirm": {
      const [text, item] = from(SELF_AFFIRM);
      return { text, item: c.emptyItem ? "" : item, polarity: "affirmed", subject: SELF };
    }
    case "selfDeny": {
      const [text, item] = from(SELF_DENY);
      return { text, item: c.emptyItem ? "" : item, polarity: "denied", subject: SELF };
    }
    case "nobodyDeny": {
      const [text, item] = from(NOBODY_DENY);
      return { text, item: c.emptyItem ? "" : item, polarity: "denied", subject: NOBODY };
    }
    case "negMine":
      return { text: from(NEG_MINE), item: "", polarity: "denied", subject: c.selfSubject ? SELF : NOBODY };
    case "affMine":
      return { text: from(AFF_MINE), item: "", polarity: "affirmed", subject: c.selfSubject ? SELF : NOBODY };
    case "someoneDeny":
      return { text: from(SOMEONE_DENY), item: "", polarity: "denied", subject: NOBODY };
  }
}

/** One answering turn, validated and planned as the executor will. */
export function runPlainCase(c: PlainCase) {
  const R = { ...ANSWER_PRIORS[c.asked] };
  const rules = emptyRules();
  rules.allergies.push(R);
  for (const k of c.others) if (k !== c.asked) rules.allergies.push({ ...ANSWER_PRIORS[k] });
  const line = lineOf(c);
  const phrase = line.text.replace(/[.!?]$/, "");
  const item: FastItem = { kind: "allergy", subject: line.subject, item: line.item, severity: "allergy", polarity: line.polarity, act: "direct", span: spanAt(TURN_EID, line.text, 0, phrase.length) };
  const evidence = buildEvidence(TURN_EID, line.text, [], ["U"], TURN_AT);
  const answering = { rule: R };
  const out = { items: [item], need: "none" as const };
  const verdicts = validateItems(out, validateContext(evidence, { routes: new Set(["hardRule"]), speakerCertain: true, answering }));
  const trigger = { regex: RX4.test(normalizeForRegex(line.text)), candidate: c.candidate, asked: true };
  const plan = planHardRule(rules, verdicts, hardRuleTurn(evidence, out, { trigger, speakerCertain: true, answering }));
  const before = new Set(rules.allergies.map((r) => r.id));
  const added = plan.rules.allergies.filter((r) => !before.has(r.id));
  const what = `"${line.text}" (item "${line.item}", ${line.subject.isSelf ? "isSelf" : "no subject"}) asked ${c.asked}`;
  return { R, line, v: verdicts[0]!, plan, added, what };
}

/** Whether a verdict carries the code, or answers or keeps the rule. */
export function carriesOrAnswers(v: ItemVerdict, code: string, ruleId: string): boolean {
  if (v.kind !== "allergy") return false;
  const a = v.v;
  if (a.kind === "affirm") return a.codes.includes(code);
  if (a.kind === "unsure") return a.codes !== "unresolved" && a.codes.includes(code);
  if (a.kind === "deny") return "answers" in a ? a.answers === ruleId : "codes" in a && a.codes.includes(code);
  return a.kind === "pendingKept" && a.ruleId === ruleId;
}
