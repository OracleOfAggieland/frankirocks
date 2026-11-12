// Feature: hero loop and food (brief 022), Property P4: every number in the loop's comparison has a source (spec §10
// "Loop", contracts Money `LoopResult`, KJ03). For any loop, rows, coverage and world time, when the comparison
// states amounts:
//   - every cited ID is an input bank row, cited once, on a date of its own window;
//   - `beforeCents` and `afterCents` are the sums of `beforeIds` and `afterIds`, to the cent;
//   - `deltaCents` is `beforeCents - afterCents`;
//   - `beforeCents` equals the baseline's stored value (the rows didn't move under it);
//   - `rootKeys` holds the root key of every cited row.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loopPredicate } from "./loop";
import { loopCaseArb, oracleDates, oracleLocal } from "./testing/arb-patterns";

describe("Property P4: every number in the comparison has a source", () => {
  it("amounts equal the sums of the rows they cite", () => {
    fc.assert(
      fc.property(loopCaseArb, (c) => {
        const r = loopPredicate({ loop: c.loop, purchases: c.purchases, bankCoverage: c.coverage, worldNow: c.worldNow });
        expect(r.associationOnly).toBe(true);
        const bank = new Map(c.purchases.map((p) => [p.id, p]));
        const dateOf = (id: string) => {
          const at = bank.get(id)!.bank.purchaseAt;
          return at.civilDate ?? oracleLocal(Date.parse(at.instant!), c.loop.baseline.zone).date;
        };
        const check = (ids: readonly string[], from: string, to: string) => {
          expect(new Set(ids).size).toBe(ids.length);
          const dates = new Set(oracleDates(from, to));
          for (const id of ids) {
            expect(bank.has(id), `cited ${id} is not a bank row`).toBe(true);
            expect(dates.has(dateOf(id)), `${id} on ${dateOf(id)} is outside ${from}..${to}`).toBe(true);
          }
          return ids.reduce((a, id) => a + bank.get(id)!.bank.amountCents, 0);
        };
        if (r.beforeCents !== null) {
          expect(r.beforeCents).toBe(check(r.beforeIds, c.loop.baseline.fromCivil, c.loop.baseline.toCivil));
          expect(r.beforeCents).toBe(c.loop.baseline.valueCents);
        }
        if (r.afterCents !== null) expect(r.afterCents).toBe(check(r.afterIds, c.loop.comparison.fromCivil, c.loop.comparison.toCivil));
        if (r.deltaCents !== null) {
          expect(r.beforeCents).not.toBeNull();
          expect(r.afterCents).not.toBeNull();
          expect(r.deltaCents).toBe(r.beforeCents! - r.afterCents!);
        }
        if (r.status === "eligible") expect(r.afterCents!).toBeLessThan(r.beforeCents!);
        const keys = new Set(r.rootKeys);
        for (const id of [...r.beforeIds, ...r.afterIds]) expect(keys.has(bank.get(id)!.rootKey)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});
