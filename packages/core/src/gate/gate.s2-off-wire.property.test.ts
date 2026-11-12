/**
 * S2 stays off the wire in the floor build (brief 024; spec §6 line 218, §3 line 120; contracts KC09 "F S2 off
 * wire, allergies exempt"). 1,000 runs.
 *   FOR ALL candidates whose sensitivity is S2 and that are not allergies, and every floor-build context, a say or a
 *   card carries one of the three logged carve-outs (opened-topic owner recall, jar tap, told check-in), and the
 *   carve-out matches its trigger.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gate } from "./gate";
import { candidateArb, contextArb } from "./testing/arb";

describe("gate: S2 stays off the wire in the floor build", () => {
  it("sends S2 only through a logged carve-out", () => {
    fc.assert(
      fc.property(candidateArb, contextArb, (c0, x0) => {
        const c = { ...c0, sens: "S2" as const, allergy: false };
        const x = { ...x0, build: "floor" as const };
        const r = gate(c, x);
        if (r.verdict !== "say" && r.verdict !== "card") return;
        expect(["openedTopicRecall", "jarTap", "checkIn"]).toContain(r.carveOut);
        if (r.carveOut === "openedTopicRecall") expect(x.trigger).toBe("recall");
        if (r.carveOut === "jarTap") expect(x.trigger).toBe("jarTap");
        expect(r.reasons).toContain("carveOut");
      }),
      { numRuns: 1000 },
    );
  });
});
