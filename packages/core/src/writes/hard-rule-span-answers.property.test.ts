// Feature: voice-writes (brief 018, task 0), Property 4f: an answer whose span names something else never takes,
// answers or clears the asked rule, whatever its `item` holds. Report 012 "Open before wave B" item 1: `namesNothing`
// read only `item`, so a head noun ("thing", "stuff"), a cue word ("allergic"), "nobody" or an empty item over a span
// naming another allergen, an off-table word or "the other thing" took or cleared the asked rule R. Now an asked rule
// is answered, or its code taken, only when every alias in the span has R's code; a generic noun names nothing only
// beside a pointer or quantifier; a cue word names nothing only when its cue has no object of its own in the span; an
// otherness word (other, another, different, else) names its own. Generator: `testing/arb-span-answers.ts`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { spanCaseArb, runSpanCase } from "./testing/arb-span-answers";

describe("Property 4f: a span that names something else never answers the asked rule", () => {
  it("keeps R as it was and adds no rule with R's code", () => {
    let seen = 0;
    fc.assert(
      fc.property(spanCaseArb, (c) => {
        const r = runSpanCase(c);
        if (r === null) return;
        seen++;
        const { R, plan, added, v, what } = r;
        const kept = plan.rules.allergies.find((x) => x.id === R.id);
        expect(kept?.state, `${what}: R was removed or changed; verdict ${JSON.stringify(v)}`).toBe(R.state);
        expect(
          added.filter((x) => x.code === R.code).map((x) => [x.subjectId, x.state]),
          `${what}: a rule with R's code was added; verdict ${JSON.stringify(v)}`,
        ).toEqual([]);
      }),
      { numRuns: 1000 },
    );
    expect(seen).toBeGreaterThan(0);
  });
});
