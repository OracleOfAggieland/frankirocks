// Validation: one case per row of the decision tables of design 2.4, the answering rules and the subject rows.
import { describe, expect, it } from "vitest";
import { msFromTs } from "../schema/primitives";
import type { Memory } from "../schema/records";
import { testId } from "../testing/samples";
import { mentionEid, mentionName, resolveSubject } from "./subject";
import { DAD, DAD_LIFE, KNOWN, SELF_NAME, SISTER, SISTER_REL, TURN_AT, TURN_EID, buildEvidence, hasher, row, PRIOR, PRIOR_EID, spanAt, targetsMap, turnEvidenceOf, validateContext } from "./testing/arb-writes";
import { fixtureRule } from "./testing/arb-hard-rule";
import type { FastItem, ItemVerdict, Need, Subject, ValidateContext } from "./types";
import { HANDLED_REFS_MAX, validateItems, whenOf } from "./validate";

const SELF: Subject = { entityId: null, mention: null, isSelf: true };
const NONE: Subject = { entityId: null, mention: null, isSelf: false };

function turn(text: string, classes: ("U" | "T")[] = ["U"], cuts: number[] = []) {
  return buildEvidence(TURN_EID, text, cuts, classes, TURN_AT);
}
const whole = (text: string, phrase = text.replace(/[.!?]$/, "")) => spanAt(TURN_EID, text, text.indexOf(phrase), text.indexOf(phrase) + phrase.length);

function allergy(text: string, item: string, over: Partial<Extract<FastItem, { kind: "allergy" }>> = {}): FastItem {
  return { kind: "allergy", subject: SELF, item, severity: "allergy", polarity: "affirmed", act: "direct", span: whole(text), ...over };
}
function run(text: string, items: FastItem[], over: Partial<ValidateContext> = {}, need: Need = "none", e = turn(text)): ItemVerdict[] {
  return validateItems({ items, need }, validateContext(e, over));
}
const one = (vs: ItemVerdict[]) => vs[0]!;

describe("before the tables", () => {
  it("an item of a route no trigger opened is outOfScope, and so is a rule item", () => {
    const t = "I'm allergic to shellfish.";
    expect(one(run(t, [allergy(t, "shellfish")], { routes: new Set(["correct"]) }))).toEqual({ kind: "ignored", index: 0, reason: "outOfScope" });
    const rule: FastItem = { kind: "rule", subject: SELF, predicate: "preference.food", value: { kind: "enum", code: "avoid" }, args: [], whenSpoken: null, act: "direct", span: whole(t) };
    expect(one(run(t, [rule]))).toMatchObject({ kind: "ignored", reason: "outOfScope" });
  });
});

