// Brief 032: the review of the hard-rule route. The reviewer's inputs, as unit cases, one block per finding.
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { planHardRule } from "./hard-rule";
import { notAllergyByCode } from "./not-allergy";
import { PERSONA_TEXT } from "../head";
import { PENDING_PREFIX, renderRulesSection } from "./rules-section";
import { TURN_AT, TURN_EID, buildEvidence, emptyRules, hardRuleTurn, spanAt, turnEvidenceOf, validateContext } from "./testing/arb-writes";
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

  it("a denial that reaches a slot still carries its code: an active rule is kept, a pending one kept off an answering turn (W-187)", () => {
    const t = "I'm not allergic to peanuts.";
    const active: Rule = { id: "a".repeat(43), subjectId: "self", code: "peanut", state: "active", anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
    const kept = plan(t, [item(t, "I'm not allergic to peanuts", "peanuts", "denied")], { ...emptyRules(), allergies: [active] });
    expect(kept.rules.allergies).toEqual([active]);
    expect(kept.outcome).toMatchObject({ kind: "ruleKept", why: "denied" });
    const pending: Rule = { ...active, id: "p".repeat(43), state: "pending" };
    const resolved = plan(t, [item(t, "I'm not allergic to peanuts", "peanuts", "denied")], { ...emptyRules(), allergies: [pending] });
    // Brief 025, W-187: off an answering turn the pending rule stays, and coverage files nothing more for peanut.
    expect(resolved.outcome).toEqual({ kind: "pendingKept", ruleIds: [pending.id] });
    expect(resolved.rules.allergies).toEqual([pending]);
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
  const brotherItem = (t: string): FastItem => ({ ...item(t, "My brother's allergic to peanuts", "peanuts", "affirmed"), subject: { ...brother, mention: at(t, "My brother") } }) as FastItem;

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

describe("M1: an allergen outside the gazetteer is never passed as not-an-allergy", () => {
  const ev = (t: string) => turnEvidenceOf(buildEvidence(TURN_EID, t, [], ["U"], TURN_AT), TURN_EID);

  it("\"I'm allergic to durian.\" with a valid empty answer: the unresolved filter, and Franki asks", () => {
    const t = "I'm allergic to durian.";
    expect(notAllergyByCode(ev(t))).toBe(false);
    const p = plan(t, []);
    expect(p.outcome).toMatchObject({ kind: "pendingWritten", question: "whatItem" });
    expect(p.rules.allergies).toMatchObject([{ subjectId: null, code: "unresolved", state: "pending" }]);
  });

  it("the code half needs the cue's object in the closed non-food list, or the trait reading of 'intolerant'", () => {
    for (const t of ["I'm allergic to Mondays.", "Ugh, I'm allergic to meetings.", "I'm allergic to my boss.", "My boss is so intolerant.", "I took an allergy pill."]) expect(notAllergyByCode(ev(t)), t).toBe(true);
    for (const t of ["I'm allergic to durian.", "I'm allergic to jackfruit.", "I'm intolerant of fructose.", "I'm allergic.", "I had an allergic reaction."]) expect(notAllergyByCode(ev(t)), t).toBe(false);
  });
});

describe("M2: each unlabeled subject is its own line", () => {
  const rule = (id: string, subjectId: string | null, code: string, state: "active" | "pending"): Rule => ({ id: id.padEnd(43, "x"), subjectId, code, state, anonymous: subjectId === null, proof: null, proofRev: null, rootKeys: [], dependsOn: [] });

  it("the brother with peanuts and a guest with shellfish, neither labeled, are two lines", () => {
    const rules = { ...emptyRules(), allergies: [rule("b", "b".repeat(43), "peanut", "active"), rule("g", "g".repeat(43), "shellfish", "active")] };
    const lines = renderRulesSection(rules, "private");
    expect(lines).toContain("- Someone else: peanuts.");
    expect(lines).toContain("- Someone else: shellfish.");
    expect(lines.some((l) => l.includes("peanuts") && l.includes("shellfish"))).toBe(false);
  });

  it("two anonymous rules, and two subjects' pending rules outside private, never share a line", () => {
    const rules = { ...emptyRules(), allergies: [rule("a1", null, "peanut", "pending"), rule("a2", null, "shellfish", "pending"), rule("s", "self", "kiwi", "pending"), rule("b", "b".repeat(43), "sesame", "pending")] };
    for (const audience of ["private", "company", "unknown"] as const) {
      const lines = renderRulesSection(rules, audience).filter((l) => l.startsWith("- "));
      expect(lines, audience).toHaveLength(4);
    }
  });
});

describe("H1, found by the property: a denial reaches only a rule stored before the turn", () => {
  it("\"I'm allergic to eggs. I'm not allergic to eggs.\" keeps the rule the first sentence wrote", () => {
    const t = "I'm allergic to eggs. I'm not allergic to eggs.";
    const p = plan(t, [item(t, "I'm allergic to eggs", "eggs", "affirmed"), item(t, "I'm not allergic to eggs", "eggs", "denied")], emptyRules(), { need: "subject" });
    expect(filtered(p.rules, "self", "egg")).toBe(true);
  });

  it("\"I'm allergic to eggs. I don't have any allergies.\" keeps it too", () => {
    const t = "I'm allergic to eggs. I don't have any allergies.";
    const p = plan(t, [item(t, "I'm allergic to eggs", "eggs", "affirmed"), item(t, "I don't have any allergies", "any allergies", "denied")], emptyRules(), { need: "subject" });
    expect(filtered(p.rules, "self", "egg")).toBe(true);
  });
});

describe("L1: a pending line is never called saved", () => {
  it("the persona's saved-allergy lines leave out entries that start with PENDING_PREFIX", () => {
    const lead = PENDING_PREFIX.slice(2, PENDING_PREFIX.indexOf(","));
    expect(lead).toBe("Not yet clear");
    const line = PERSONA_TEXT.split("\n").find((l) => l.includes("listed under Hard rules is saved"))!;
    expect(line).toContain(`except a line that starts "${lead}": that allergy is not saved yet`);
    expect(line).toContain(`listed under Hard rules outside a "${lead}" line`);
  });
});
