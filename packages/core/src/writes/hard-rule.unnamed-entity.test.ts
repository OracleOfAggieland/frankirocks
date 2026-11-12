// Brief 043, coordinator follow-up to item 1 (W-231): a model entityId chooses whose allergy it is only when the
// owner's own sentence names that person. "I'm allergic to peanuts." with entityId set to a stored brother writes no
// rule for the brother, and the owner stays filtered for peanuts.
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { planHardRule } from "./hard-rule";
import { BROTHER_EID } from "./testing/arb-review";
import { ENTITIES, KNOWN, TURN_AT, TURN_EID, buildEvidence, emptyRules, hardRuleTurn, spanAt, validateContext } from "./testing/arb-writes";
import type { FastItem, FastSlotsOut, Subject } from "./types";
import { validateItems } from "./validate";

const known = { entries: [...KNOWN.entries, { id: BROTHER_EID, kind: "person" as const, label: "Sam", aliases: ["brother"], relation: "brother" }] };
const entities = [...ENTITIES, { id: BROTHER_EID, label: "Sam", aliases: ["brother"] }];

function plan(text: string, subject: Subject, rules: CoreRules = emptyRules()) {
  const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
  const w = text.match(/peanuts/)!;
  const item: FastItem = { kind: "allergy", subject, item: "peanuts", severity: "allergy", polarity: "affirmed", act: "direct", span: spanAt(TURN_EID, text, 0, w.index! + w[0].length) };
  const out: FastSlotsOut = { items: [item], need: "none" };
  const verdicts = validateItems(out, validateContext(e, { routes: new Set(["hardRule"]), known, entities }));
  return planHardRule(rules, verdicts, hardRuleTurn(e, out, { speakerCertain: true, answering: null, trigger: { regex: true, candidate: false, asked: false } })).rules;
}
const filtered = (r: CoreRules, s: string) => r.allergies.some((x) => (x.code === "peanut" || x.code === "unresolved") && (x.anonymous || x.subjectId === s));

describe("an entityId the owner's sentence doesn't name chooses no one (W-231)", () => {
  it("\"I'm allergic to peanuts.\" with entityId = the stored brother: no rule for him, the owner filtered for peanuts", () => {
    const r = plan("I'm allergic to peanuts.", { entityId: BROTHER_EID, mention: null, isSelf: false });
    expect(r.allergies.filter((x) => x.subjectId === BROTHER_EID)).toEqual([]);
    expect(filtered(r, "self")).toBe(true);
  });
  it("\"My brother is allergic to peanuts.\" with his entityId: his rule, as before", () => {
    const r = plan("My brother is allergic to peanuts.", { entityId: BROTHER_EID, mention: null, isSelf: false });
    expect(r.allergies.some((x) => x.subjectId === BROTHER_EID && x.code === "peanut")).toBe(true);
  });
  it("\"Sam is allergic to peanuts.\" with his entityId: his rule", () => {
    const r = plan("Sam is allergic to peanuts.", { entityId: BROTHER_EID, mention: null, isSelf: false });
    expect(r.allergies.some((x) => x.subjectId === BROTHER_EID && x.code === "peanut")).toBe(true);
  });
  it("\"My friend's brother is allergic to peanuts.\" with his entityId: no rule for him", () => {
    const r = plan("My friend's brother is allergic to peanuts.", { entityId: BROTHER_EID, mention: null, isSelf: false });
    expect(r.allergies.filter((x) => x.subjectId === BROTHER_EID)).toEqual([]);
  });
});
