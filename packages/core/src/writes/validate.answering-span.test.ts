// Brief 018 task 0: the three answering-turn items left open by report 012 ("Open before wave B"), one case per
// sentence the report lists. Item 1 (fails open): the span is read as well as the item. Item 2 (fails closed):
// articles, intensifiers and the question's own words name nothing. Item 3 (fails open): a lent subject never
// outruns the words.
import { describe, expect, it } from "vitest";
import { planHardRule } from "./hard-rule";
import { fixtureRule } from "./testing/arb-hard-rule";
import { PRIOR_EID, TURN_AT, TURN_EID, buildEvidence, emptyRules, hardRuleTurn, personEid, spanAt, validateContext } from "./testing/arb-writes";
import type { AllergyVerdict, FastItem, Subject } from "./types";
import { validateItems } from "./validate";
import { cueHasOwnObject, itemNamesNothing } from "./names-own";

const SELF: Subject = { entityId: null, mention: null, isSelf: true };
const NONE: Subject = { entityId: null, mention: null, isSelf: false };
const BRO = personEid("brother");

const proofText = "I might be allergic to peanuts.";
const peanutProof = spanAt(PRIOR_EID, proofText, 0, proofText.length - 1);
const anonPeanut = { ...fixtureRule("anonpeanutt0", null, "peanut", "pending"), proof: peanutProof };
const selfShellfish = { ...fixtureRule("selfshellfisht0", "self", "shellfish", "pending"), proof: spanAt(PRIOR_EID, "Shellfish, I think.", 0, 9) };
const broPeanut = { ...fixtureRule("bropeanutt0", BRO, "peanut", "pending"), proof: peanutProof };

type R = typeof anonPeanut;

function answer(text: string, item: string, subject: Subject, polarity: "affirmed" | "denied", R: R, mention?: string) {
  const phrase = text.replace(/[.!?]$/, "");
  const subj: Subject = mention === undefined ? subject : { entityId: null, mention: spanAt(TURN_EID, text, text.indexOf(mention), text.indexOf(mention) + mention.length), isSelf: false };
  const fi: FastItem = { kind: "allergy", subject: subj, item, severity: "allergy", polarity, act: "direct", span: spanAt(TURN_EID, text, 0, phrase.length) };
  const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
  const out = { items: [fi], need: "none" as const };
  const answering = { rule: R };
  const verdicts = validateItems(out, validateContext(e, { routes: new Set(["hardRule"]), speakerCertain: true, answering }));
  const rules = emptyRules();
  rules.allergies.push(R);
  const plan = planHardRule(rules, verdicts, hardRuleTurn(e, out, { trigger: { regex: true, candidate: true, asked: true }, speakerCertain: true, answering }));
  const v = verdicts[0]!;
  return { v: v.kind === "allergy" ? v.v : (v as unknown as AllergyVerdict), kept: plan.rules.allergies.find((x) => x.id === R.id), plan };
}

