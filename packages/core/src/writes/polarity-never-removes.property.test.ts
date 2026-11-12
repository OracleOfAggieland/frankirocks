// Brief 025, question W-187: "a rule is never removed by the model's polarity alone". For any stored rule (the
// owner's or an anonymous one, pending or active), any owner's line (an affirmation, a denial, both, or neither), any
// FastSlots answer for it (any polarity, item and subject), either speaker certainty, and a question asked or not, a
// rule stored before the turn is gone afterwards only when an active rule for the same code now filters for its
// subject, or when it was the asked rule, this turn answers it, and the owner's own words deny it and carry no
// affirming cue.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { SELF, emptyRules, planTurn } from "./testing/arb-review";
import { TURN_EID, spanAt } from "./testing/arb-writes";
import type { FastItem, FastSlotsOut, Polarity, Subject } from "./types";

type Rule = CoreRules["allergies"][number];
const NOBODY: Subject = { entityId: null, mention: null, isSelf: false };

/** Each line with what a reader sees in it: a denial, an affirming cue for peanuts, both, or neither. */
const LINES: readonly { text: string; denies: boolean; affirms: boolean }[] = [
  { text: "I'm allergic to peanuts.", denies: false, affirms: true },
  { text: "I can't eat peanuts, I'm allergic.", denies: false, affirms: true },
  { text: "Peanuts. I can't have them.", denies: false, affirms: true },
  { text: "No.", denies: true, affirms: false },
  { text: "Nope, not allergic.", denies: true, affirms: false },
  { text: "I'm not allergic to peanuts.", denies: true, affirms: false },
  { text: "I don't have any allergies.", denies: true, affirms: false },
  { text: "No, I'm allergic to peanuts.", denies: true, affirms: true },
  { text: "I'm not allergic, I just can't eat peanuts.", denies: true, affirms: true },
  { text: "Not sure about peanuts.", denies: false, affirms: false },
];

const ruleArb: fc.Arbitrary<Rule> = fc
  .record({ anon: fc.boolean(), code: fc.constantFrom("peanut", "unresolved"), active: fc.boolean() })
  .map(({ anon, code, active }) => ({
    id: `w187${anon ? "a" : "s"}${code}`.padEnd(43, "x").slice(0, 43),
    subjectId: anon ? null : "self",
    code,
    state: active && !anon && code !== "unresolved" ? "active" : "pending",
    anonymous: anon,
    proof: null,
    proofRev: null,
    rootKeys: [],
    dependsOn: [],
  }));

const rulesArb = fc.uniqueArray(ruleArb, { minLength: 1, maxLength: 3, selector: (r) => `${r.anonymous}|${r.code}` });

const answerArb = fc.record({
  polarity: fc.constantFrom<Polarity>("affirmed", "denied", "uncertain"),
  item: fc.constantFrom("peanuts", "allergies", "it", ""),
  self: fc.boolean(),
  present: fc.boolean(),
});

describe("A rule is never removed by the model's polarity alone (brief 025, W-187)", () => {
  it("a stored rule leaves only for an active rule on its code, or as the asked rule the owner's words deny", () => {
    fc.assert(
      fc.property(rulesArb, fc.nat(LINES.length - 1), answerArb, fc.boolean(), fc.option(fc.nat(2), { freq: 2 }), (priors, lineAt, ans, speakerCertain, askedAt) => {
        const line = LINES[lineAt]!;
        const text = line.text;
        const rules = { ...emptyRules(), allergies: priors.map((r) => ({ ...r })) };
        const pendings = rules.allergies.filter((r) => r.state === "pending");
        const R = askedAt === null || pendings.length === 0 ? null : pendings[askedAt % pendings.length]!;
        const item: FastItem = {
          kind: "allergy",
          subject: ans.self ? SELF : NOBODY,
          item: ans.item,
          severity: "allergy",
          polarity: ans.polarity,
          act: "direct",
          span: spanAt(TURN_EID, text, 0, text.length - 1),
        };
        const out: FastSlotsOut = { items: ans.present ? [item] : [], need: "none" };
        const plan = planTurn(text, out, rules, speakerCertain, R === null ? null : { rule: R });
        for (const r of priors) {
          if (plan.rules.allergies.some((x) => x.id === r.id)) continue;
          const filtered = plan.rules.allergies.some((x) => x.state === "active" && (x.code === r.code || r.code === "unresolved") && (r.anonymous || x.subjectId === r.subjectId));
          const deniedAsked = R !== null && R.id === r.id && line.denies && !line.affirms;
          expect(filtered || deniedAsked, `"${text}" removed ${r.subjectId ?? "anyone"}:${r.code} (${r.state}); asked ${R?.id ?? "nothing"}; answer ${JSON.stringify(ans)}; certain ${speakerCertain}`).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
