// Feature: review of the hero and food (brief 037), Property 2: the ingredient table is at least the oracle.
// For every ingredient in the product's table that the hand-written oracle names (food/testing/prepared-foods-oracle.ts,
// written without reading the product's table), the product's allergen tags are a superset of the oracle's, and a
// food the oracle calls prepared (its makeup varies by brand) never claims a complete profile in the product.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INGREDIENTS } from "./ingredients";
import { PREPARED_FOODS_ORACLE } from "./testing/prepared-foods-oracle";

const PRODUCT = new Map(INGREDIENTS.map((i) => [i.id, i]));
const NAMED = PREPARED_FOODS_ORACLE.filter((o) => PRODUCT.has(o.id));

describe("Property 2: the ingredient table is at least the oracle", () => {
  it("the oracle names the product's ingredients", () => expect(NAMED.length).toBeGreaterThan(40));

  it("every tag the oracle gives is in the product's tags, and a prepared food never claims a complete profile", () => {
    fc.assert(
      fc.property(fc.constantFrom(...NAMED), (o) => {
        const p = PRODUCT.get(o.id)!;
        for (const code of o.commonly) expect(p.allergens, `${o.id} lacks ${code}`).toContain(code);
        if (o.varies) expect(p.known === false || p.profile === "varies", `${o.id} claims a complete profile`).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});
