// Feature: hero loop and food (brief 022), Property P5: equal windows (spec §10 "Equal windows, same weekday mix",
// contracts Money "equalwindows/weekdaymix/currency", "A comparison without equal coverage says nothing"). For any
// loop, rows, coverage and world time, a comparison is stated (status `eligible`, or any worded line) only when:
//   - the world time has reached `checkAt`, and the loop isn't cancelled;
//   - both windows have the same number of dates and the same weekday mix (counted here from the dates);
//   - both windows are in the same currency;
//   - every date of both windows is covered by the bank coverage (no missing range touches it).
// A cancelled loop always reads `cancelled`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loopPredicate } from "./loop";
import { loopCaseArb, oracleDates, oracleWeekday } from "./testing/arb-patterns";
import { comparisonLines } from "./words";

const mix = (dates: readonly string[]) => {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dates) out[oracleWeekday(d)]! += 1;
  return out;
};

describe("Property P5: a comparison is stated only over equal windows", () => {
  it("eligible needs equal length, weekday mix, currency and full coverage", () => {
    fc.assert(
      fc.property(loopCaseArb, (c) => {
        const r = loopPredicate({ loop: c.loop, purchases: c.purchases, bankCoverage: c.coverage, worldNow: c.worldNow });
        const words = comparisonLines(r);
        if (c.loop.state === "cancelled") expect(r.status).toBe("cancelled");
        if (words !== null) expect(r.status).toBe("eligible");
        if (r.status !== "eligible") return;
        const b = oracleDates(c.loop.baseline.fromCivil, c.loop.baseline.toCivil);
        const k = oracleDates(c.loop.comparison.fromCivil, c.loop.comparison.toCivil);
        expect(c.worldNow).toBeGreaterThanOrEqual(Date.parse(c.loop.checkAt));
        expect(k.length).toBe(b.length);
        expect(mix(k)).toEqual(mix(b));
        expect(c.loop.comparison.currency).toBe(c.loop.baseline.currency);
        for (const d of [...b, ...k]) expect(c.uncovered.has(d), `${d} is not covered`).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});
