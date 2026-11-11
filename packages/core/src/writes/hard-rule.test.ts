// One rule slot (design 6.3, one case per cell), the hardRule planner (2.5, 2.6, 6.2) and the notAllergy check (G3).
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { RULES_MAX, RULE_SLOTS_PER_TURN, planHardRule } from "./hard-rule";
import { cueSentences, notAllergyByCode, sentencesOf } from "./not-allergy";
import { ruleTransition } from "./rule-state";
import { TURN_AT, TURN_EID, buildEvidence, emptyRules, hardRuleTurn, spanAt, turnEvidenceOf, validateContext } from "./testing/arb-writes";
import { fixtureRule } from "./testing/arb-hard-rule";
import type { FastItem, FastSlotsOut, RuleEvent, RuleSlot } from "./types";
import { validateItems } from "./validate";

const rule = fixtureRule("r1", "self", "peanut", "pending");
const install = fixtureRule("r2", "self", "peanut", "active");
const proof = spanAt(TURN_EID, "peanuts", 0, 7);
const EVENTS: Record<string, RuleEvent> = {
  affirm: { kind: "affirm", proof, deps: [], install },
  unsure: { kind: "unsure", proof, install: rule },
  deny: { kind: "deny" },
  trustedTap: { kind: "trustedTap" },
};
const SLOTS: Record<string, RuleSlot> = { absent: { kind: "absent" }, pending: { kind: "pending", rule }, active: { kind: "active", rule: install } };

describe("ruleTransition: the table of 6.3", () => {
  const cases: [string, string, string | null, string | null][] = [
    ["absent", "affirm", "active", "ruleWritten"],
    ["absent", "unsure", "pending", "pendingWritten"],
    ["absent", "deny", "absent", "denialRecorded"],
    ["absent", "trustedTap", null, null],
    ["pending", "affirm", "active", "pendingResolved"],
    ["pending", "unsure", "pending", "pendingKept"],
    ["pending", "deny", "absent", "pendingResolved"],
    ["pending", "trustedTap", null, null],
    ["active", "affirm", "active", "ruleKept"],
    ["active", "unsure", "active", "ruleKept"],
    ["active", "deny", "active", "ruleKept"],
    ["active", "trustedTap", null, null],
  ];
  for (const [from, event, to, outcome] of cases) {
    it(`${from} + ${event}`, () => {
      const r = ruleTransition(SLOTS[from]!, EVENTS[event]!);
      if (to === null) return expect(r).toEqual({ refused: "tapOnly" });
      expect("next" in r && r.next.kind).toBe(to);
      expect("outcome" in r && r.outcome).toBe(outcome);
    });
  }
  it("an active slot keeps its own rule, whatever the event", () => {
    const r = ruleTransition(SLOTS.active!, EVENTS.deny!);
    expect("next" in r && r.next).toBe(SLOTS.active);
  });
});

/** Validates and plans one turn, as the executor will. */
function plan(text: string, items: FastItem[] | null, rules: CoreRules = emptyRules(), over: { speakerCertain?: boolean; answering?: { rule: CoreRules["allergies"][number] | null } | null; regex?: boolean } = {}) {
  const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
  const out: FastSlotsOut | null = items === null ? null : { items, need: "none" };
  const speakerCertain = over.speakerCertain ?? true;
  const answering = over.answering ?? null;
  const verdicts = out === null ? [] : validateItems(out, validateContext(e, { routes: new Set(["hardRule"]), speakerCertain, answering }));
  return planHardRule(rules, verdicts, hardRuleTurn(e, out, { speakerCertain, answering, trigger: { regex: over.regex ?? true, candidate: false, asked: answering !== null } }));
}
const SELF = { entityId: null, mention: null, isSelf: true };
const allergy = (text: string, item: string, polarity: "affirmed" | "denied" | "uncertain" = "affirmed", act: FastItem["act"] = "direct"): FastItem => ({
  kind: "allergy",
  subject: SELF,
  item,
  severity: "allergy",
  polarity,
  act,
  span: spanAt(TURN_EID, text, 0, text.length - 1),
});

