// Brief 043, finding 3: the W-187 guard removed a pending allergy rule on a wrong `denied`. Each line answers the
// asked pending self-peanut rule with the model saying `denied`; each must keep the rule and ask again.
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { DENIAL_LEADS, DENIAL_POINTERS, WHOLE_DENIALS, affirmsAllergen, isWholeDenial } from "./denial-words";
import { planHardRule } from "./hard-rule";
import { TURN_AT, TURN_EID, buildEvidence, emptyRules, hardRuleTurn, spanAt, validateContext } from "./testing/arb-writes";
import type { FastItem, FastSlotsOut, Subject } from "./types";
import { validateItems } from "./validate";

type Rule = CoreRules["allergies"][number];
const SELF: Subject = { entityId: null, mention: null, isSelf: true };
const NOBODY: Subject = { entityId: null, mention: null, isSelf: false };
const pending: Rule = { id: "r043selfpeanut".padEnd(43, "x"), subjectId: "self", code: "peanut", state: "pending", anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
const anon: Rule = { ...pending, id: "r043anonpeanut".padEnd(43, "x"), subjectId: null, anonymous: true };

function answer(text: string, spanText: string, word: string, subject: Subject = SELF, R: Rule = pending) {
  const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
  const i = text.indexOf(spanText);
  const item: FastItem = { kind: "allergy", subject, item: word, severity: "allergy", polarity: "denied", act: "direct", span: spanAt(TURN_EID, text, i, i + spanText.length) };
  const out: FastSlotsOut = { items: [item], need: "none" };
  const answering = { rule: R };
  const verdicts = validateItems(out, validateContext(e, { routes: new Set(["hardRule"]), speakerCertain: true, answering }));
  return planHardRule({ ...emptyRules(), allergies: [R] }, verdicts, hardRuleTurn(e, out, { speakerCertain: true, answering, trigger: { regex: true, candidate: false, asked: true } }));
}
const kept = (p: ReturnType<typeof answer>, R: Rule = pending) => p.rules.allergies.some((r) => r.id === R.id);

describe("finding 3: the reviewer's lines keep the pending rule", () => {
  it("\"No, I'm allergic to it, and to shrimp too.\" (span \"No, I'm allergic to it\")", () => {
    const t = "No, I'm allergic to it, and to shrimp too.";
    const p = answer(t, "No, I'm allergic to it", "");
    expect(kept(p)).toBe(true);
    // Coverage files the shrimp as a new pending rule, so the one question this turn is about it.
    expect(p.note.some((n) => n.startsWith("ask."))).toBe(true);
  });
  it("\"No joke, I'd end up in the ER.\"", () => {
    const t = "No joke, I'd end up in the ER.";
    const p = answer(t, t.slice(0, -1), "");
    expect(kept(p)).toBe(true);
    expect(p.reask).toBe(pending.id);
  });
  it("\"No, it's way worse than a dislike. I swell up.\"", () => {
    const t = "No, it's way worse than a dislike. I swell up.";
    const p = answer(t, "No, it's way worse than a dislike", "");
    expect(kept(p)).toBe(true);
    expect(p.reask).toBe(pending.id);
  });
});

describe("finding 3: a whole denial still clears the asked rule", () => {
  for (const t of ["No.", "Nope.", "No, I'm not.", "No, I'm not allergic.", "I'm not allergic to peanuts.", "No, I'm not allergic to peanuts.", "No, I'm not allergic to that."]) {
    it(t, () => {
      expect(kept(answer(t, t.slice(0, -1), /peanut/.test(t) ? "peanuts" : ""))).toBe(false);
    });
  }
  it("\"No.\" answering an anonymous pending rule", () => {
    expect(kept(answer("No.", "No", "", NOBODY, anon), anon)).toBe(false);
  });
});

describe("isWholeDenial: the closed list, as a whole utterance", () => {
  it("holds the forms the ruling names", () => {
    for (const lead of ["no", "nope"]) expect(DENIAL_LEADS).toContain(lead);
    expect(WHOLE_DENIALS).toContain("i'm not allergic to {X}");
    expect(DENIAL_POINTERS).toContain("it");
  });
  it("accepts a closed form with nothing else, for the asked allergen or a pointer to it", () => {
    for (const t of ["No.", "Nope.", "No, I'm not.", "No, I'm not allergic.", "I'm not allergic to peanuts.", "no i am not allergic to peanut", "Nope, not allergic to that.", "Nah."]) expect(isWholeDenial(t, "peanut"), t).toBe(true);
  });
  it("refuses anything else in the answer, another allergen, or a different shape", () => {
    for (const t of [
      "No, I'm allergic to it, and to shrimp too.",
      "No joke, I'd end up in the ER.",
      "No, it's way worse than a dislike. I swell up.",
      "I'm not allergic to shrimp.",
      "No. I'm allergic to peanuts.",
      "No, but my brother is.",
      "Not mine.",
      "Yes.",
      "",
    ])
      expect(isWholeDenial(t, "peanut"), t).toBe(false);
  });
});

describe("affirmsAllergen: a cue on \"it\", \"that\", \"them\" or the asked allergen always affirms", () => {
  it("whatever else the sentence names", () => {
    expect(affirmsAllergen("No, I'm allergic to it, and to shrimp too.", "peanut")).toBe(true);
    expect(affirmsAllergen("I'm allergic to that and to shrimp.", "peanut")).toBe(true);
    expect(affirmsAllergen("I'm allergic to peanuts and shrimp.", "peanut")).toBe(true);
    expect(affirmsAllergen("No. I'm allergic to shellfish.", "peanut")).toBe(false);
  });
});