describe("subjects", () => {
  const e = turnEvidenceOf(turn("My brother can't have peanuts and my sister can't either."), TURN_EID);
  const input = (subject: Subject, quote = "I'm") => ({ subject, quote, evidence: e, known: KNOWN, entities: [{ id: SISTER, label: "Maya", aliases: ["sister"] }], kind: "person" as const, hasher });
  const mention = (w: string) => spanAt(TURN_EID, e.text, e.text.indexOf(w), e.text.indexOf(w) + w.length);
  it("SU1: more than one form is unresolved, except an entityId with its own mention", () => {
    expect(resolveSubject(input({ entityId: null, mention: mention("My brother"), isSelf: true }))).toEqual({ kind: "unresolved" });
    expect(resolveSubject(input({ entityId: SISTER, mention: mention("my sister"), isSelf: false }))).toEqual({ kind: "resolved", id: SISTER, label: "Maya" });
  });
  it("SU2, SU3: isSelf needs a first-person word", () => {
    expect(resolveSubject(input(SELF, "I'm allergic"))).toEqual({ kind: "resolved", id: "self", label: null });
    expect(resolveSubject(input(SELF, "allergic to it"))).toEqual({ kind: "unresolved" });
  });
  it("SU4: an entity that was sent", () => {
    expect(resolveSubject(input({ entityId: SISTER, mention: null, isSelf: false }))).toMatchObject({ id: SISTER });
    expect(resolveSubject(input({ entityId: testId("nobody"), mention: null, isSelf: false }))).toEqual({ kind: "unresolved" });
  });
  it("SU5: one known entity by label, alias or relation word", () => {
    expect(resolveSubject(input({ entityId: null, mention: mention("my sister"), isSelf: false }))).toMatchObject({ kind: "resolved", id: SISTER });
  });
  it("SU6: two known entities ask", () => {
    const known = { entries: [...KNOWN.entries, { id: testId("sis2"), kind: "person" as const, label: "Jo", aliases: ["sister"], relation: "sister" }] };
    expect(resolveSubject({ ...input({ entityId: null, mention: mention("my sister"), isSelf: false }), known })).toEqual({ kind: "ambiguous" });
  });
  it("SU7: none known derives the mention's EID, reusing one a Memory already names", () => {
    expect(resolveSubject(input({ entityId: null, mention: mention("My brother"), isSelf: false }))).toEqual({ kind: "resolved", id: mentionEid("person", "brother", hasher), label: "your brother" });
    const old = hasher.id(["mention", "pet", "my brother"]);
    expect(resolveSubject({ ...input({ entityId: null, mention: mention("My brother"), isSelf: false }), known: { ...KNOWN, seen: new Set([old]) } })).toMatchObject({ id: old });
  });
  it("SU8: a pronoun, nothing, or a mention that doesn't verify", () => {
    expect(resolveSubject(input(NONE))).toEqual({ kind: "unresolved" });
    expect(resolveSubject(input({ entityId: null, mention: { ...mention("My brother"), quote: "My bruther" }, isSelf: false }))).toEqual({ kind: "unresolved" });
  });
  it("mentionName drops a leading my, our or the; derived IDs match extraction's", () => {
    expect(mentionName("  My   Dad ")).toBe("dad");
    expect(mentionEid("person", "dad", hasher)).toBe(DAD);
  });
});

describe("allergy items", () => {
  const t = "I'm allergic to shellfish.";
  it("A1: a span on a non-U slice", () => {
    expect(one(run(t, [allergy(t, "shellfish")], {}, "none", turn(t, ["T"])))).toMatchObject({ reason: "authority" });
  });
  it("A2: a span that doesn't verify; A3: an item outside the span", () => {
    expect(one(run(t, [allergy(t, "shellfish", { span: { ...whole(t), start: 10 } })]))).toMatchObject({ reason: "span" });
    expect(one(run(t, [allergy(t, "peanuts")]))).toMatchObject({ reason: "span" });
  });
  it("A4: an act that isn't direct", () => {
    expect(one(run(t, [allergy(t, "shellfish", { act: "quoted" })]))).toMatchObject({ reason: "act" });
  });
  it("A5: a denial with no negation word is read as uncertain", () => {
    expect(one(run(t, [allergy(t, "shellfish", { polarity: "denied" })]))).toMatchObject({ kind: "allergy", v: { kind: "unsure", codes: ["shellfish"], question: "isAllergy" } });
  });
  const d = "I'm not allergic to peanuts.";
  it("A6: a denial from an uncertain speaker", () => {
    expect(one(run(d, [allergy(d, "peanuts", { polarity: "denied" })], { speakerCertain: false }))).toMatchObject({ reason: "speaker" });
  });
  it("A7: a global denial; A8: a specific one", () => {
    const g = "I don't have any allergies.";
    expect(one(run(g, [allergy(g, "any allergies", { polarity: "denied" })]))).toMatchObject({ v: { kind: "deny", subject: "self", scope: "global" } });
    expect(one(run(d, [allergy(d, "peanuts", { polarity: "denied" })]))).toMatchObject({ v: { kind: "deny", subject: "self", scope: "specific", codes: ["peanut"] } });
  });
  it("A9: a denial about no one answering an anonymous rule; A10: otherwise nothing", () => {
    const n = "No, nobody has that.";
    const anon = fixtureRule("anon", null, "shellfish", "pending");
    expect(one(run(n, [allergy(n, "", { polarity: "denied", subject: NONE })], { answering: { rule: anon } }))).toMatchObject({ v: { kind: "deny", answers: anon.id } });
    expect(one(run(d, [allergy(d, "peanuts", { polarity: "denied", subject: NONE })]))).toMatchObject({ kind: "ignored" });
  });
  it("A11: an affirmed, direct allergy of a resolved subject from a certain speaker", () => {
    expect(one(run(t, [allergy(t, "shellfish")]))).toEqual({ kind: "allergy", index: 0, v: { kind: "affirm", subject: "self", label: null, codes: ["shellfish"], proof: whole(t) } });
  });
  it("A12: an uncertain speaker; A13: an unresolved subject", () => {
    expect(one(run(t, [allergy(t, "shellfish")], { speakerCertain: false }))).toMatchObject({ v: { kind: "unsure", subject: null, codes: ["shellfish"], question: "whoHas" } });
    expect(one(run(t, [allergy(t, "shellfish", { subject: NONE })]))).toMatchObject({ v: { kind: "unsure", subject: null, question: "whoHas" } });
  });
  it("A14: need isn't none", () => {
    expect(one(run(t, [allergy(t, "shellfish")], {}, "meaning"))).toMatchObject({ v: { kind: "unsure", subject: "self", question: "isAllergy" } });
    expect(one(run(t, [allergy(t, "shellfish")], {}, "subject"))).toMatchObject({ v: { question: "whoHas" } });
  });
  it("A15: no code; with a question for the item asked, pendingKept and notListed", () => {
    const c = "I'm allergic to something in that curry.";
    expect(one(run(c, [allergy(c, "something", { polarity: "uncertain" })]))).toMatchObject({ v: { kind: "unsure", codes: "unresolved", question: "whatItem" } });
    const r = fixtureRule("selfun", "self", "unresolved", "pending");
    const a = "It was durian.";
    expect(one(run(a, [allergy(a, "durian", { subject: NONE })], { answering: { rule: r } }))).toMatchObject({ v: { kind: "pendingKept", ruleId: r.id, question: "notListed" } });
  });
  it("A16: uncertain with codes", () => {
    const h = "I think I might be allergic to kiwi.";
    expect(one(run(h, [allergy(h, "kiwi", { polarity: "uncertain" })]))).toMatchObject({ v: { kind: "unsure", subject: "self", codes: ["kiwi"], question: "isAllergy" } });
  });
});

