import { describe, expect, it } from "vitest";
import { testId } from "../testing/samples";
import { celebration, loopPredicate, loopStateAfter, markCelebrated, planHeroLoop } from "./loop";
import { takeoutLateMeetingV1 } from "./takeout";
import { HERO_ACCEPTED_AT, HERO_AFTER_GROCERIES, HERO_AFTER_ORDERS, HERO_BASELINE_GROCERIES, HERO_COVERAGE, HERO_ORDERS, bankRow, heroInput } from "./testing/hero-fixture";
import { comparisonLines } from "./words";

const pattern = takeoutLateMeetingV1(heroInput());
const loop = planHeroLoop(pattern, HERO_ACCEPTED_AT, testId("act"))!;
const AFTER_CHECK = Date.parse(loop.checkAt) + 60_000;
const rows = [...HERO_ORDERS, ...HERO_BASELINE_GROCERIES, ...HERO_AFTER_ORDERS, ...HERO_AFTER_GROCERIES];

describe("the hero loop", () => {
  it("'yes' plans equal windows: the baseline, then as many dates from the day after", () => {
    expect(loop).toMatchObject({
      metric: "takeoutSpend",
      predicateVersion: "takeout_late_meeting_v1",
      state: "waiting",
      baseline: { fromCivil: "2026-10-05", toCivil: "2026-10-25", valueCents: 18600, weekdayCounts: [3, 3, 3, 3, 3, 3, 3] },
      comparison: { fromCivil: "2026-10-27", toCivil: "2026-11-16", valueCents: null, purchaseIds: [], weekdayCounts: [3, 3, 3, 3, 3, 3, 3] },
      checkAt: "2026-11-17T06:00:00.000Z",
    });
  });

  it("before checkAt it waits", () => {
    expect(loopPredicate({ loop, purchases: rows, bankCoverage: HERO_COVERAGE, worldNow: AFTER_CHECK - 120_000 }).status).toBe("waiting");
  });

  it("three weeks on: $71, down from $186 over the same three weeks, $115 less on takeout", () => {
    const r = loopPredicate({ loop, purchases: rows, bankCoverage: HERO_COVERAGE, worldNow: AFTER_CHECK });
    expect(r).toMatchObject({ associationOnly: true, status: "eligible", beforeCents: 18600, afterCents: 7100, deltaCents: 11500, claim: "categoryLess", windowDates: 21 });
    expect(r.afterIds).toEqual(HERO_AFTER_ORDERS.map((o) => o.id));
    expect(comparisonLines(r)).toEqual(["Takeout's $71, down from $186 over the same three weeks.", "$115 less on takeout."]);
  });

  it("total food spend on the same windows may be stated when it also fell", () => {
    const food = loopPredicate({ loop, purchases: rows, bankCoverage: HERO_COVERAGE, worldNow: AFTER_CHECK, metric: "totalFoodSpend" });
    expect(food).toMatchObject({ status: "eligible", beforeCents: 30600, afterCents: 23100, claim: "netReductionScoped" });
    expect(comparisonLines(food)).toEqual(["All food spending was $231, down from $306 over the same three weeks."]);
    const takeout = loopPredicate({ loop, purchases: rows, bankCoverage: HERO_COVERAGE, worldNow: AFTER_CHECK });
    expect(celebration(loop, takeout, food)?.lines).toHaveLength(3);
  });

  it("total food that rose says nothing about total food", () => {
    const more = [...rows, bankRow("ag3", "2026-11-14", null, 20_000, "groceries")];
    const food = loopPredicate({ loop, purchases: more, bankCoverage: HERO_COVERAGE, worldNow: AFTER_CHECK, metric: "totalFoodSpend" });
    expect(food.status).toBe("noChange");
    const takeout = loopPredicate({ loop, purchases: more, bankCoverage: HERO_COVERAGE, worldNow: AFTER_CHECK });
    expect(celebration(loop, takeout, food)?.lines).toEqual(["Takeout's $71, down from $186 over the same three weeks.", "$115 less on takeout."]);
  });

  it("a miss stays silent", () => {
    const more = [...rows, bankRow("a4", "2026-11-15", 19 * 60, 15_000)];
    const r = loopPredicate({ loop, purchases: more, bankCoverage: HERO_COVERAGE, worldNow: AFTER_CHECK });
    expect(r.status).toBe("noChange");
    expect(comparisonLines(r)).toBeNull();
    expect(celebration(loop, r)).toBeNull();
  });

  it("missing coverage in either window says nothing", () => {
    const gap = { ...HERO_COVERAGE, missingRanges: [{ from: "2026-11-02T06:00:00.000Z", to: "2026-11-03T06:00:00.000Z", reason: "provider" as const }] };
    const r = loopPredicate({ loop, purchases: rows, bankCoverage: gap, worldNow: AFTER_CHECK });
    expect(r).toMatchObject({ status: "incomplete", why: "uncovered", beforeCents: null, afterCents: null });
    expect(celebration(loop, r)).toBeNull();
  });

  it("a moved baseline says nothing", () => {
    const r = loopPredicate({ loop, purchases: [...rows, bankRow("o9", "2026-10-24", 19 * 60, 500)], bankCoverage: HERO_COVERAGE, worldNow: AFTER_CHECK });
    expect(r).toMatchObject({ status: "incomplete", why: "baselineMoved" });
  });

  it("unequal windows say nothing", () => {
    const short = { ...loop, comparison: { ...loop.comparison, toCivil: "2026-11-15" } };
    expect(loopPredicate({ loop: short, purchases: rows, bankCoverage: HERO_COVERAGE, worldNow: AFTER_CHECK }).why).toBe("lengthDiffers");
  });

  it("a cancelled loop stays cancelled and silent", () => {
    const r = loopPredicate({ loop: { ...loop, state: "cancelled" }, purchases: rows, bankCoverage: HERO_COVERAGE, worldNow: AFTER_CHECK });
    expect(r.status).toBe("cancelled");
    expect(celebration({ ...loop, state: "cancelled" }, r)).toBeNull();
  });

  it("no loop for a pattern that can't carry an offer", () => {
    expect(planHeroLoop({ ...pattern, mostly: false }, HERO_ACCEPTED_AT, testId("act"))).toBeNull();
    expect(planHeroLoop({ ...pattern, status: "partial" }, HERO_ACCEPTED_AT, testId("act"))).toBeNull();
  });
});

describe("loop state", () => {
  it.each([
    ["waiting", "waiting", "waiting"],
    ["waiting", "eligible", "eligible"],
    ["waiting", "noChange", "noChange"],
    ["waiting", "incomplete", "incomplete"],
    ["incomplete", "eligible", "eligible"],
    ["eligible", "waiting", "eligible"],
    ["celebrated", "eligible", "celebrated"],
    ["noChange", "eligible", "noChange"],
    ["cancelled", "eligible", "cancelled"],
  ] as const)("%s + %s -> %s", (from, result, to) => {
    expect(loopStateAfter(from, result)).toBe(to);
  });

  it("only an eligible loop is marked celebrated, and a celebrated loop celebrates once", () => {
    expect(markCelebrated("eligible")).toBe("celebrated");
    expect(markCelebrated("noChange")).toBe("noChange");
    const r = loopPredicate({ loop, purchases: rows, bankCoverage: HERO_COVERAGE, worldNow: AFTER_CHECK });
    expect(celebration({ ...loop, state: "celebrated" }, r)).toBeNull();
  });
});
