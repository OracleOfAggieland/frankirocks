// The 40 scripted food moments (spec §10: the gate is 0 hard-rule misses in 40 scripted food moments), and the three
// quick dinners for late-meeting nights. Each moment names the ingredients that must never come back, written out
// by hand, so the check doesn't lean on the product's own allergen tree.
import { describe, expect, it } from "vitest";
import { testId } from "../testing/samples";
import { CATALOG } from "./catalog";
import type { FoodRule } from "./filter";
import { ingredient } from "./ingredients";
import { QUICK_DINNER_MAX_MINUTES, RULES_UNAVAILABLE_LINE, SELF, groceryItems, suggestFood } from "./suggest";

const ANA = testId("ana");
const BO = testId("bo");
let n = 0;
const rule = (code: string, subjectId: string | null = SELF, state: "active" | "pending" = "active"): FoodRule => ({
  id: testId(`r${n++}`),
  subjectId,
  code,
  state,
  anonymous: subjectId === null,
  proof: null,
  proofRev: null,
  rootKeys: [],
  dependsOn: [],
});

const SHELLFISH = ["shrimp", "mixed_seafood"];
const FISH = ["salmon_fillet", "cod_fillet", "fish_sauce", "mixed_seafood"];
const PEANUT = ["peanut_butter"];
const TREE_NUT = ["cashews", "pesto"];
const MILK = ["parmesan", "cheddar", "butter", "yogurt", "pesto"];
const WHEAT = ["pasta", "flour_tortillas", "bread", "soy_sauce"];
const SOY = ["tofu", "soy_sauce"];
const EGG = ["egg"];
const SESAME = ["sesame_oil"];
const RED_MEAT = ["ground_beef", "pork_chop"];
const CHICKEN = ["chicken_thigh", "chicken_breast"];
const COCONUT = ["coconut_milk"];
const ALL_INGREDIENTS = CATALOG.flatMap((c) => c.ingredientIds);

type Expect = "three" | "none" | "some";
type Moment = [label: string, attendees: string[], rules: FoodRule[] | null, forbidden: string[], expect: Expect];

const MOMENTS: Moment[] = [
  ["no rules, owner alone", [], [], [], "three"],
  ["owner's shellfish rule", [], [rule("shellfish")], SHELLFISH, "three"],
  ["owner's shrimp rule", [], [rule("shrimp")], SHELLFISH, "three"],
  ["owner's crustacean rule", [], [rule("crustacean")], SHELLFISH, "three"],
  ["owner's seafood rule", [], [rule("seafood")], [...SHELLFISH, ...FISH], "three"],
  ["owner's fish rule", [], [rule("fish")], FISH, "three"],
  ["owner's salmon rule", [], [rule("salmon")], ["salmon_fillet", "mixed_seafood"], "three"],
  ["owner's anchovy rule", [], [rule("anchovy")], ["fish_sauce", "mixed_seafood"], "three"],
  ["owner's peanut rule", [], [rule("peanut")], PEANUT, "three"],
  ["owner's nut rule", [], [rule("nuts")], [...PEANUT, ...TREE_NUT], "three"],
  ["owner's tree nut rule", [], [rule("tree_nut")], TREE_NUT, "three"],
  ["owner's cashew rule", [], [rule("cashew")], ["cashews"], "three"],
  ["owner's pine nut rule", [], [rule("pine_nut")], ["pesto"], "three"],
  ["owner's milk rule", [], [rule("milk")], MILK, "three"],
  ["owner's egg rule", [], [rule("egg")], EGG, "three"],
  ["owner's wheat rule", [], [rule("wheat")], WHEAT, "three"],
  ["owner's gluten rule", [], [rule("gluten")], WHEAT, "three"],
  ["owner's soy rule", [], [rule("soy")], SOY, "three"],
  ["owner's sesame rule", [], [rule("sesame")], SESAME, "three"],
  ["owner's red meat rule", [], [rule("red_meat")], RED_MEAT, "three"],
  ["owner's chicken rule", [], [rule("chicken")], CHICKEN, "three"],
  ["owner's coconut rule", [], [rule("coconut")], COCONUT, "three"],
  ["pending shellfish rule filters as active", [], [rule("shellfish", SELF, "pending")], SHELLFISH, "three"],
  ["anonymous pending peanut rule covers everyone", [], [rule("peanut", null, "pending")], PEANUT, "three"],
  ["guest's shellfish rule, guest attends", [ANA], [rule("shellfish", ANA)], SHELLFISH, "three"],
  ["guest's pending milk rule, guest attends", [ANA], [rule("milk", ANA, "pending")], MILK, "three"],
  ["guest's egg rule, guest absent", [], [rule("egg", ANA)], [], "three"],
  ["two guests, two rules", [ANA, BO], [rule("wheat", ANA), rule("milk", BO)], [...WHEAT, ...MILK], "some"],
  ["owner and guest, shellfish and peanut", [ANA], [rule("shellfish"), rule("peanut", ANA)], [...SHELLFISH, ...PEANUT], "three"],
  ["three rules on the owner", [], [rule("egg"), rule("milk"), rule("soy")], [...EGG, ...MILK, ...SOY], "some"],
  ["unresolved allergen removes everything", [], [rule("unresolved", SELF, "pending")], ALL_INGREDIENTS, "none"],
  ["unresolved anonymous allergen removes everything", [ANA], [rule("unresolved", null, "pending")], ALL_INGREDIENTS, "none"],
  ["off-table allergen word removes everything", [], [rule("durian")], ALL_INGREDIENTS, "none"],
  ["guest's unresolved rule, guest absent", [], [rule("unresolved", BO, "pending")], [], "three"],
  ["rules unreadable", [], null, ALL_INGREDIENTS, "none"],
  ["latex rule leaves food alone", [], [rule("latex")], [], "three"],
  ["pollen and shellfish", [], [rule("pollen"), rule("shellfish")], SHELLFISH, "three"],
  ["mollusc rule keeps away mixed seafood", [], [rule("mollusc")], ["mixed_seafood"], "three"],
  ["guest's fish rule and owner's nut rule", [BO], [rule("fish", BO), rule("nuts")], [...FISH, ...PEANUT, ...TREE_NUT], "three"],
  ["milk, egg and wheat together", [ANA], [rule("milk"), rule("egg", ANA), rule("wheat", ANA, "pending")], [...MILK, ...EGG, ...WHEAT], "some"],
];

