// Feature: one-shot time (brief 023), property "Nothing fires unresolved" (spec §5 "No wish fires until the time
// resolves"; KS03). For any set of occasions, some with no time, a month or a range, and for any of them corrected
// to an unresolved time after their moments were derived, no tick at any world time opens a moment whose source
// Memory's time is unresolved now, and derive plans nothing for an unresolved one.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Memory } from "../schema/records";
import { deriveOccasion, isResolved } from "./derive";
import { memId, momentHasher, occasionMemory, occasionSpecArb, rowsOf, START_MAX, START_MIN } from "./testing/arb-moments";
import { planTick, sourceVerdict } from "./tick";

describe("one-shot time: nothing fires unresolved", () => {
  it("no opened moment has an unresolved source", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ spec: occasionSpecArb, unresolvedLater: fc.boolean() }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: START_MIN, max: START_MAX + 10 * 86_400_000 }),
        (items, worldNow) => {
          const originals = items.map((it, i) => occasionMemory(memId(i), it.spec));
          const current = new Map<string, Memory>(originals.map((m, i) => [m.logicalId, items[i]!.unresolvedLater ? { ...m, time: null, rev: m.rev + 1 } : m]));
          const owner = new Map<string, string>();
          const plans = originals.flatMap((m) => {
            const out = deriveOccasion(m, new Map([[m.logicalId, m]]), momentHasher);
            if (out.plans.length > 0) expect(isResolved(m.time)).toBe(true);
            for (const p of out.plans) owner.set(p.momentId, m.logicalId);
            return out.plans;
          });
          const transitions = planTick({
            rows: rowsOf(plans),
            worldNow,
            opsNow: START_MIN,
            source: (id) => sourceVerdict(current.get(owner.get(id) ?? "") ?? null),
            passes: () => true,
          });
          for (const t of transitions) {
            if (t.to !== "leased") continue;
            expect(isResolved(current.get(owner.get(t.momentId)!)!.time)).toBe(true);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});
