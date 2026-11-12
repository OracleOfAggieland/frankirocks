// Brief 032: the review of the hard-rule route. The reviewer's inputs, as unit cases, one block per finding.
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { planHardRule } from "./hard-rule";
import { TURN_AT, TURN_EID, buildEvidence, emptyRules, hardRuleTurn, spanAt, validateContext } from "./testing/arb-writes";
import type { FastItem, FastSlotsOut, Subject } from "./types";
import { validateItems } from "./validate";

type Rule = CoreRules["allergies"][number];

/** Validates and plans one turn, as the executor does. */
function plan(text: string, items: FastItem[] | null, rules: CoreRules = emptyRules(), over: { speakerCertain?: boolean; answering?: { rule: Rule | null } | null; need?: FastSlotsOut["need"] } = {}) {
  const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
  const out: FastSlotsOut | null = items === null ? null : { items, need: over.need ?? "none" };
  const speakerCertain = over.speakerCertain ?? true;
  const answering = over.answering ?? null;
  const verdicts = out === null ? [] : validateItems(out, validateContext(e, { routes: new Set(["hardRule"]), speakerCertain, answering }));
  return planHardRule(rules, verdicts, hardRuleTurn(e, out, { speakerCertain, answering, trigger: { regex: true, candidate: false, asked: answering !== null } }));
}

const SELF: Subject = { entityId: null, mention: null, isSelf: true };
const at = (text: string, phrase: string) => spanAt(TURN_EID, text, text.indexOf(phrase), text.indexOf(phrase) + phrase.length);
const item = (text: string, phrase: string, word: string, polarity: "affirmed" | "denied" | "uncertain", subject: Subject = SELF): FastItem => ({
  kind: "allergy",
  subject,
  item: word,
  severity: "allergy",
  polarity,
  act: "direct",
  span: at(text, phrase),
});

/** True when `code` is filtered for `subject`: its own rule, an anonymous one, or an `unresolved` filter for either. */
export const filtered = (rules: CoreRules, subject: string | null, code: string): boolean =>
  rules.allergies.some((r) => (r.code === code || r.code === "unresolved") && (r.anonymous || r.subjectId === subject));

describe("H1: a wrong polarity never loses a stated allergy", () => {
  it("\"I can't eat peanuts, I'm allergic.\" with peanut marked denied still filters peanut", () => {
    const t = "I can't eat peanuts, I'm allergic.";
    const p = plan(t, [item(t, "I can't eat peanuts, I'm allergic", "peanuts", "denied")]);
    expect(filtered(p.rules, "self", "peanut")).toBe(true);
  });

  it("\"I'm allergic to peanuts, not shellfish\" with peanut marked denied still filters peanut", () => {
    const t = "I'm allergic to peanuts, not shellfish.";
    const p = plan(t, [item(t, "I'm allergic to peanuts, not shellfish", "peanuts", "denied"), item(t, "not shellfish", "shellfish", "denied")]);
    expect(filtered(p.rules, "self", "peanut")).toBe(true);
  });

  it("a denial naming an unknown thing never switches the fallback off", () => {
    const t = "I can't have that, I'm allergic.";
    const p = plan(t, [item(t, "I can't have that, I'm allergic", "that", "denied")]);
    expect(filtered(p.rules, "self", "peanut")).toBe(true);
  });

  it("an uncertain speaker's wrong polarity still filters the code for anyone", () => {
    const t = "I can't eat peanuts, I'm allergic.";
    const p = plan(t, [item(t, "I can't eat peanuts, I'm allergic", "peanuts", "denied")], emptyRules(), { speakerCertain: false });
    expect(filtered(p.rules, null, "peanut")).toBe(true);
  });

  it("a denial that reaches a slot still carries its code: an active rule is kept, a pending one resolved", () => {
    const t = "I'm not allergic to peanuts.";
    const active: Rule = { id: "a".repeat(43), subjectId: "self", code: "peanut", state: "active", anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
    const kept = plan(t, [item(t, "I'm not allergic to peanuts", "peanuts", "denied")], { ...emptyRules(), allergies: [active] });
    expect(kept.rules.allergies).toEqual([active]);
    expect(kept.outcome).toMatchObject({ kind: "ruleKept", why: "denied" });
    const pending: Rule = { ...active, id: "p".repeat(43), state: "pending" };
    const resolved = plan(t, [item(t, "I'm not allergic to peanuts", "peanuts", "denied")], { ...emptyRules(), allergies: [pending] });
    expect(resolved.outcome).toEqual({ kind: "pendingResolved", ruleIds: [pending.id], by: "denial" });
    expect(resolved.rules.allergies).toEqual([]);
  });
});

describe("H2: coverage reads on past the cue sentence", () => {
  it("\"I'm allergic to peanuts. Shellfish too.\" with peanut only: shellfish gets a slot", () => {
    const t = "I'm allergic to peanuts. Shellfish too.";
    const p = plan(t, [item(t, "I'm allergic to peanuts", "peanuts", "affirmed")]);
    expect(filtered(p.rules, "self", "peanut")).toBe(true);
    expect(filtered(p.rules, "self", "shellfish")).toBe(true);
    expect(p.rules.allergies.some((r) => r.code === "shellfish")).toBe(true);
  });

  it("a sentence before the cue is still not scanned for coverage", () => {
    const t = "We had shrimp last night. I'm allergic to peanuts.";
    const p = plan(t, [item(t, "I'm allergic to peanuts", "peanuts", "affirmed")]);
    expect(p.rules.allergies.map((r) => r.code)).toEqual(["peanut"]);
  });
});

describe("H3: a named person's rule never clears the anonymous one", () => {
  const anonPeanut: Rule = { id: "n".repeat(43), subjectId: null, code: "peanut", state: "pending", anonymous: true, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
  const brother: Subject = { entityId: null, mention: null, isSelf: false };
  const brotherItem = (t: string): FastItem => ({ ...item(t, "My brother's allergic to peanuts", "peanuts", "affirmed"), subject: { ...brother, mention: at(t, "My brother") } });

  it("\"One of the guests is allergic to peanuts\", then \"My brother's allergic to peanuts.\": the guest's rule stays", () => {
    const t = "My brother's allergic to peanuts.";
    const p = plan(t, [brotherItem(t)], { ...emptyRules(), allergies: [{ ...anonPeanut }] });
    expect(p.rules.allergies.some((r) => r.id === anonPeanut.id)).toBe(true);
    expect(p.rules.allergies.some((r) => !r.anonymous && r.subjectId !== "self" && r.code === "peanut" && r.state === "active")).toBe(true);
  });

  it("the owner's own rule doesn't clear it either", () => {
    const t = "I'm allergic to peanuts.";
    const p = plan(t, [item(t, "I'm allergic to peanuts", "peanuts", "affirmed")], { ...emptyRules(), allergies: [{ ...anonPeanut }] });
    expect(p.rules.allergies.map((r) => [r.subjectId, r.code, r.state])).toEqual([
      [null, "peanut", "pending"],
      ["self", "peanut", "active"],
    ]);
  });

  it("answering the asked anonymous rule still resolves it", () => {
    const t = "My brother's allergic to peanuts.";
    const p = plan(t, [brotherItem(t)], { ...emptyRules(), allergies: [{ ...anonPeanut }] }, { answering: { rule: anonPeanut } });
    expect(p.rules.allergies.some((r) => r.id === anonPeanut.id)).toBe(false);
    expect(p.outcome).toMatchObject({ kind: "pendingResolved", by: "rule" });
  });
});
