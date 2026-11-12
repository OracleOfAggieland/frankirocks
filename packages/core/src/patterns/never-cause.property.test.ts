// Feature: hero loop and food (brief 022), Property P3: never a cause (spec §6 "Patterns are never called causes",
// §10, contracts Money "never won back/because/caused/thanks-to"). For any detector output and any comparison, real
// (from generated rows) or made up (any status, unit and amounts), no worded line holds a causal word or phrase, in
// any letter case. The word list is written out here, not read from the product.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { takeoutLateMeetingV1 } from "./takeout";
import { loopPredicate } from "./loop";
import { loopCaseArb, patternCaseArb } from "./testing/arb-patterns";
import type { LoopResult, PatternResult } from "./types";
import { comparisonLines, heroOfferLine } from "./words";

const CAUSAL = /\b(because|caused?|causes|causing|thanks to|won back|led to|leads? to|due to|so you saved|as a result|results? in|made you|helped you)\b/i;

const centsArb = fc.integer({ min: -100_000, max: 1_000_000 });

const madePattern: fc.Arbitrary<PatternResult> = fc
  .record({ status: fc.constantFrom("eligible", "insufficient", "partial"), unit: fc.constantFrom("night", "day"), total: centsArb, late: centsArb, count: fc.nat(40), lateCount: fc.nat(40), mostly: fc.boolean() })
  .map((r) => ({
    associationOnly: true,
    detectorVersion: "takeout_late_meeting_v1",
    status: r.status as PatternResult["status"],
    associationUnit: r.unit as PatternResult["associationUnit"],
    totalCents: r.total,
    orderCount: r.count,
    lateCents: r.late,
    lateOrderCount: r.lateCount,
    mostly: r.mostly,
    window: { fromCivil: "2026-10-01", toCivil: "2026-10-21", zone: "UTC", currency: "USD", coverage: { state: "complete", from: null, to: null, missingRanges: [], generation: 0 }, purchaseIds: [], valueCents: r.total, weekdayCounts: [3, 3, 3, 3, 3, 3, 3] },
    coveredDates: 21,
    latePurchaseIds: [],
    lateRefundIds: [],
    meetingIds: [],
    receiptIds: [],
    rootKeys: [],
    excluded: [],
  }));

const madeLoop: fc.Arbitrary<LoopResult> = fc
  .record({
    status: fc.constantFrom("waiting", "incomplete", "noChange", "eligible", "cancelled"),
    metric: fc.constantFrom("takeoutSpend", "totalFoodSpend"),
    before: fc.option(centsArb),
    after: fc.option(centsArb),
    claim: fc.constantFrom("categoryLess", "netReductionScoped", "none"),
    days: fc.integer({ min: 1, max: 60 }),
  })
  .map((r) => ({
    associationOnly: true,
    status: r.status as LoopResult["status"],
    metric: r.metric as LoopResult["metric"],
    beforeCents: r.before,
    afterCents: r.after,
    deltaCents: r.before === null || r.after === null ? null : r.before - r.after,
    claim: r.claim as LoopResult["claim"],
    beforeIds: [],
    afterIds: [],
    rootKeys: [],
    why: null,
    windowDates: r.days,
  }));

const lines = (p: PatternResult | null, l: LoopResult | null): string[] => [...(p === null ? [] : [heroOfferLine(p)]), ...(l === null ? [] : (comparisonLines(l) ?? []))].filter((x): x is string => x !== null);

describe("Property P3: never a cause", () => {
  it("no worded line holds a causal word", () => {
    const arb = fc.oneof(
      patternCaseArb.map((c) => lines(takeoutLateMeetingV1(c.input), null)),
      loopCaseArb.map((c) => lines(null, loopPredicate({ loop: c.loop, purchases: c.purchases, bankCoverage: c.coverage, worldNow: c.worldNow }))),
      fc.tuple(madePattern, madeLoop).map(([p, l]) => lines(p, l)),
    );
    fc.assert(
      fc.property(arb, (said) => {
        for (const s of said) expect(CAUSAL.test(s), s).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});
