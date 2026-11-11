/**
 * Generators for the slot-tie property of brief 012 (`writes/hard-rule-slots.property.test.ts`). Plain module, not
 * guarded. It reaches what `arb-hard-rule.ts` doesn't: asked rules with a verified proof on a prior Evidence, bare
 * answers ("Yes.", "Me.", "No."), a denial with no subject that names another allergen, pending rules of a second
 * subject and of another code, a drug allergy beside an all-food filter, subject mentions widened over an allergen
 * or over the whole sentence, and a pet whose name is an alias ("My dog").
 */
import fc from "fast-check";
import { rootKey } from "../../ids";
import type { CoreRules } from "../../schema/records";
import type { FastItem, FastSlotsOut, Need, Polarity, Subject } from "../types";
import { testId } from "../../testing/samples";
import { TURN_EID, buildEvidence, emptyRules, hasher, personEid, spanAt } from "./arb-writes";

type AllergyRule = CoreRules["allergies"][number];

/** The earlier turn the prior rules were said on. */
export const ASK_EID = testId("evasked");
export const ASK_AT = "2026-11-10T17:00:00.000Z";
export const ASK_TEXT = "I might be allergic to peanuts. My brother can't have peanuts. Kiwi too maybe. Something in that curry got me. Shellfish, I think.";
export const ASK_EVIDENCE = buildEvidence(ASK_EID, ASK_TEXT, [], ["U"], ASK_AT);
const ASK_ROOT = rootKey(ASK_EVIDENCE.fieldSlices[0]!, hasher);

export const BROTHER = personEid("brother");

const at = (phrase: string) => {
  const i = ASK_TEXT.indexOf(phrase);
  return spanAt(ASK_EID, ASK_TEXT, i, i + phrase.length);
};

function prior(id: string, subjectId: string | null, code: string, state: "active" | "pending", phrase: string | null): AllergyRule {
  return {
    id: testId(id),
    subjectId,
    code,
    state,
    anonymous: subjectId === null,
    proof: phrase === null ? null : at(phrase),
    proofRev: phrase === null ? null : 1,
    rootKeys: phrase === null ? [] : [ASK_ROOT],
    dependsOn: phrase === null ? [] : [`e:${ASK_EID}`],
  };
}

export const ANSWER_PRIORS = {
  anonPeanut: prior("anonpeanut2", null, "peanut", "pending", "peanuts"),
  brotherPeanut: prior("brotherpeanut", BROTHER, "peanut", "pending", "My brother can't have peanuts"),
  anonKiwi: prior("anonkiwi", null, "kiwi", "pending", "Kiwi"),
  selfUnresolved: prior("selfunresolved2", "self", "unresolved", "pending", "Something in that curry got me"),
  anonUnresolved: prior("anonunresolved2", null, "unresolved", "pending", null),
  selfShellfish: prior("selfshellfish2", "self", "shellfish", "pending", "Shellfish"),
  selfMilk: prior("selfmilk", "self", "milk", "active", null),
} as const;

export type PriorKey = keyof typeof ANSWER_PRIORS;

export type AnswerKind =
  | "yes"
  | "me"
  | "myBrother"
  | "no"
  | "nobodyOther"
  | "self"
  | "selfDenial"
  | "brotherHas"
  | "itWas"
  | "drug"
  | "notSure"
  | "wideMention"
  | "wholeMention"
  | "dog";

export const ANSWER_ALLERGENS = ["shellfish", "peanuts", "sesame", "kiwi", "milk", "eggs"] as const;

const NOBODY: Subject = { entityId: null, mention: null, isSelf: false };
const SELF: Subject = { entityId: null, mention: null, isSelf: true };

type Maker = (at: number, all: string, act: FastItem["act"]) => FastItem;

/** One sentence and the item a careful model returns for it; `plainMention` is a short "My X" mention, if any. */
interface Built {
  text: string;
  item: Maker | null;
  plainMention: [number, number] | null;
}

function allergy(len: number, item: string, polarity: Polarity, subject: (at: number, all: string) => Subject): Maker {
  return (start, all, act) => ({ kind: "allergy", subject: subject(start, all), item, severity: "unknown", polarity, act, span: spanAt(TURN_EID, all, start, start + len) });
}

const mention = (from: number, to: number) => (start: number, all: string): Subject => ({ entityId: null, mention: spanAt(TURN_EID, all, start + from, start + to), isSelf: false });