describe("item 1: the span is read as well as the item", () => {
  it("an anonymous peanut rule asked: answers naming something else never take or clear it", () => {
    const cases: [string, string, Subject, "affirmed" | "denied", string?][] = [
      ["My brother is allergic to stuff too.", "stuff", NONE, "affirmed", "My brother"],
      ["Nobody here is allergic to that other thing, no.", "thing", NONE, "denied"],
      ["No, nobody is allergic to shellfish.", "allergic", NONE, "denied"],
      ["No, nobody is allergic to shellfish.", "nobody", NONE, "denied"],
      ["No, nobody is allergic to shellfish.", "", NONE, "denied"],
    ];
    for (const [t, item, s, p, m] of cases) {
      const { v, kept, plan } = answer(t, item, s, p, anonPeanut, m);
      expect(kept?.state, `${t} (${item}): ${JSON.stringify(v)}`).toBe("pending");
      expect(plan.rules.allergies.filter((x) => x.code === "peanut" && x.id !== anonPeanut.id), t).toEqual([]);
    }
    // Shellfish named in a denial about no one is still filed by coverage.
    const { plan } = answer("No, nobody is allergic to shellfish.", "nobody", NONE, "denied", anonPeanut);
    expect(plan.rules.allergies.some((x) => x.code === "shellfish")).toBe(true);
  });
  it("the owner's pending shellfish rule asked: denials naming another thing don't remove it", () => {
    for (const [t, item] of [
      ["I'm not allergic to the other thing.", "thing"],
      ["I'm not allergic to durian.", "allergic"],
    ] as const) {
      const { v, kept } = answer(t, item, SELF, "denied", selfShellfish);
      expect(kept?.state, `${t}: ${JSON.stringify(v)}`).toBe("pending");
    }
  });
  it("the asked allergen's own alias is not another thing", () => {
    const { v } = answer("Yes, I'm allergic to peanuts.", "allergic", SELF, "affirmed", anonPeanut);
    expect(v).toMatchObject({ kind: "affirm", subject: "self", codes: ["peanut"] });
    expect(cueHasOwnObject("Yes, I'm allergic to peanuts too", "peanut")).toBe(false);
    expect(cueHasOwnObject("Yes, I'm allergic to durian", "peanut")).toBe(true);
  });
  it("a generic noun names nothing only beside a pointer or quantifier", () => {
    expect(itemNamesNothing("that stuff", "No, I'm not allergic to that stuff", "peanut")).toBe(true);
    expect(itemNamesNothing("stuff", "No, I'm not allergic to that stuff", "peanut")).toBe(true);
    expect(itemNamesNothing("stuff", "My brother is allergic to stuff too", "peanut")).toBe(false);
    expect(itemNamesNothing("thing", "I'm not allergic to the other thing", "peanut")).toBe(false);
    expect(itemNamesNothing("that kind of thing", "No, I'm not allergic to that kind of thing", "peanut")).toBe(true);
  });
});

describe("item 2: echoes of the question name nothing", () => {
  it("the owner's pending shellfish rule asked: affirmations make it active, with no all-food filter", () => {
    for (const [t, item, s] of [
      ["It's a real reaction.", "a real reaction", SELF],
      ["It's a real reaction.", "", SELF],
      ["Yes, it's an allergy.", "an allergy", NONE],
      ["Yes, I'm really allergic.", "really allergic", SELF],
      ["Yes, I'm allergic to that food.", "that food", SELF],
    ] as const) {
      const { v, plan } = answer(t, item, s, "affirmed", selfShellfish);
      expect(v, t).toMatchObject({ kind: "affirm", subject: "self", codes: ["shellfish"] });
      expect(plan.rules.allergies.some((x) => x.code === "unresolved"), t).toBe(false);
    }
  });
  it("denials of the question remove it", () => {
    for (const [t, item, s] of [
      ["No, just a dislike.", "a dislike", NONE],
      ["No, just a dislike.", "", SELF],
      ["No, it's not an allergy.", "an allergy", NONE],
    ] as const) {
      const { v, kept } = answer(t, item, s, "denied", selfShellfish);
      expect(v, t).toMatchObject({ kind: "deny", subject: "self", codes: ["shellfish"] });
      expect(kept, t).toBeUndefined();
    }
  });
});

describe("item 3: a lent subject never outruns the words", () => {
  it("\"Not mine.\" about the brother's pending rule is a denial for self, and the brother's rule stays", () => {
    for (const s of [NONE, SELF]) {
      const { v, kept } = answer("Not mine.", "", s, "denied", broPeanut);
      expect(v).toMatchObject({ kind: "deny", subject: "self", codes: ["peanut"] });
      expect(kept?.state).toBe("pending");
    }
  });
  it("a span naming no one still takes the brother's subject", () => {
    const { v, kept } = answer("No, it's just a dislike.", "", NONE, "denied", broPeanut);
    expect(v).toMatchObject({ kind: "deny", subject: BRO, codes: ["peanut"] });
    expect(kept).toBeUndefined();
  });
});
