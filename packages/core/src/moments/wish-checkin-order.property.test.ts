// Feature: one-shot time (brief 023), property "A wish never follows its start, and a check-in never precedes its
// end" (spec §5 Occasion row). For any occasion in any zone, a derived wish is due strictly before the start and
// closes at the start, and a derived check-in is due at or after the occasion's end (an instant occasion's end, or its
// start for a day-only date, design note 023 gap 5). Every moment closes at or after it is due.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { msFromTs } from "../schema/primitives";
import { deriveOccasion } from "./derive";
import { memId, momentHasher, occasionMemory, occasionSpecArb } from "./testing/arb-moments";

describe("one-shot time: wish and check-in order", () => {
  it("a wish is due before the start, a check-in at or after the end", () => {
    fc.assert(
      fc.property(occasionSpecArb, (spec) => {
        const m = occasionMemory(memId(1), spec);
        const out = deriveOccasion(m, new Map([[m.logicalId, m]]), momentHasher);
        const t = m.time;
        for (const p of out.plans) {
          expect(p.closeAt).toBeGreaterThanOrEqual(p.dueAt);
          if (t === null) continue;
          const start = msFromTs(t.start);
          if (p.kind === "wish") {
            expect(p.dueAt).toBeLessThan(start);
            expect(p.closeAt).toBe(start);
          }
          if (p.kind === "checkIn") {
            const end = t.precision === "instant" ? (t.end === null ? start : msFromTs(t.end)) : start;
            expect(p.dueAt).toBeGreaterThanOrEqual(end);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