function build(kind: AnswerKind, x: string, y: string): Built {
  const plain = (from: number, to: number): [number, number] => [from, to];
  switch (kind) {
    case "yes":
      return { text: "Yes.", item: allergy(3, "", "affirmed", () => NOBODY), plainMention: null };
    case "me":
      return { text: "Me.", item: allergy(2, "", "affirmed", () => SELF), plainMention: null };
    case "myBrother":
      return { text: "My brother.", item: allergy(10, "", "affirmed", mention(0, 10)), plainMention: plain(0, 10) };
    case "no":
      return { text: "No.", item: allergy(2, "", "denied", () => NOBODY), plainMention: null };
    case "nobodyOther": {
      const s = `Nobody here is allergic to ${x}, no`;
      return { text: `${s}.`, item: allergy(s.length, x, "denied", () => NOBODY), plainMention: null };
    }
    case "self": {
      const s = `I'm definitely allergic to ${x}`;
      return { text: `${s}.`, item: allergy(s.length, x, "affirmed", () => SELF), plainMention: null };
    }
    case "selfDenial": {
      const s = `I'm not allergic to ${x}`;
      return { text: `${s}.`, item: allergy(s.length, x, "denied", () => SELF), plainMention: null };
    }
    case "brotherHas": {
      const s = `My brother can't have ${x}`;
      return { text: `${s}.`, item: allergy(s.length, x, "affirmed", mention(0, 10)), plainMention: plain(0, 10) };
    }
    case "itWas": {
      const s = `It was the ${x}`;
      return { text: `${s}.`, item: allergy(s.length, x, "affirmed", () => NOBODY), plainMention: null };
    }
    case "drug": {
      const s = "I'm allergic to penicillin";
      return { text: `${s}.`, item: allergy(s.length, "penicillin", "affirmed", () => SELF), plainMention: null };
    }
    case "notSure":
      return { text: "Not sure about that.", item: null, plainMention: null };
    case "wideMention": {
      const m = `My brother with the ${y} allergy`;
      const s = `${m} can't have ${x} either`;
      return { text: `${s}.`, item: allergy(s.length, x, "affirmed", mention(0, m.length)), plainMention: null };
    }
    case "wholeMention": {
      const s = `I'm allergic to ${x}`;
      return { text: `${s}.`, item: allergy(s.length, x, "affirmed", mention(0, s.length)), plainMention: null };
    }
    case "dog": {
      const s = `My dog can't have ${x}`;
      return { text: `${s}.`, item: allergy(s.length, x, "affirmed", mention(0, 6)), plainMention: plain(0, 6) };
    }
  }
}

const sentenceArb = fc.record({
  kind: fc.constantFrom<AnswerKind>("yes", "me", "myBrother", "no", "nobodyOther", "self", "selfDenial", "brotherHas", "itWas", "drug", "notSure", "wideMention", "wholeMention", "dog"),
  x: fc.constantFrom(...ANSWER_ALLERGENS),
  y: fc.constantFrom(...ANSWER_ALLERGENS),
  act: fc.constantFrom<FastItem["act"]>("direct", "direct", "direct", "quoted", "hypothetical", "uncertain"),
});

export const answerTurnArb = fc
  .record({
    sentences: fc.array(sentenceArb, { minLength: 1, maxLength: 3 }),
    priors: fc.subarray(Object.keys(ANSWER_PRIORS) as PriorKey[], { minLength: 1 }),
    asked: fc.oneof(fc.constant<"no" | "null">("no"), fc.constant<"no" | "null">("null"), fc.nat(6)),
    answer: fc.constantFrom<"careful" | "empty" | "failed">("careful", "careful", "careful", "careful", "empty", "failed"),
    need: fc.constantFrom<Need>("none", "none", "none", "none", "subject", "meaning"),
    speakerCertain: fc.constantFrom(true, true, true, false),
    candidate: fc.boolean(),
  })
  .map((g) => {
    // The text first, then each item on the whole text.
    const parts = g.sentences.map((s) => ({ s, b: build(s.kind, s.x, s.y) }));
    const starts: number[] = [];
    let text = "";
    for (const { b } of parts) {
      if (text !== "") text += " ";
      starts.push(text.length);
      text += b.text;
    }
    const items: FastItem[] = [];
    const plainMentions: [number, number][] = [];
    parts.forEach(({ s, b }, i) => {
      const start = starts[i]!;
      if (b.plainMention !== null) plainMentions.push([start + b.plainMention[0], start + b.plainMention[1]]);
      if (b.item !== null) items.push(b.item(start, text, s.act));
    });
    const rules = emptyRules();
    for (const k of g.priors) rules.allergies.push({ ...ANSWER_PRIORS[k] });
    const pending = rules.allergies.filter((r) => r.state === "pending");
    const askedRule = typeof g.asked === "number" && pending.length > 0 ? pending[g.asked % pending.length]! : null;
    const answering = g.asked === "no" ? null : { rule: askedRule };
    const out: FastSlotsOut | null = g.answer === "failed" ? null : g.answer === "empty" ? { items: [], need: g.need } : { items: items.slice(0, 8), need: g.need };
    return { ...g, text, out, rules, answering, plainMentions };
  });
