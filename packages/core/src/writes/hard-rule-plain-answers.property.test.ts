// Feature: voice-writes (brief 012), Property 4e: an answer naming nothing of its own takes the asked rule's code, and
// a denial on an answering turn adds no rule (design 2.4 answering rules 1 and 3, rows A8 to A10; CQ 156 as amended
// by CQ 161). P4c (committed) pins one side of CQ 156: an item naming something the gazetteer doesn't know never
// takes the asked rule's code. This file pins the other side, through `validateItems` then `planHardRule`, on
// certain, direct, one-item answers to an asked pending rule R (`testing/arb-plain-answers.ts`):
//   - an item made only of pointer, generic and cue words ("that stuff", "any of that", "either", "allergic", "that
//     allergy", "nobody"), or an empty one, takes R's code when R has a gazetteer code: its verdict carries R's code,
//     answers R or keeps R, and the turn adds no `unresolved` (all-food) rule;
//   - a denial ("No, I'm not allergic.", "Not mine.", "My brother doesn't.") adds no rule at all.
// The lines here are the wider reading CQ 161 gives `namesNothing`; P4c's written list is the narrower one.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { carriesOrAnswers, plainCaseArb, runPlainCase } from "./testing/arb-plain-answers";

describe("Property 4e: an answer naming nothing of its own answers the asked rule, and a denial adds no rule", () => {
  it("holds for every asked pending rule, line and item copy", () => {
    const seen = { generic: 0, denial: 0 };
    fc.assert(
      fc.property(plainCaseArb(["selfAffirm", "selfDeny", "nobodyDeny", "negMine", "someoneDeny"]), (c) => {
        const { R, line, v, added, what } = runPlainCase(c);
        if ((c.kind === "selfAffirm" || c.kind === "selfDeny" || c.kind === "nobodyDeny") && R.code !== "unresolved") {
          seen.generic++;
          expect(carriesOrAnswers(v, R.code, R.id), `${what}: verdict ${JSON.stringify(v)}`).toBe(true);
          expect(added.some((r) => r.code === "unresolved"), `${what}: added the all-food filter`).toBe(false);
        }
        if (line.polarity === "denied") {
          seen.denial++;
          expect(
            added.map((r) => [r.subjectId, r.code]),
            `${what}: a denial added a rule`,
          ).toEqual([]);
        }
      }),
      { numRuns: 1000 },
    );
    expect(seen.generic).toBeGreaterThan(0);
    expect(seen.denial).toBeGreaterThan(0);
  });
});
