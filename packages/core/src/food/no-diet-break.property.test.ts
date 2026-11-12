// Brief 039, property 1: no dinner breaks a live diet. For any stored diets, dislikes and allergy rules and any
// world time, no dinner `suggestFood` offers holds an ingredient that the independent kinds table
// (testing/ingredient-kinds-oracle.ts) says the owner's live diet leaves out, or one the owner dislikes. A diet past
// its end that nobody answered still counts as live: the dinners offered are right both ways.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INGREDIENT_KINDS_ORACLE, type OracleKind } from "../testing/ingredient-kinds-oracle";
import { foodPrefsOf } from "./prefs";
import { suggestFood } from "./suggest";
import { ZONE, memoriesOf, prefCaseArb, wordsOfCase } from "./testing/pref-cases";

// Written here from the diets' plain meaning, not from the product's DIETS.
const LEAVES_OUT: Record<string, readonly OracleKind[]> = {
  vegetarian: ["meat", "poultry", "fish", "shellfish"],
  vegan: ["meat", "poultry", "fish", "shellfish", "dairy", "egg", "honey"],
  pescatarian: ["meat", "poultry"],
};
const KINDS = new Map(INGREDIENT_KINDS_ORACLE.map((o) => [o.id, o.kinds]));

describe("property 1: no dinner breaks a live diet", () => {
  it("no offered dinner holds what the owner's live diet leaves out, or what the owner dislikes", () => {
    fc.assert(
      fc.property(prefCaseArb, (c) => {
        const prefs = foodPrefsOf({ memories: memoriesOf(c), at: c.at, zone: ZONE, applies: (s) => s === "self", wordsOf: wordsOfCase(c) });
        const out = suggestFood({ rules: c.rules, attendeeIds: [], prefs });
        const live = c.diets.filter((d) => d.active && d.subjectId === "self" && d.validFrom <= c.at && d.code in LEAVES_OUT);
        const disliked = c.dislikes.filter((d) => d.counts && d.subjectId === "self" && d.ingredientId !== null).map((d) => d.ingredientId!);
        for (const dinner of out.candidates) {
          for (const id of dinner.ingredientIds) {
            for (const d of live) {
              const bad = (KINDS.get(id) ?? ["meat"]).filter((k) => LEAVES_OUT[d.code]!.includes(k));
              expect(bad, `${dinner.id} holds ${id} (${bad.join(", ")}); the owner is ${d.code}${d.validTo !== null && d.validTo <= c.at ? " (ended, unanswered)" : ""}`).toEqual([]);
            }
            expect(disliked, `${dinner.id} holds ${id}, which the owner dislikes`).not.toContain(id);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
