// The reviewer's inputs for brief 037's food findings, one block per finding.
import { describe, expect, it } from "vitest";
import { testId } from "../testing/samples";
import type { FoodRule } from "./filter";
import { ingredient } from "./ingredients";
import { SELF, groceryItems, suggestFood } from "./suggest";

let n = 0;
const rule = (code: string, subjectId: string | null = SELF): FoodRule => ({
  id: testId(`rv${n++}`),
  subjectId,
  code,
  state: "active",
  anonymous: subjectId === null,
  proof: null,
  proofRev: null,
  rootKeys: [],
  dependsOn: [],
});

const labelsOf = (rules: FoodRule[]) => {
  const out = suggestFood({ rules, attendeeIds: [] });
  return { ids: out.candidates.map((c) => c.id), items: groceryItems(out.candidates), held: out.candidates.flatMap((c) => c.ingredientIds) };
};

describe("finding 3: a prepared food never claims a complete profile", () => {
  it("rules egg and cashew on self: no pesto pasta, and no basil pesto on the list", () => {
    const got = labelsOf([rule("egg"), rule("cashew")]);
    expect(got.ids).not.toContain("pesto_pasta");
    expect(got.items).not.toContain("basil pesto");
  });

  it.each(["sesame", "milk", "egg", "soy"])("a %s rule keeps bread away", (code) => {
    expect(labelsOf([rule(code)]).held).not.toContain("bread");
  });

  it.each(["walnut", "almond"])("a %s rule keeps pesto away", (code) => {
    expect(labelsOf([rule(code)]).held).not.toContain("pesto");
  });

  it("a sulphite rule removes soy sauce's and coconut milk's dinners, an alcohol or food dye rule soy sauce's", () => {
    expect(labelsOf([rule("sulphite")]).held).not.toContain("coconut_milk");
    expect(labelsOf([rule("alcohol")]).held).not.toContain("soy_sauce");
    expect(labelsOf([rule("food_dye")]).held).not.toContain("cheddar");
  });

  it("whole, single-ingredient foods keep a complete profile", () => {
    for (const id of ["egg", "chicken_thigh", "rice", "potato", "garlic", "olive_oil"]) expect(ingredient(id)?.profile ?? "complete", id).toBe("complete");
  });

  it.each(["shellfish", "egg"])("with a %s rule there are still three quick dinners", (code) => {
    expect(labelsOf([rule(code)]).ids).toHaveLength(3);
  });
});