describe("answering turns", () => {
  const proofText = "I might be allergic to peanuts.";
  const prior = buildEvidence(PRIOR_EID, proofText, [], ["U"], TURN_AT);
  const R = { ...fixtureRule("selfpeanut", "self", "peanut", "pending"), proof: spanAt(PRIOR_EID, proofText, 0, proofText.length - 1), proofRev: prior.rev };
  it("1 and 4: an affirmation naming nothing takes the asked rule's code and proof", () => {
    const y = "Yes, I am.";
    expect(one(run(y, [allergy(y, "yes")], { answering: { rule: R } }))).toMatchObject({ v: { kind: "affirm", subject: "self", codes: ["peanut"], proof: R.proof } });
  });
  it("2: an item with no subject takes the asked rule's subject", () => {
    const a = "It was the cashews.";
    expect(one(run(a, [allergy(a, "cashews", { subject: NONE })], { answering: { rule: R } }))).toMatchObject({ v: { kind: "affirm", subject: "self", codes: ["cashew"] } });
  });
  it("3: a bare no takes the asked rule's code", () => {
    const n = "No, I'm not.";
    expect(one(run(n, [allergy(n, "no", { polarity: "denied" })], { answering: { rule: R } }))).toMatchObject({ v: { kind: "deny", subject: "self", scope: "specific", codes: ["peanut"] } });
  });
  it("5: naming the item for an unresolved rule of a known subject stays pending unless it states the allergy", () => {
    const U = fixtureRule("selfun", "self", "unresolved", "pending");
    const a = "It was the peanuts.";
    expect(one(run(a, [allergy(a, "peanuts", { subject: NONE })], { answering: { rule: U } }))).toMatchObject({ v: { kind: "unsure", subject: "self", codes: ["peanut"], question: null } });
    const b = "I'm allergic to peanuts.";
    expect(one(run(b, [allergy(b, "peanuts")], { answering: { rule: U } }))).toMatchObject({ v: { kind: "affirm" } });
  });
  it("6: with no asked rule, codes and subject come from the answer itself", () => {
    const a = "Shellfish and peanuts, both.";
    expect(one(run(a, [allergy(a, "Shellfish", { subject: NONE })], { answering: { rule: null } }))).toMatchObject({ v: { kind: "unsure", subject: null, codes: ["shellfish"], question: "whoHas" } });
  });
});

