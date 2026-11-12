// Brief 039, change 2: the product's ingredient kinds are at least the hand-written oracle's
// (testing/ingredient-kinds-oracle.ts, written without reading the product's table).
import { describe, expect, it } from "vitest";
import { INGREDIENT_KINDS_ORACLE } from "../testing/ingredient-kinds-oracle";
import { INGREDIENTS, ingredient } from "./ingredients";

describe("ingredient kinds cover the oracle", () => {
  it("the oracle names every ingredient in the table, once", () => {
    expect(INGREDIENT_KINDS_ORACLE.map((o) => o.id).sort()).toEqual(INGREDIENTS.map((i) => i.id).sort());
  });

  it.each(INGREDIENT_KINDS_ORACLE.map((o) => [o.id, o] as const))("%s holds every kind the oracle lists, or its kinds are unknown", (_id, o) => {
    const ing = ingredient(o.id)!;
    if (ing.kinds === null || ing.kinds === undefined) return;
    expect(o.kinds.filter((k) => !ing.kinds!.includes(k))).toEqual([]);
  });

  it.each(INGREDIENT_KINDS_ORACLE.filter((o) => o.varies).map((o) => [o.id] as const))("%s, which varies by brand, never claims a complete profile", (id) => {
    const ing = ingredient(id)!;
    expect(ing.profile === "varies" || ing.kinds === null).toBe(true);
  });
});
