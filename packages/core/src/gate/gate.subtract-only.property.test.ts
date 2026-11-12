/**
 * The Gate's modifiers only subtract (brief 024; spec §6 "Audience ... Modifiers only subtract"). 1,000 runs.
 *   FOR ALL candidates and pairs of contexts where the second only narrows the first (the audience leaves private,
 *   or rushed or crisis turns on), the narrower verdict is never more open, so a silent, hold or card never
 *   becomes say.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gate } from "./gate";
import { GATE_VERDICTS } from "./reasons";
import { candidateArb, narrowingArb } from "./testing/arb";

const rank = (v: (typeof GATE_VERDICTS)[number]) => GATE_VERDICTS.length - GATE_VERDICTS.indexOf(v);

describe("gate: modifiers only subtract", () => {
  it("narrowing the audience never opens the verdict", () => {
    fc.assert(
      fc.property(candidateArb, narrowingArb, (c, { wide, narrow }) => {
        const w = gate(c, wide);
        const n = gate(c, narrow);
        if (w.verdict !== "say") expect(n.verdict).not.toBe("say");
        expect(rank(n.verdict)).toBeLessThanOrEqual(rank(w.verdict));
      }),
      { numRuns: 1000 },
    );
  });
});