const correction = (text: string, over: Partial<Extract<FastItem, { kind: "correction" }>>): FastItem => ({
  kind: "correction",
  targetIds: [SELF_NAME.logicalId],
  predicate: "identity.name",
  replacementValue: { kind: "text", text: "Alex" },
  args: null,
  act: "direct",
  span: whole(text),
  ...over,
});

describe("correction items", () => {
  const t = "No, my name is Alex, not Alec.";
  it("C1, C2, C3", () => {
    expect(one(run(t, [correction(t, {})], {}, "none", turn(t, ["T"])))).toMatchObject({ reason: "authority" });
    expect(one(run(t, [correction(t, { act: "hypothetical" })]))).toMatchObject({ reason: "act" });
    expect(one(run(t, [correction(t, { span: { ...whole(t), quote: "nope" } })]))).toMatchObject({ reason: "span" });
  });
  it("C4: need, or an uncertain speaker, defers", () => {
    expect(one(run(t, [correction(t, {})], {}, "target"))).toMatchObject({ v: { kind: "defer", why: "need" } });
    expect(one(run(t, [correction(t, {})], { speakerCertain: false }))).toMatchObject({ v: { kind: "defer", why: "speaker" } });
  });
  it("C5: an unknown, mismatched or protected target", () => {
    expect(one(run(t, [correction(t, { targetIds: [testId("unknown")] })]))).toMatchObject({ reason: "target" });
    expect(one(run(t, [correction(t, { predicate: "person.life" })]))).toMatchObject({ reason: "target" });
    const rule = { ...SELF_NAME, logicalId: testId("arule"), kind: "rule" as const };
    expect(one(run(t, [correction(t, { targetIds: [rule.logicalId] })], { targets: targetsMap([rule]) }))).toMatchObject({ reason: "target" });
  });
  it("C5a: targets on two keys", () => {
    const other = { ...SELF_NAME, logicalId: testId("name2"), key: testId("key2") };
    expect(one(run(t, [correction(t, { targetIds: [SELF_NAME.logicalId, other.logicalId] })], { targets: targetsMap([SELF_NAME, other]) }))).toMatchObject({ reason: "target" });
  });
  it("C5b: a key that isn't stable defers", () => {
    const fact = row(testId("mfact"), { subjectId: "self", predicate: "fact", value: { kind: "text", text: "Alec" }, args: { topic: "other", label: null } }, PRIOR, PRIOR_EID, "My name is Alec");
    expect(one(run(t, [correction(t, { targetIds: [fact.logicalId], predicate: "fact" })], { targets: targetsMap([fact]) }))).toMatchObject({ v: { kind: "defer", why: "keyUnstable" } });
  });
  it("C5c: a target the turn doesn't name, among several, defers", () => {
    const other = row(testId("mname2"), { subjectId: SISTER, predicate: "identity.name", value: { kind: "text", text: "Maya" }, args: {} }, PRIOR, PRIOR_EID, "My sister Maya");
    const u = "No, it's Alex.";
    expect(one(run(u, [correction(u, {})], { targets: targetsMap([SELF_NAME, other]) }))).toMatchObject({ v: { kind: "defer", why: "uncertainTarget" } });
    expect(one(run(u, [correction(u, {})], { targets: targetsMap([SELF_NAME]) }))).toMatchObject({ v: { kind: "correct" } });
  });
  it("C5d: past handled's bounds defers, nothing truncated", () => {
    const items = Array.from({ length: HANDLED_REFS_MAX }, () => correction(t, {}));
    const vs = run(t, items);
    expect(vs.some((v) => v.kind === "correction" && v.v.kind === "defer" && v.v.why === "bounds")).toBe(true);
  });
  it("R1: a fix to another person's name renames them", () => {
    const r = "No, her name is Mara, not Maya.";
    expect(one(run(r, [correction(r, { targetIds: [SISTER_REL.logicalId], replacementValue: { kind: "text", text: "Mara" } })]))).toEqual({
      kind: "correction",
      index: 0,
      v: { kind: "rename", target: SISTER_REL.logicalId, entity: SISTER, from: "Maya", to: "Mara" },
    });
    const same = "No, her name is Maya.";
    expect(one(run(same, [correction(same, { targetIds: [SISTER_REL.logicalId], replacementValue: { kind: "text", text: "Maya" } })]))).toMatchObject({ v: { kind: "same" } });
    const missing = "No, that's not her name, Maya.";
    expect(one(run(missing, [correction(missing, { targetIds: [SISTER_REL.logicalId], replacementValue: { kind: "text", text: "Mara" } })]))).toMatchObject({ v: { kind: "defer", why: "value" } });
  });
  it("C6: a null replacement whose old value the turn names retracts; C6a: otherwise defers", () => {
    expect(one(run(t, [correction(t, { replacementValue: null })]))).toMatchObject({ v: { kind: "retract", targets: [SELF_NAME.logicalId] } });
    const u = "No, that's wrong.";
    const two = targetsMap([SELF_NAME, { ...DAD_LIFE, predicate: "identity.name" } as Memory]);
    expect(one(run(u, [correction(u, { replacementValue: null })], { targets: two }))).toMatchObject({ v: { kind: "defer" } });
    expect(one(run(u, [correction(u, { replacementValue: null })]))).toMatchObject({ v: { kind: "defer", why: "value" } });
  });
  it("C6b: the same value again is same", () => {
    const u = "My name is Alec, I said.";
    expect(one(run(u, [correction(u, { replacementValue: { kind: "text", text: "alec" } })]))).toMatchObject({ v: { kind: "same" } });
  });
  it("C7: a fitting value inside the span; C8: otherwise defer", () => {
    expect(one(run(t, [correction(t, {})]))).toMatchObject({ v: { kind: "correct", targets: [SELF_NAME.logicalId], value: { kind: "text", text: "Alex" } } });
    expect(one(run(t, [correction(t, { replacementValue: { kind: "text", text: "Alexander" } })]))).toMatchObject({ v: { kind: "defer", why: "value" } });
    const l = "No, he's in hospital, not alive.";
    const life = correction(l, { targetIds: [DAD_LIFE.logicalId], predicate: "person.life", replacementValue: { kind: "enum", code: "flying" } });
    expect(one(run(l, [life]))).toMatchObject({ v: { kind: "defer", why: "value" } });
  });
});

