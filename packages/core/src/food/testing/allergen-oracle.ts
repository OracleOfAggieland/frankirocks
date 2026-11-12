/**
 * An independent copy of the allergen families, for the food properties' oracles. Written out by hand from the
 * gazetteer's `includes` column (docs/briefs/012-design.md section 2.1), not read from `writes/gazetteer.ts`, so a
 * fault in the product's table or its closure can't hide itself. Known codes and domains come from
 * `writes/testing/gazetteer-oracle.ts`, the other independent copy.
 */
import { ORACLE_GAZETTEER } from "../../writes/testing/gazetteer-oracle";

const FAMILIES: Record<string, readonly string[]> = {
  nuts: ["peanut", "tree_nut"],
  tree_nut: ["almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "brazil_nut", "macadamia", "pine_nut", "chestnut"],
  seafood: ["fish", "shellfish"],
  fish: ["salmon", "tuna", "cod", "halibut", "tilapia", "trout", "mackerel", "anchovy", "sardine"],
  shellfish: ["crustacean", "mollusc"],
  crustacean: ["shrimp", "crab", "lobster", "crayfish"],
  mollusc: ["clam", "mussel", "oyster", "scallop", "squid", "octopus", "snail"],
  gluten: ["wheat", "barley", "rye"],
  pet_dander: ["cat", "dog"],
};

/** The code and everything under it. */
export function oracleBelow(code: string): Set<string> {
  const out = new Set<string>([code]);
  const walk = (c: string) => {
    for (const k of FAMILIES[c] ?? []) {
      if (!out.has(k)) {
        out.add(k);
        walk(k);
      }
    }
  };
  walk(code);
  return out;
}

/** True when a rule on `ruleCode` must keep away an ingredient flagged `ingredientCode`. */
export const oracleConflicts = (ruleCode: string, ingredientCode: string): boolean =>
  oracleBelow(ruleCode).has(ingredientCode) || oracleBelow(ingredientCode).has(ruleCode);

export const oracleKnown = (code: string): boolean => code !== "none" && Object.prototype.hasOwnProperty.call(ORACLE_GAZETTEER, code);
export const oracleIsFood = (code: string): boolean => ORACLE_GAZETTEER[code]?.domain === "food";

export const ORACLE_FOOD_CODES: readonly string[] = Object.keys(ORACLE_GAZETTEER).filter((c) => c !== "none" && oracleIsFood(c));
export const ORACLE_OTHER_CODES: readonly string[] = Object.keys(ORACLE_GAZETTEER).filter((c) => c !== "none" && !oracleIsFood(c));