describe("planHardRule", () => {
  it("a direct, certain statement writes an active rule and says it is saved", () => {
    const t = "I'm allergic to shellfish.";
    const p = plan(t, [allergy(t, "shellfish")]);
    expect(p.outcome.kind).toBe("ruleWritten");
    expect(p.rules.allergies).toMatchObject([{ subjectId: "self", code: "shellfish", state: "active", anonymous: false, proof: { quote: "I'm allergic to shellfish" } }]);
    expect(p.rules.rulesRev).toBe(2);
    expect(p.rules.gazetteerVersion).toBe("gz1");
    expect(p.note).toEqual(["ruleSaved"]);
  });

  it("an uncertain speaker writes an anonymous filter and asks who it applies to", () => {
    const t = "I'm allergic to shellfish.";
    const p = plan(t, [allergy(t, "shellfish")], emptyRules(), { speakerCertain: false });
    expect(p.outcome).toMatchObject({ kind: "pendingWritten", question: "whoHas" });
    expect(p.rules.allergies).toMatchObject([{ subjectId: null, code: "shellfish", state: "pending", anonymous: true }]);
    expect(p.note).toEqual(["ask.whoHas"]);
  });

  it("a failed call writes coverage for the aliases in the cue sentence, else the unresolved filter", () => {
    const t = "I'm allergic to shellfish, and my brother's in trouble again.";
    expect(plan(t, null).rules.allergies).toMatchObject([{ subjectId: null, code: "shellfish", state: "pending", proof: { quote: "shellfish" } }]);
    const c = "I'm allergic to something in that curry.";
    expect(plan(c, null).rules.allergies).toMatchObject([{ subjectId: null, code: "unresolved", state: "pending", proof: { quote: "allergic" } }]);
    expect(plan(c, null).note).toEqual(["ask.whatItem"]);
  });

  it("an ignored item carries no code, so coverage still writes it (fail closed)", () => {
    const t = "I'm allergic to peanuts.";
    const p = plan(t, [allergy(t, "peanuts", "affirmed", "quoted")]);
    expect(p.rules.allergies).toMatchObject([{ subjectId: null, code: "peanut", state: "pending" }]);
  });

  it("notAllergy needs both checks; with a question asked it is pendingKept", () => {
    const t = "I'm allergic to Mondays.";
    const p = plan(t, []);
    expect(p.outcome.kind).toBe("notAllergy");
    expect(p.rules.allergies).toEqual([]);
    expect(p.ledger).toEqual([{ eid: TURN_EID, outcome: "notAllergy", codes: [] }]);
    expect(plan(t, null).outcome.kind).toBe("pendingWritten");
    const asked = fixtureRule("asked", null, "unresolved", "pending");
    const rules = { ...emptyRules(), allergies: [asked] };
    expect(plan(t, [], rules, { answering: { rule: asked }, regex: false }).outcome).toEqual({ kind: "pendingKept", ruleIds: [asked.id] });
  });

  it("an active rule is never relaxed by voice", () => {
    const t = "I'm not allergic to peanuts.";
    const active = fixtureRule("act", "self", "peanut", "active");
    const p = plan(t, [allergy(t, "peanuts", "denied")], { ...emptyRules(), allergies: [active] });
    expect(p.rules.allergies).toEqual([active]);
    expect(p.outcome).toMatchObject({ kind: "ruleKept", why: "denied" });
    expect(p.note).toEqual(["ruleKept"]);
  });

  it("a certain denial resolves the subject's pending rule; an uncertain one is a ledger decision only", () => {
    const t = "I'm not allergic to peanuts.";
    const pending = fixtureRule("pend", "self", "peanut", "pending");
    const rules = { ...emptyRules(), allergies: [pending] };
    expect(plan(t, [allergy(t, "peanuts", "denied")], rules).outcome).toEqual({ kind: "pendingResolved", ruleIds: [pending.id], by: "denial" });
    const guest = plan(t, [allergy(t, "peanuts", "denied")], rules, { speakerCertain: false });
    expect(guest.rules).toBe(rules);
    expect(guest.outcome).toEqual({ kind: "denialRecorded", wrote: "ledgerOnly" });
    expect(guest.ledger).toEqual([{ eid: TURN_EID, outcome: "denialRecorded", codes: ["peanut"] }]);
  });

  it("a global denial confirms none only when nothing is pending for anyone", () => {
    const t = "I don't have any allergies.";
    const p = plan(t, [allergy(t, "any allergies", "denied")]);
    expect(p.rules.noneConfirmed).toEqual(["self"]);
    expect(p.note).toEqual(["noneSaved"]);
    const anon = fixtureRule("anon", null, "unresolved", "pending");
    expect(plan(t, [allergy(t, "any allergies", "denied")], { ...emptyRules(), allergies: [anon] }).rules.noneConfirmed).toEqual([]);
  });

  it("a newly active rule resolves the anonymous filter with its code and the subject's unresolved rule", () => {
    const t = "I'm allergic to peanuts.";
    const rules = { ...emptyRules(), allergies: [fixtureRule("anonpeanut", null, "peanut", "pending"), fixtureRule("selfun", "self", "unresolved", "pending"), fixtureRule("other", null, "kiwi", "pending")] };
    const p = plan(t, [allergy(t, "peanuts")], rules);
    expect(p.rules.allergies.map((r) => [r.subjectId, r.code, r.state])).toEqual([
      [null, "kiwi", "pending"],
      ["self", "peanut", "active"],
    ]);
    expect(p.outcome).toMatchObject({ kind: "pendingResolved", by: "rule" });
  });

  it("writing a pending rule removes its subject from noneConfirmed; an anonymous one clears the list", () => {
    const t = "I think I might be allergic to kiwi.";
    const rules = { ...emptyRules(), noneConfirmed: ["self", "x".repeat(43)] };
    expect(plan(t, [allergy(t, "kiwi", "uncertain")], rules).rules.noneConfirmed).toEqual(["x".repeat(43)]);
    expect(plan(t, [allergy(t, "kiwi", "uncertain")], rules, { speakerCertain: false }).rules.noneConfirmed).toEqual([]);
  });

  it("a turn triggered only by the asked question, with no allergy verdict, changes nothing", () => {
    const asked = fixtureRule("asked", null, "peanut", "pending");
    const rules = { ...emptyRules(), allergies: [asked] };
    const p = plan("Shellfish, I think.", null, rules, { answering: { rule: asked }, regex: false });
    expect(p.rules).toBe(rules);
    expect(p.outcome).toEqual({ kind: "pendingKept", ruleIds: [asked.id] });
  });

  it("the bounds: past the slots per turn, and at RULES_MAX - 1 rules, the unresolved filter stands in", () => {
    const full = { ...emptyRules(), allergies: Array.from({ length: RULES_MAX - 1 }, (_, i) => fixtureRule(`f${i}`, "self", `code${i}`, "active")) };
    const t = "I'm allergic to peanuts.";
    const p = plan(t, [allergy(t, "peanuts")], full);
    expect(p.rules.allergies.length).toBe(RULES_MAX);
    expect(p.rules.allergies.at(-1)).toMatchObject({ subjectId: null, code: "unresolved", state: "pending" });
    expect(RULE_SLOTS_PER_TURN).toBe(32);
  });

  it("writes nothing from T text, verdicts included", () => {
    const t = "I'm allergic to shellfish.";
    const e = buildEvidence(TURN_EID, t, [], ["T"], TURN_AT);
    const forged = [{ kind: "allergy" as const, index: 0, v: { kind: "affirm" as const, subject: "self", label: null, codes: ["shellfish"], proof: spanAt(TURN_EID, t, 0, 25) } }];
    const rules = emptyRules();
    const p = planHardRule(rules, forged, hardRuleTurn(e, null));
    expect(p.rules).toBe(rules);
    expect(p.note).toEqual([]);
  });
});