describe("40 scripted food moments", () => {
  it("has 40 moments", () => expect(MOMENTS.length).toBe(40));

  it.each(MOMENTS)("%s", (_label, attendees, rules, forbidden, expectKind) => {
    const out = suggestFood({ rules, attendeeIds: attendees });
    const held = out.candidates.flatMap((c) => c.ingredientIds);
    for (const id of forbidden) expect(held, `returned ${id}`).not.toContain(id);
    // The catalog's one ingredient of unknown status never comes back.
    expect(held).not.toContain("curry_paste");
    if (expectKind === "three") expect(out.candidates).toHaveLength(3);
    if (expectKind === "none") expect(out.candidates).toEqual([]);
    if (expectKind === "some") expect(out.candidates.length).toBeGreaterThan(0);
    for (const c of out.candidates) expect(c.minutes).toBeLessThanOrEqual(QUICK_DINNER_MAX_MINUTES);
  });
});

describe("three quick dinners for late-meeting nights", () => {
  it("come out of the catalog for a person with no rules", () => {
    const out = suggestFood({ rules: [], attendeeIds: [] });
    expect(out.candidates.map((c) => c.id)).toEqual(["veggie_omelet", "black_bean_tacos", "chicken_quesadillas"]);
    expect(out.selectedId).toBe("veggie_omelet");
    expect(out.reason).toEqual({ code: "fitsGap", text: "Ready in 10 minutes" });
  });

  it("come out of the catalog for a person with a shellfish rule, with no shellfish", () => {
    const out = suggestFood({ rules: [rule("shellfish")], attendeeIds: [] });
    expect(out.candidates).toHaveLength(3);
    for (const c of out.candidates) for (const id of c.ingredientIds) expect(ingredient(id)?.allergens ?? ["?"]).not.toContain("shrimp");
    expect(out.filter.removed.filter((r) => r.reason === "rule").map((r) => r.id).sort()).toEqual(["seafood_pasta", "shrimp_fried_rice"]);
  });

  it("an excluded dinner is held back and the next one comes up", () => {
    const out = suggestFood({ rules: [], attendeeIds: [], excludeIds: ["black_bean_tacos"] });
    expect(out.candidates.map((c) => c.id)).toEqual(["veggie_omelet", "chicken_quesadillas", "pesto_pasta"]);
  });

  it("with rules unreadable, nothing is suggested and the fixed line is the question", () => {
    const out = suggestFood({ rules: null, attendeeIds: [] });
    expect(out.candidates).toEqual([]);
    expect(out.question).toBe(RULES_UNAVAILABLE_LINE);
  });

  it("a place from memory is never returned: its allergen status is unknown", () => {
    const place = { id: testId("place"), kind: "place" as const, version: 1, name: "Corner noodle bar", meal: "dinner" as const, minutes: 5, ingredientIds: [], manifestVersion: null };
    const out = suggestFood({ rules: [], attendeeIds: [], catalog: [place, ...CATALOG] });
    expect(out.candidates.map((c) => c.id)).not.toContain(place.id);
    expect(out.filter.removed).toContainEqual({ id: place.id, reason: "unknownAllergen", ruleId: null });
  });

  it("a manifest that lists nothing, or an ingredient code the gazetteer doesn't know, is unknown status", () => {
    const empty = { id: testId("empty"), kind: "recipe" as const, version: 1, name: "Empty", meal: "dinner" as const, minutes: 5, ingredientIds: [], manifestVersion: "recipes1" };
    const odd = { id: testId("odd"), kind: "recipe" as const, version: 1, name: "Odd", meal: "dinner" as const, minutes: 5, ingredientIds: ["odd"], manifestVersion: "recipes1" };
    const table = (id: string) => (id === "odd" ? { id, label: "odd", allergens: ["Peanuts"], known: true } : ingredient(id));
    const out = suggestFood({ rules: [rule("peanut")], attendeeIds: [], catalog: [empty, odd, ...CATALOG], table });
    expect(out.candidates.map((c) => c.id)).not.toContain(empty.id);
    expect(out.candidates.map((c) => c.id)).not.toContain(odd.id);
    expect(out.filter.removed.filter((r) => r.reason === "unknownAllergen").map((r) => r.id)).toEqual(expect.arrayContaining([empty.id, odd.id]));
  });

  it("a garlic rule keeps away pesto", () => {
    const out = suggestFood({ rules: [rule("garlic")], attendeeIds: [] });
    expect(out.filter.removed.map((r) => r.id)).toContain("pesto_pasta");
  });

  it("groceries are the dinners' ingredients, once each", () => {
    const out = suggestFood({ rules: [], attendeeIds: [] });
    const items = groceryItems(out.candidates);
    expect(items).toContain("eggs");
    expect(items).toContain("black beans");
    expect(new Set(items).size).toBe(items.length);
  });

  it("the catalog uses plain dish names and generic ingredients", () => {
    for (const c of CATALOG) expect(c.name).toMatch(/^[A-Z][a-z -]+$/);
    for (const id of ALL_INGREDIENTS) expect(ingredient(id), id).not.toBeNull();
  });
});