const transition = (text: string, over: Partial<Extract<FastItem, { kind: "transition" }>>): FastItem => ({
  kind: "transition",
  transition: "death",
  subject: { entityId: DAD, mention: null, isSelf: false },
  counterpart: null,
  whenSpoken: null,
  polarity: "affirmed",
  act: "direct",
  span: whole(text),
  ...over,
});

describe("transition items", () => {
  const t = "My dad passed away last night.";
  it("T1, T2", () => {
    expect(one(run(t, [transition(t, {})], {}, "none", turn(t, ["T"])))).toMatchObject({ reason: "authority" });
    expect(one(run(t, [transition(t, { span: { ...whole(t), start: 9 } })]))).toMatchObject({ reason: "span" });
  });
  it("T3: not direct, or not affirmed, is careOnly", () => {
    expect(one(run(t, [transition(t, { act: "hypothetical" })]))).toEqual({ kind: "transition", index: 0, v: { kind: "careOnly" } });
    expect(one(run(t, [transition(t, { polarity: "uncertain" })]))).toMatchObject({ v: { kind: "careOnly" } });
  });
  it("T4: need or an uncertain speaker defers; T5: scheduled kinds defer", () => {
    expect(one(run(t, [transition(t, {})], {}, "time"))).toMatchObject({ v: { kind: "defer", why: "need" } });
    expect(one(run(t, [transition(t, {})], { speakerCertain: false }))).toMatchObject({ v: { kind: "defer", why: "speaker" } });
    expect(one(run(t, [transition(t, { transition: "expire" })]))).toMatchObject({ v: { kind: "defer", why: "scheduled" } });
  });
  it("T6: an unresolved subject, the owner's own death, a breakup with no one, a job change of the wrong person", () => {
    expect(one(run(t, [transition(t, { subject: NONE })]))).toMatchObject({ reason: "target" });
    const me = "I passed my exam.";
    expect(one(run(me, [transition(me, { subject: SELF })]))).toMatchObject({ reason: "target" });
    expect(one(run(me, [transition(me, { transition: "breakup", subject: SELF })]))).toMatchObject({ reason: "target" });
    expect(one(run(t, [transition(t, { transition: "jobChangeOwn" })]))).toMatchObject({ reason: "target" });
    expect(one(run(me, [transition(me, { transition: "jobChangeOther", subject: SELF })]))).toMatchObject({ reason: "target" });
  });
  it("T6a: a job change with two roles and no employer named defers", () => {
    const role = (n: string) => row(testId(`role${n}`), { subjectId: "self", predicate: "employment.role", value: { kind: "text", text: n }, args: { employerRef: testId(`org${n}`), managerRef: null } }, PRIOR, PRIOR_EID, "My name is Alec");
    const j = "I left my job.";
    expect(one(run(j, [transition(j, { transition: "jobChangeOwn", subject: SELF })], { targets: targetsMap([role("a"), role("b")]) }))).toMatchObject({ v: { kind: "defer", why: "employer" } });
  });
  it("T6b: a change dated after now defers; past words the resolver doesn't read are placed at the turn", () => {
    expect(one(run(t, [transition(t, { whenSpoken: "tomorrow" })]))).toMatchObject({ v: { kind: "defer", why: "time" } });
    expect(one(run(t, [transition(t, { whenSpoken: "last night" })]))).toMatchObject({ v: { kind: "change", when: msFromTs(TURN_AT) } });
    expect(whenOf("on Friday", { assertedAt: TURN_AT }, msFromTs(TURN_AT))).toEqual({ ok: false });
  });
  it("T6c: past handled's bounds defers", () => {
    const vs = run(t, Array.from({ length: 8 }, () => transition(t, {})));
    expect(vs.some((v) => v.kind === "transition" && v.v.kind === "defer" && v.v.why === "bounds")).toBe(true);
  });
  it("T7: a change with its subject and moment", () => {
    expect(one(run(t, [transition(t, {})]))).toEqual({ kind: "transition", index: 0, v: { kind: "change", transition: "death", subject: DAD, counterpart: null, when: msFromTs(TURN_AT) } });
  });
});

