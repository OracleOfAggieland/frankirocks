// Brief 025, question W-187: the model's polarity alone never removes a rule. A denial resolves a stored rule only
// as the asked rule this turn answers, with a denial in the owner's words and no affirming cue for that allergen.
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { planHardRule } from "./hard-rule";
import { affirmsAllergen, hasDenialForm } from "./denial-words";
import { TURN_AT, TURN_EID, buildEvidence, emptyRules, hardRuleTurn, spanAt, validateContext } from "./testing/arb-writes";
import type { FastItem, FastSlotsOut, Subject } from "./types";
import { validateItems } from "./validate";

type Rule = CoreRules["allergies"][number];

function plan(text: string, items: FastItem[], rules: CoreRules, answering: { rule: Rule | null } | null = null) {
  const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
  const out: FastSlotsOut = { items, need: "none" };
  const verdicts = validateItems(out, validateContext(e, { routes: new Set(["hardRule"]), speakerCertain: true, answering }));
  return planHardRule(rules, verdicts, hardRuleTurn(e, out, { speakerCertain: true, answering, trigger: { regex: true, candidate: false, asked: answering !== null } }));
}

const SELF: Subject = { entityId: null, mention: null, isSelf: true };
const NOBODY: Subject = { entityId: null, mention: null, isSelf: false };
const whole = (text: string) => spanAt(TURN_EID, text, 0, text.length - 1);
const item = (text: string, word: string, polarity: "affirmed" | "denied", subject: Subject = SELF): FastItem => ({ kind: "allergy", subject, item: word, severity: "allergy", polarity, act: "direct", span: whole(text) });

const rule = (anonymous: boolean, code: string, state: "pending" | "active" = "pending"): Rule => ({
  id: `w187${anonymous ? "a" : "s"}${code}`.padEnd(43, "x").slice(0, 43),
  subjectId: anonymous ? null : "self",
  code,
  state,
  anonymous,
  proof: null,
  proofRev: null,
  rootKeys: [],
  dependsOn: [],
});
const withRules = (...rs: Rule[]): CoreRules => ({ ...emptyRules(), allergies: rs });
const has = (rules: CoreRules, id: string) => rules.allergies.some((r) => r.id === id);

describe("W-187: a wrong denial never removes a pending rule", () => {
  const pending = rule(false, "peanut");

  it("off an answering turn, \"I can't eat peanuts, I'm allergic.\" marked denied keeps the owner's pending peanut rule", () => {
    const t = "I can't eat peanuts, I'm allergic.";
    const p = plan(t, [item(t, "peanuts", "denied")], withRules(pending));
    expect(has(p.rules, pending.id)).toBe(true);
  });

  it("answering the asked rule, the same wrong denial keeps it", () => {
    const t = "I can't eat peanuts, I'm allergic.";
    const p = plan(t, [item(t, "peanuts", "denied")], withRules(pending), { rule: pending });
    expect(has(p.rules, pending.id)).toBe(true);
  });

  it("off an answering turn, a true denial keeps the pending rule and asks about it again", () => {
    const t = "I'm not allergic to peanuts.";
    const p = plan(t, [item(t, "peanuts", "denied")], withRules(pending));
    expect(has(p.rules, pending.id)).toBe(true);
    expect(p.reask).toBe(pending.id);
    expect(p.note).toContain("ask.isAllergy");
  });

  it("off an answering turn, \"I don't have any allergies.\" keeps the pending rule", () => {
    const t = "I don't have any allergies.";
    const p = plan(t, [item(t, "allergies", "denied")], withRules(pending));
    expect(has(p.rules, pending.id)).toBe(true);
  });
});

describe("W-187: a true \"no\" to the asked question still clears it", () => {
  it("\"No.\" answering the owner's pending peanut rule removes it", () => {
    const pending = rule(false, "peanut");
    const t = "No.";
    const p = plan(t, [item(t, "", "denied", NOBODY)], withRules(pending), { rule: pending });
    expect(has(p.rules, pending.id)).toBe(false);
    expect(p.outcome.kind).toBe("pendingResolved");
  });

  it("\"I'm not allergic to peanuts.\" answering the owner's pending peanut rule removes it", () => {
    const pending = rule(false, "peanut");
    const t = "I'm not allergic to peanuts.";
    const p = plan(t, [item(t, "peanuts", "denied")], withRules(pending), { rule: pending });
    expect(has(p.rules, pending.id)).toBe(false);
  });

  it("\"No.\" answering an anonymous pending rule removes it", () => {
    const anon = rule(true, "peanut");
    const t = "No.";
    const p = plan(t, [item(t, "", "denied", NOBODY)], withRules(anon), { rule: anon });
    expect(has(p.rules, anon.id)).toBe(false);
  });

  it("an active rule is never removed, asked or not", () => {
    const active = rule(false, "peanut", "active");
    const t = "I'm not allergic to peanuts.";
    const p = plan(t, [item(t, "peanuts", "denied")], withRules(active));
    expect(has(p.rules, active.id)).toBe(true);
  });
});

describe("W-187: a denial and an affirmation in one turn keep the rule, and Franki asks again", () => {
  it("\"No, I'm allergic to peanuts.\" marked denied, answering the asked rule", () => {
    const pending = rule(false, "peanut");
    const t = "No, I'm allergic to peanuts.";
    const p = plan(t, [item(t, "peanuts", "denied")], withRules(pending), { rule: pending });
    expect(has(p.rules, pending.id)).toBe(true);
    expect(p.reask).toBe(pending.id);
    expect(p.note).toContain("ask.isAllergy");
  });

  it("\"No, I'm allergic to peanuts.\" answering an anonymous pending peanut rule", () => {
    const anon = rule(true, "peanut");
    const t = "No, I'm allergic to peanuts.";
    const p = plan(t, [item(t, "", "denied", NOBODY)], withRules(anon), { rule: anon });
    expect(has(p.rules, anon.id)).toBe(true);
  });
});

describe("W-187: the closed word lists", () => {
  it("sees a denial in the closed forms and nowhere else", () => {
    for (const t of ["No.", "Nope, not allergic.", "I'm not allergic to peanuts.", "She isn't allergic.", "I don't have any allergies.", "No allergy.", "Not mine.", "I outgrew it."]) expect(hasDenialForm(t), t).toBe(true);
    for (const t of ["I can't eat peanuts, I'm allergic.", "Peanuts.", "Yes.", "Maybe."]) expect(hasDenialForm(t), t).toBe(false);
  });

  it("sees an affirming cue for the allergen, or for no named allergen, and not a negated one", () => {
    expect(affirmsAllergen("I can't eat peanuts, I'm allergic.", "peanut")).toBe(true);
    expect(affirmsAllergen("No, I'm allergic to peanuts.", "peanut")).toBe(true);
    expect(affirmsAllergen("I'm not allergic, I just can't eat peanuts.", "peanut")).toBe(true);
    expect(affirmsAllergen("I'm allergic.", "peanut")).toBe(true);
    expect(affirmsAllergen("I'm not allergic to peanuts.", "peanut")).toBe(false);
    expect(affirmsAllergen("I don't have any allergies.", "peanut")).toBe(false);
    expect(affirmsAllergen("No. I'm allergic to shellfish.", "peanut")).toBe(false);
    expect(affirmsAllergen("No. I'm allergic to shellfish.", "unresolved")).toBe(true);
  });
});
