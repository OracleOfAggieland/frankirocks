// Brief 046 property "Cents are exact": for any provider amount with at most two decimals, the cents are that amount
// times 100 exactly and the sign holds; an amount with a third decimal is refused. Seed recorded in brief 046's Outcome.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BANK_CENTS_MAX, centsOf } from "./index";

describe("property: cents are exact (brief 046)", () => {
  it("1,000 runs", () => {
    fc.assert(
      fc.property(fc.integer({ min: -BANK_CENTS_MAX, max: BANK_CENTS_MAX }), fc.integer({ min: 1, max: 9 }), (cents, third) => {
        // The amount as Plaid's JSON carries it: a decimal with at most two places, parsed to a number.
        const amount = Number(`${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`);
        const got = centsOf(amount);
        expect(got).toBe(cents === 0 ? 0 : cents);
        if (got !== null && got !== 0) expect(Math.sign(got)).toBe(Math.sign(amount));
        // One more decimal place is not a whole number of cents.
        const sub = Number(`${String(amount)}${String(amount).includes(".") ? "" : "."}${"0".repeat(Math.max(0, 2 - (String(amount).split(".")[1]?.length ?? 0)))}${third}`);
        if (Math.abs(cents) < 1e12) expect(centsOf(sub)).toBeNull();
      }),
      { numRuns: 1000 },
    );
  });
});
