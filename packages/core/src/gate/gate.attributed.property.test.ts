/**
 * Third-party and inferred text is never said unprompted as fact (brief 024; spec §6 ceiling, "Forms": "Third-party
 * claims are spoken by type and sender only"; "Franki never ... announces a guess"). 1,000 runs.
 *   FOR ALL candidates of class T or M and every context, a say is rendered only as the cell allows: T attributed;
 *   M as one offer, hedged once raised, or a topic-free door. Never free words.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gate } from "./gate";
import { candidateArb, contextArb } from "./testing/arb";

describe("gate: third-party and inferred text is never said as fact", () => {
  it("says T only attributed and M only as an offer, hedged or a door", () => {
    fc.assert(
      fc.property(candidateArb, contextArb, fc.constantFrom("T", "M" as const), (c0, x, sourceClass) => {
        const c = { ...c0, sourceClass };
        const r = gate(c, x);
        if (r.verdict !== "say") return;
        if (sourceClass === "T") expect(r.render).toBe("attributed");
        else if (r.form === "door") expect(r.render).toBe("template");
        else expect(["offer", "hedged"]).toContain(r.render);
        if (r.render === "offer") expect(c.attestedPremises).toBeGreaterThanOrEqual(2);
      }),
      { numRuns: 1000 },
    );
  });
});
