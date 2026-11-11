// Feature: voice-writes (brief 012), Property 4d: "mine" in an answer names the speaker, and a denial naming a
// person never clears an anonymous rule (design 2.4 answering rule 2, rows A8 and A9; CQ 159 as amended by CQ 160).
// Through `validateItems` then `planHardRule`, on certain, direct, one-item answers to an asked pending rule R
// (`testing/arb-plain-answers.ts`):
//   - "mine" with a negation ("Not mine.", "It isn't mine.") is a denial for `self`, when the item says `isSelf` or R
//     has no subject to lend it (answering rule 2 gives an item with no subject R's subject first);
//   - "mine" among answer words only ("Mine too.", "The allergy is mine.") is an affirm for `self` with R's code,
//     for an anonymous R with a gazetteer code;
//   - after a negated "mine", or a denial whose span names a person ("My brother doesn't.", "She isn't."), an asked
//     anonymous R is still in `core/rules`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plainCaseArb, runPlainCase } from "./testing/arb-plain-answers";

describe("Property 4d: \"mine\" names the speaker in an answer, and a denial naming a person never clears an anonymous rule", () => {
  it("holds for every asked pending rule and line", () => {
    const seen = { negMine: 0, affMine: 0, stays: 0 };
    fc.assert(
      fc.property(plainCaseArb(["negMine", "affMine", "someoneDeny"]), (c) => {
        const { R, v, plan, what } = runPlainCase(c);
        if (c.kind === "negMine" && (c.selfSubject || R.subjectId === null)) {
          seen.negMine++;
          expect(v.kind === "allergy" && v.v.kind === "deny" && "subject" in v.v && v.v.subject === "self", `${what}: verdict ${JSON.stringify(v)}`).toBe(true);
        }
        if (c.kind === "affMine" && R.anonymous && R.code !== "unresolved") {
          seen.affMine++;
          expect(v.kind === "allergy" && v.v.kind === "affirm" && v.v.subject === "self" && v.v.codes.includes(R.code), `${what}: verdict ${JSON.stringify(v)}`).toBe(true);
        }
        if ((c.kind === "negMine" || c.kind === "someoneDeny") && R.anonymous) {
          seen.stays++;
          expect(plan.rules.allergies.some((r) => r.id === R.id), `${what}: the anonymous rule left`).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
    expect(seen.negMine).toBeGreaterThan(0);
    expect(seen.affMine).toBeGreaterThan(0);
    expect(seen.stays).toBeGreaterThan(0);
  });
});
