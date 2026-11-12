/**
 * Hard rules fail closed (brief 024; spec §6 "It fails quiet, except for hard rules, which fail closed"). 1,000 runs.
 *   FOR ALL food candidates and contexts whose rule data is missing or unreadable, the verdict is never say, and the
 *   fixed line "Allergy data unavailable, recommend no food." is given instead.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HARD_RULE_FAIL_LINE, gate } from "./gate";
import { candidateArb, contextArb } from "./testing/arb";

describe("gate: hard rules fail closed", () => {
  it("says no food candidate without rule data", () => {
    fc.assert(
      fc.property(candidateArb, contextArb, fc.constantFrom("missing", "unreadable" as const), (c, x, rules) => {
        const r = gate({ ...c, food: true }, { ...x, rules });
        expect(r.verdict).not.toBe("say");
        expect(r.verdict).not.toBe("card");
        expect(r.fixedLine).toBe(HARD_RULE_FAIL_LINE);
      }),
      { numRuns: 1000 },
    );
  });
});
