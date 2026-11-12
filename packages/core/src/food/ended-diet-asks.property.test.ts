// Brief 039, property 4: an ended diet is asked about once per food moment and never assumed over. Until the owner
// answers, every dinner offered is right under the diet (by the independent kinds table), and the question is
// first in the result: one question, naming the diet.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INGREDIENT_KINDS_ORACLE, type OracleKind } from "../testing/ingredient-kinds-oracle";
import { foodPrefsOf } from "./prefs";
import { suggestFood } from "./suggest";
import { ZONE, memoriesOf, prefCaseArb, wordsOfCase } from "./testing/pref-cases";

const LEAVES_OUT: Record<string, readonly OracleKind[]> = {
  vegetarian: ["meat", "poultry", "fish", "shellfish"],
  vegan: ["meat", "poultry", "fish", "shellfish", "dairy", "egg", "honey"],
  pescatarian: ["meat", "poultry"],
};
const KINDS = new Map(INGREDIENT_KINDS_ORACLE.map((o) => [o.id, o.kinds]));

describe("property 4: an ended diet is asked about, and never assumed over", () => {
  it("until answered, the question comes first and every dinner keeps the diet", () => {
    fc.assert(
      fc.property(prefCaseArb, (c) => {
        const prefs = foodPrefsOf({ memories: memoriesOf(c), at: c.at, zone: ZONE, applies: (s) => s === "self", wordsOf: wordsOfCase(c) });
        const out = suggestFood({ rules: c.rules, attendeeIds: [], prefs });
        const ended = c.diets
          .filter((d) => d.active && d.subjectId === "self" && d.validFrom <= c.at && d.code in LEAVES_OUT && d.validTo !== null && d.validTo <= c.at)
          .sort((a, b) => (a.memory.id < b.memory.id ? -1 : 1));
        if (ended.length === 0) {
          expect(out.question === null || !out.question.startsWith("Still ")).toBe(true);
          return;
        }
        const first = ended[0]!;
        expect(out.question, "the question is first").not.toBeNull();
        expect(out.question!.startsWith(`Still ${first.code}, or was `)).toBe(true);
        expect(out.question!.split("Still ").length - 1, "asked once").toBe(1);
        for (const d of ended)
          for (const dinner of out.candidates)
            for (const id of dinner.ingredientIds) expect((KINDS.get(id) ?? ["meat"]).filter((k) => LEAVES_OUT[d.code]!.includes(k)), `${dinner.id} holds ${id}; ${d.code} ended, unanswered`).toEqual([]);
      }),
      { numRuns: 1000 },
    );
  });
});
