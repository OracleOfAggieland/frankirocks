// Feature: one-shot time (brief 023), property "Time only asks" (spec §5 "A passed bound opens a question. It never
// quietly changes belief"; "Expiring a soft constraint removes its effect without establishing the opposite"; a
// bounded fact "Never applies to core/rules"). For any Memories with bounds and any world time past them, derive and
// the tick change no Memory (every input is deep-equal afterwards) and plan only expiryAsk moments. Applicability is
// end-exclusive; a rule or an allergy still applies after its validTo and asks nothing; an expired soft preference
// reads neutral, never the opposite value.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tsFromMs } from "../schema/primitives";
import type { Memory } from "../schema/records";
import { sampleMemory, testId } from "../testing/samples";
import { appliesAt, softEffectAt } from "./applicability";
import { deriveExpiry } from "./derive";
import { momentHasher, rowsOf } from "./testing/arb-moments";
import { planTick } from "./tick";

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 5, 1);

const memArb = fc.record({
  kind: fc.constantFrom<Memory["kind"]>("fact", "preference", "rule", "event"),
  allergy: fc.boolean(),
  fromDays: fc.integer({ min: -60, max: 0 }),
  lengthDays: fc.integer({ min: 0, max: 60 }),
  status: fc.constantFrom<Memory["status"]>("active", "active", "history", "alleged"),
});

describe("one-shot time: time only asks", () => {
  it("a passed bound changes no Memory and opens only a question", () => {
    fc.assert(
      fc.property(fc.array(memArb, { minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 30 }), (specs, extraDays) => {
        const memories = specs.map((s, i) =>
          sampleMemory({
            logicalId: testId(`bounded-${i}`),
            kind: s.kind,
            predicate: s.allergy ? "allergy" : s.kind === "preference" ? "preference.food" : "fact",
            status: s.status,
            validFrom: tsFromMs(BASE + s.fromDays * DAY),
            validTo: tsFromMs(BASE + (s.fromDays + s.lengthDays) * DAY),
          }),
        );
        const before = structuredClone(memories);
        const worldNow = BASE + (Math.max(...specs.map((s) => s.fromDays + s.lengthDays)) + extraDays) * DAY;
        const plans = memories.flatMap((m) => deriveExpiry(m, "UTC", momentHasher).plans);
        for (const p of plans) expect(p.kind).toBe("expiryAsk");
        planTick({ rows: rowsOf(plans), worldNow, opsNow: BASE, source: () => "ok", passes: () => true });
        expect(memories).toEqual(before);
        for (const m of memories) {
          const ruleLike = m.kind === "rule" || m.predicate === "allergy";
          if (ruleLike) {
            expect(appliesAt(m, worldNow)).toBe(m.status === "active");
            expect(plans.some((p) => p.source.id === m.logicalId)).toBe(false);
          } else {
            expect(appliesAt(m, worldNow)).toBe(false);
            expect(softEffectAt(m, worldNow)).toBe(m.kind === "preference" ? "neutral" : "none");
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