// Sequences the wave A review ran, pinned (CQs 145, 146, 148 to 151).
describe("validation: the review's cases", () => {
  const at = (text: string, phrase: string) => spanAt(TURN_EID, text, text.indexOf(phrase), text.indexOf(phrase) + phrase.length);
  const BROTHER = mentionEid("person", "brother", hasher);

  it("rule 5 applies only to an answer about the asked rule's own subject", () => {
    const U = fixtureRule("selfun", "self", "unresolved", "pending");
    const b = "My brother can't have peanuts.";
    const v = one(run(b, [allergy(b, "peanuts", { subject: { entityId: null, mention: at(b, "My brother"), isSelf: false } })], { answering: { rule: U } }));
    expect(v).toMatchObject({ v: { kind: "affirm", subject: BROTHER, codes: ["peanut"] } });
  });

  it("A7 is global only for codes exactly [none]; other codes make it specific", () => {
    const t = "I'm not allergic to anything with peanuts.";
    expect(one(run(t, [allergy(t, "anything with peanuts", { polarity: "denied" })]))).toMatchObject({ v: { kind: "deny", scope: "specific", codes: ["peanut"] } });
  });

  it("A9 answers the asked anonymous rule only when the denial names no other allergen", () => {
    const anon = fixtureRule("anon", null, "peanut", "pending");
    const t = "Nobody here is allergic to shellfish, no.";
    expect(one(run(t, [allergy(t, "shellfish", { polarity: "denied", subject: NONE })], { answering: { rule: anon } }))).toEqual({ kind: "ignored", index: 0, reason: "target" });
    const p = "Nobody here is allergic to peanuts, no.";
    expect(one(run(p, [allergy(p, "peanuts", { polarity: "denied", subject: NONE })], { answering: { rule: anon } }))).toMatchObject({ v: { kind: "deny", answers: anon.id } });
  });

  it("A6 carries the codes validation verified, never the model's item outside its span", () => {
    const t = "No. My brother is allergic to peanuts though.";
    const v = one(run(t, [allergy(t, "peanuts", { polarity: "denied", subject: NONE, span: at(t, "No") })], { answering: { rule: null }, speakerCertain: false }));
    expect(v).toEqual({ kind: "ignored", index: 0, reason: "speaker", codes: [] });
    const d = "I'm not allergic to peanuts.";
    expect(one(run(d, [allergy(d, "peanuts", { polarity: "denied" })], { speakerCertain: false }))).toEqual({ kind: "ignored", index: 0, reason: "speaker", codes: ["peanut"] });
  });

  it("SU2: \"my\" names the owner only before the allergy itself", () => {
    const t = "My brother isn't allergic to anything.";
    expect(one(run(t, [allergy(t, "anything", { polarity: "denied" })]))).toEqual({ kind: "ignored", index: 0, reason: "target" });
    const m = "My peanut allergy is bad.";
    expect(one(run(m, [allergy(m, "peanut")]))).toMatchObject({ v: { kind: "affirm", subject: "self", codes: ["peanut"] } });
    const a = "My brother can't have peanuts.";
    expect(one(run(a, [allergy(a, "peanuts")]))).toMatchObject({ v: { kind: "unsure", subject: null, codes: ["peanut"], question: "whoHas" } });
  });

  it("a mention that isn't plain names no one, so the item fails closed", () => {
    const t = "My brother with the peanut allergy can't have shellfish either.";
    const v = one(run(t, [allergy(t, "shellfish", { subject: { entityId: null, mention: at(t, "My brother with the peanut allergy"), isSelf: false } })]));
    expect(v).toMatchObject({ v: { kind: "unsure", subject: null, codes: ["shellfish"], question: "whoHas" } });
    const w = "I'm allergic to shellfish.";
    expect(one(run(w, [allergy(w, "shellfish", { subject: { entityId: null, mention: at(w, "I'm allergic to shellfish"), isSelf: false } })]))).toMatchObject({ v: { kind: "unsure", subject: null } });
  });

  it("T6b: a change for later on the turn's own day defers; past-reading words place it at the turn", () => {
    const now = msFromTs(TURN_AT);
    for (const w of ["tonight", "this evening", "later today", "today"]) expect(whenOf(w, { assertedAt: TURN_AT }, now), w).toEqual({ ok: false });
    for (const w of ["earlier today", "this morning"]) expect(whenOf(w, { assertedAt: TURN_AT }, now), w).toEqual({ ok: true, when: now });
    const q = "I'm quitting my job tonight.";
    expect(one(run(q, [transition(q, { transition: "jobChangeOwn", subject: SELF, whenSpoken: "tonight" })]))).toMatchObject({ v: { kind: "defer", why: "time" } });
  });

  it("SU6 on a transition defers", () => {
    const known = { entries: [...KNOWN.entries, { id: testId("dad2"), kind: "person" as const, label: "Pops", aliases: ["dad"], relation: "parent" }] };
    const t = "My dad passed away last night.";
    expect(one(run(t, [transition(t, { subject: { entityId: null, mention: at(t, "My dad"), isSelf: false } })], { known }))).toMatchObject({ v: { kind: "defer", why: "subject" } });
  });

  it("C5d/T6c: a ninth distinct key defers, before the ref bound is reached", () => {
    const t = "My uncle, my aunt, my cousin, my neighbour and my coach passed away.";
    const who = ["My uncle", "my aunt", "my cousin", "my neighbour", "my coach"];
    const vs = run(t, who.map((w) => transition(t, { subject: { entityId: null, mention: at(t, w), isSelf: false } })));
    expect(vs.map((v) => (v.kind === "transition" ? v.v.kind : v.kind))).toEqual(["change", "change", "change", "change", "defer"]);
    expect(vs[4]).toMatchObject({ v: { why: "bounds" } });
  });
});
