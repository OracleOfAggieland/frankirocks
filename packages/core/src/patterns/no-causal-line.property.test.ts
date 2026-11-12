// Feature: review of the hero and food (brief 037), Property 5: no causal word on any line.
// For any numbers, every spoken line and every card line of the offer, the comparison and the celebrate passes the
// guard; and the card's lines exist whenever the offer does, so a guarded-out card line can't hide a causal word.
// The causal words are written out here by hand, independent of the product's list.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { celebration } from "./loop";
import { takeoutLateMeetingV1 } from "./takeout";
import { heroInput } from "./testing/hero-fixture";
import type { LoopResult, PatternResult } from "./types";
import { comparisonLines, heroOfferCardLines, heroOfferLine } from "./words";

const CAUSAL = /\b(because|cause|causes|caused|causing|thanks to|won back|led to|leads to|due to|so you saved|resulted in|made you)\b/i;
const BASE: PatternResult = takeoutLateMeetingV1(heroInput());

const patternArb: fc.Arbitrary<PatternResult> = fc
  .record({
    totalCents: fc.integer({ min: 0, max: 10_000_000 }),
    lateCents: fc.integer({ min: 0, max: 10_000_000 }),
    orderCount: fc.integer({ min: 0, max: 500 }),
    lateOrderCount: fc.integer({ min: 0, max: 500 }),
    unit: fc.constantFrom<"night" | "day">("night", "day"),
    status: fc.constantFrom<PatternResult["status"]>("eligible", "eligible", "partial", "insufficient"),
    mostly: fc.boolean(),
  })
  .map((r) => ({ ...BASE, ...r, associationUnit: r.unit }));

const loopArb: fc.Arbitrary<LoopResult> = fc
  .record({
    before: fc.integer({ min: 0, max: 10_000_000 }),
    after: fc.integer({ min: 0, max: 10_000_000 }),
    metric: fc.constantFrom<"takeoutSpend" | "totalFoodSpend">("takeoutSpend", "totalFoodSpend"),
    windowDates: fc.integer({ min: 1, max: 60 }),
  })
  .map((r) => ({
    associationOnly: true as const,
    status: "eligible" as const,
    metric: r.metric,
    beforeCents: r.before,
    afterCents: r.after,
    deltaCents: r.before - r.after,
    claim: r.metric === "takeoutSpend" ? ("categoryLess" as const) : ("netReductionScoped" as const),
    beforeIds: [],
    afterIds: [],
    rootKeys: [],
    why: null,
    windowDates: r.windowDates,
  }));

describe("Property 5: no causal word on any line", () => {
  it("the offer and its card", () => {
    fc.assert(
      fc.property(patternArb, (p) => {
        const line = heroOfferLine(p);
        const card = heroOfferCardLines(p);
        if (line !== null) {
          expect(line).not.toMatch(CAUSAL);
          expect(card, "an offer without its card").not.toBeNull();
        }
        for (const l of card ?? []) expect(l).not.toMatch(CAUSAL);
      }),
      { numRuns: 1000 },
    );
  });

  it("the comparison and the celebrate", () => {
    fc.assert(
      fc.property(loopArb, loopArb, (takeout, food) => {
        for (const l of comparisonLines(takeout) ?? []) expect(l).not.toMatch(CAUSAL);
        const loop = { state: "waiting" } as Parameters<typeof celebration>[0];
        for (const l of celebration(loop, { ...takeout, metric: "takeoutSpend", claim: "categoryLess" }, { ...food, metric: "totalFoodSpend", claim: "netReductionScoped" })?.lines ?? []) expect(l).not.toMatch(CAUSAL);
      }),
      { numRuns: 1000 },
    );
  });
});
