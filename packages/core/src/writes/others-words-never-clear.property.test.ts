// Brief 032, property "Another person's words never clear a rule" (finding H3). For any stored rules (the owner's,
// the brother's, the sister's and anonymous ones, active or pending) and any turn about subject X (the owner or the
// brother: an affirmation, a hedge, a denial or "can't have", with any FastSlots answer and either speaker
// certainty), every rule whose subject is not X, an anonymous one included, is still there afterwards, unless it was
// the asked rule and this turn answered it.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { BROTHER_EID, SELF, answerArb, answerFor, emptyRules, planTurn } from "./testing/arb-review";
import { SISTER, TURN_EID, spanAt } from "./testing/arb-writes";
import type { FastItem, Polarity, Subject } from "./types";

type Rule = CoreRules["allergies"][number];

const CODES = ["peanut", "shellfish", "sesame", "unresolved"] as const;
const WORD: Record<string, string> = { peanut: "peanuts", shellfish: "shellfish", sesame: "sesame", unresolved: "peanuts" };
const SUBJECTS = ["self", BROTHER_EID, SISTER, null] as const;

const ruleArb: fc.Arbitrary<Rule> = fc
  .record({ s: fc.constantFrom(...SUBJECTS), code: fc.constantFrom(...CODES), active: fc.boolean(), n: fc.nat(99) })
  .map(({ s, code, active, n }) => ({
    id: `r${n}${String(s).slice(0, 4)}${code}`.padEnd(43, "x").slice(0, 43),
    subjectId: s,
    code,
    // An anonymous rule and an `unresolved` one are only ever pending.
    state: active && s !== null && code !== "unresolved" ? "active" : "pending",
    anonymous: s === null,
    proof: null,
    proofRev: null,
    rootKeys: [],
    dependsOn: [],
  }));

/** One rule per slot, as the planner keeps them. */
const rulesArb = fc.uniqueArray(ruleArb, { maxLength: 6, selector: (r) => `${r.subjectId ?? ""}|${r.code}` });

type Shape = "affirm" | "hedge" | "deny" | "cantHave";
function turnAbout(who: "self" | "brother", shape: Shape, word: string): { text: string; careful: FastItem[] } {
  const lead = who === "self" ? { cue: "I'm", have: "I can't", not: "I'm not" } : { cue: "My brother's", have: "My brother can't", not: "My brother isn't" };
  const s =
    shape === "affirm" ? `${lead.cue} allergic to ${word}` : shape === "hedge" ? `${lead.cue} maybe allergic to ${word}` : shape === "deny" ? `${lead.not} allergic to ${word}` : `${lead.have} have ${word}, it's an allergy`;
  const text = `${s}.`;
  const polarity: Polarity = shape === "deny" ? "denied" : shape === "hedge" ? "uncertain" : "affirmed";
  const subject: Subject = who === "self" ? SELF : { entityId: null, mention: spanAt(TURN_EID, text, 0, "My brother".length), isSelf: false };
  return { text, careful: [{ kind: "allergy", subject, item: word, severity: "allergy", polarity, act: "direct", span: spanAt(TURN_EID, text, 0, s.length) }] };
}

describe("Another person's words never clear a rule (brief 032)", () => {
  it("a turn about X leaves every rule of another subject, unless it answered the asked rule", () => {
    fc.assert(
      fc.property(
        rulesArb,
        fc.constantFrom<"self" | "brother">("self", "brother"),
        fc.constantFrom<Shape>("affirm", "hedge", "deny", "cantHave"),
        fc.constantFrom("peanuts", "shellfish", "sesame"),
        answerArb,
        fc.boolean(),
        fc.option(fc.nat(5), { freq: 2 }),
        (priors, who, shape, word, spec, speakerCertain, askedAt) => {
          const rules = { ...emptyRules(), allergies: priors.map((r) => ({ ...r })) };
          const pendings = rules.allergies.filter((r) => r.state === "pending");
          const R = askedAt === null || pendings.length === 0 ? null : pendings[askedAt % pendings.length]!;
          const t = turnAbout(who, shape, word);
          const out = answerFor(spec, t.careful, t.text);
          const plan = planTurn(t.text, out, rules, speakerCertain, R === null ? null : { rule: R });
          const X = who === "self" ? "self" : BROTHER_EID;
          for (const r of priors) {
            if (!r.anonymous && r.subjectId === X) continue;
            if (R !== null && r.id === R.id) continue;
            expect(plan.rules.allergies.some((x) => x.id === r.id), `"${t.text}" removed ${r.subjectId ?? "anyone"}:${r.code} (${r.state}); asked ${R?.id ?? "nothing"}; answer ${JSON.stringify(out)}`).toBe(true);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});