describe("cue sentences and notAllergyByCode", () => {
  const ev = (t: string) => turnEvidenceOf(buildEvidence(TURN_EID, t, [], ["U"], TURN_AT), TURN_EID);
  it("splits at . ! ? ; and line breaks", () => {
    expect(sentencesOf("A. B! C? D; E\nF").length).toBe(6);
  });
  it("keeps only the RX4 sentences, and leaves out a verified subject mention", () => {
    const t = "We had lunch. My dog is allergic to chicken.";
    const m = { ...allergy(t, "chicken"), subject: { entityId: null, mention: spanAt(TURN_EID, t, 14, 20), isSelf: false }, span: spanAt(TURN_EID, t, 14, 43) };
    expect(cueSentences(ev(t), { items: [m], need: "none" }, false)).toEqual([{ start: 20, end: 43 }]);
  });
  it("passes Mondays and the intolerant boss; fails an alias, a generic object, an allergy pill near 'this', and EpiPen", () => {
    expect(notAllergyByCode(ev("I'm allergic to Mondays."), null)).toBe(true);
    expect(notAllergyByCode(ev("My boss is so intolerant."), null)).toBe(true);
    expect(notAllergyByCode(ev("I'm allergic to peanuts."), null)).toBe(false);
    expect(notAllergyByCode(ev("I'm allergic to something in that curry."), null)).toBe(false);
    expect(notAllergyByCode(ev("I took an allergy pill this morning."), null)).toBe(false);
    expect(notAllergyByCode(ev("I took an allergy pill."), null)).toBe(true);
    expect(notAllergyByCode(ev("I always carry an EpiPen."), null)).toBe(false);
    expect(notAllergyByCode(ev("We watched a film."), null)).toBe(false);
  });
});
