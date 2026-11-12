// Feature: hero loop and food (brief 022), Property F1: zero hard-rule misses (spec §10, KJ01, contracts `suggest`).
// For any attendees, any active, pending or unresolved allergy rules, any excludes and any catalog (recipes with
// closed manifests, recipes holding ingredients outside the table or of unknown status, and places), no candidate
// `suggestFood` returns:
//   - holds an ingredient whose allergen code any covering rule reaches, in either direction of the family tree
//     (a rule covers when its subject attends, the owner always attends, and a rule with no subject covers everyone);
//   - has unknown allergen status (an ingredient outside the table, `known:false`, or a place with no manifest);
//   - is excluded;
// and nothing is returned when the rules can't be read or a covering rule's code isn't a known allergen.
// The oracle's allergen families are an independent copy (food/testing/allergen-oracle.ts).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testId } from "../testing/samples";
import type { FoodCandidate } from "./catalog";
import { CATALOG } from "./catalog";
import type { FoodRule } from "./filter";
import { INGREDIENTS, type Ingredient } from "./ingredients";
import { SELF, suggestFood } from "./suggest";
import { ORACLE_FOOD_CODES, ORACLE_OTHER_CODES, oracleConflicts, oracleIsFood, oracleKnown } from "./testing/allergen-oracle";

const PEOPLE = [SELF, testId("ana"), testId("bo"), testId("cy")];
const STRANGER = testId("stranger");

/** A wider ingredient table for the property: the real one, plus unknown-status and invented allergen rows. */
const EXTRA: Ingredient[] = [
  { id: "mystery_sauce", label: "house sauce", allergens: [], known: false },
  { id: "crab_cakes", label: "crab cakes", allergens: ["crab", "wheat", "egg"], known: true },
  { id: "nut_mix", label: "mixed nuts", allergens: ["nuts"], known: true },
  { id: "tree_nut_mix", label: "tree nut mix", allergens: ["tree_nut"], known: true },
  { id: "shellfish_stock", label: "shellfish stock", allergens: ["shellfish"], known: true },
  { id: "seafood_stock", label: "seafood stock", allergens: ["seafood"], known: true },
  { id: "barley", label: "pearl barley", allergens: ["barley"], known: true },
  { id: "tahini", label: "tahini", allergens: ["sesame"], known: true },
];
const TABLE = new Map<string, Ingredient>([...INGREDIENTS, ...EXTRA].map((i) => [i.id, i]));
const table = (id: string) => TABLE.get(id) ?? null;
const INGREDIENT_IDS = [...TABLE.keys(), "not_in_table"];

const ruleArb: fc.Arbitrary<FoodRule> = fc
  .record({
    n: fc.nat(1_000_000),
    subject: fc.constantFrom<string | null>(...PEOPLE, STRANGER, null),
    code: fc.oneof(
      { weight: 8, arbitrary: fc.constantFrom(...ORACLE_FOOD_CODES) },
      { weight: 2, arbitrary: fc.constantFrom(...ORACLE_OTHER_CODES) },
      { weight: 1, arbitrary: fc.constantFrom("unresolved", "durian", "none") },
    ),
    state: fc.constantFrom<"active" | "pending">("active", "pending"),
  })
  .map(({ n, subject, code, state }) => ({
    id: testId(`rule${n}`),
    subjectId: subject,
    code,
    state,
    anonymous: subject === null,
    proof: null,
    proofRev: null,
    rootKeys: [],
    dependsOn: [],
  }));

const recipeArb: fc.Arbitrary<FoodCandidate> = fc
  .record({
    n: fc.nat(1_000_000),
    minutes: fc.integer({ min: 5, max: 60 }),
    ingredientIds: fc.uniqueArray(fc.constantFrom(...INGREDIENT_IDS), { minLength: 1, maxLength: 7 }),
    isPlace: fc.nat(9).map((x) => x === 0),
  })
  .map(({ n, minutes, ingredientIds, isPlace }) => ({
    id: testId(`c${n}`),
    kind: isPlace ? "place" : "recipe",
    version: 1,
    name: `Dish ${n}`,
    meal: "dinner",
    minutes,
    ingredientIds: isPlace ? [] : ingredientIds,
    manifestVersion: isPlace ? null : "recipes1",
  }));

const catalogArb = fc.oneof(
  fc.constant([...CATALOG]),
  fc.uniqueArray(recipeArb, { maxLength: 20, selector: (c) => c.id }),
  fc.tuple(fc.subarray([...CATALOG]), fc.uniqueArray(recipeArb, { maxLength: 8, selector: (c) => c.id })).map(([a, b]) => [...a, ...b]),
);

const caseArb = catalogArb.chain((catalog) =>
  fc.record({
    catalog: fc.constant(catalog),
    attendees: fc.subarray(PEOPLE),
    rules: fc.oneof({ weight: 12, arbitrary: fc.array(ruleArb, { maxLength: 6 }) }, { weight: 1, arbitrary: fc.constant(null) }),
    excludes: fc.subarray(catalog.map((c) => c.id)),
    maxMinutes: fc.constantFrom(30, 60),
  }),
);

describe("Property F1: zero hard-rule misses", () => {
  it("no candidate returned holds an ingredient a covering rule reaches, or has unknown allergen status", () => {
    fc.assert(
      fc.property(caseArb, ({ catalog, attendees, rules, excludes, maxMinutes }) => {
        const out = suggestFood({ rules, attendeeIds: attendees, excludeIds: excludes, catalog, table, maxMinutes });
        const returned = out.candidates;
        if (rules === null) {
          expect(returned).toEqual([]);
          return;
        }
        const present = new Set([SELF, ...attendees]);
        const covering = rules.filter((r) => r.subjectId === null || present.has(r.subjectId));
        if (covering.some((r) => !oracleKnown(r.code))) {
          expect(returned).toEqual([]);
          return;
        }
        for (const c of returned) {
          expect(c.manifestVersion).not.toBeNull();
          expect(excludes).not.toContain(c.id);
          for (const id of c.ingredientIds) {
            const ing = TABLE.get(id);
            expect(ing, `ingredient ${id} of ${c.id} is outside the table`).toBeDefined();
            expect(ing!.known, `ingredient ${id} of ${c.id} has unknown status`).toBe(true);
            for (const r of covering) {
              if (!oracleIsFood(r.code)) continue;
              for (const a of ing!.allergens) expect(oracleConflicts(r.code, a), `${c.id} holds ${a}; rule ${r.code} (${r.state}) on ${r.subjectId}`).toBe(false);
            }
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
