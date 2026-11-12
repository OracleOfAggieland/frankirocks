/**
 * The model cannot ask for the owner (brief 033 property 4, finding 3; spec §6 "'Asked' is decided by code ... The
 * speaking model calling `recall("mom")` after 'Long day' isn't asking"). 1,000 runs.
 *   FOR ALL candidates, contexts and owner turns, changing only the recall's query terms (which the voice model
 *   chooses) never turns a verdict into `say`, and never changes the verdict at all.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gate } from "./gate";
import { WORDS, candidateArb, contextArb } from "./testing/arb";

const query = fc.array(fc.oneof(fc.constantFrom(...WORDS), fc.constantFrom("long day mom", "long", "day")), { maxLength: 4 });

describe("gate: the model cannot ask for the owner", () => {
  it("gives the same verdict whatever query terms the model sends", () => {
    fc.assert(
      fc.property(candidateArb, contextArb, query, query, fc.constantFrom("recall", "unprompted", "jarTap" as const), (c, x0, q1, q2, trigger) => {
        const x = { ...x0, trigger };
        const a = gate({ ...c, queryTerms: q1 }, x);
        const b = gate({ ...c, queryTerms: q2 }, x);
        if (a.verdict !== "say") expect(b.verdict).not.toBe("say");
        expect(b.verdict).toBe(a.verdict);
      }),
      { numRuns: 1000 },
    );
  });
});
