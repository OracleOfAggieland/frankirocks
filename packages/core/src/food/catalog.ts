/**
 * The recipe catalog (spec §10, contracts `candidates`): plain dish names and closed ingredient manifests. A recipe's
 * allergen flags are computed from its manifest, never written by hand, so a flag can't drift from the ingredients.
 */
import { gazetteerEntry } from "../writes/gazetteer";
import { type Ingredient, ingredient } from "./ingredients";

export const CATALOG_VERSION = "recipes1";

export interface Recipe {
  id: string;
  version: number;
  name: string;
  meal: "dinner";
  minutes: number;
  ingredientIds: readonly string[];
}

export interface AllergenFlag {
  code: string;
  status: "contains" | "unknown";
  basis: "manifest" | "unknown";
}

/** A food candidate as the filter sees it: a recipe, or a place from memory (which has no manifest). */
export interface FoodCandidate {
  id: string;
  kind: "recipe" | "place";
  version: number;
  name: string;
  meal: "dinner";
  minutes: number;
  ingredientIds: readonly string[];
  /** Null for a place: its allergen status is unknown. */
  manifestVersion: string | null;
}

type Row = [id: string, name: string, minutes: number, ingredients: string];

const ROWS: readonly Row[] = [
  ["sheet_pan_chicken", "Sheet-pan chicken with potatoes and broccoli", 30, "chicken_thigh, potato, broccoli, olive_oil, garlic"],
  ["black_bean_tacos", "Black bean tacos", 15, "black_beans, tortillas, avocado, lime, cilantro, onion"],
  ["shrimp_fried_rice", "Shrimp fried rice", 20, "shrimp, rice, egg, frozen_peas, soy_sauce, garlic, onion"],
  ["salmon_rice_bowl", "Salmon rice bowl", 25, "salmon_fillet, rice, spinach, soy_sauce, ginger"],
  ["tomato_spinach_pasta", "Tomato and spinach pasta", 20, "pasta, canned_tomatoes, spinach, garlic, olive_oil, parmesan"],
  ["tofu_stir_fry", "Tofu and broccoli stir-fry", 20, "tofu, broccoli, bell_pepper, soy_sauce, ginger, garlic, rice"],
  ["lentil_soup", "Red lentil soup", 35, "red_lentils, carrot, onion, canned_tomatoes, cumin, olive_oil"],
  ["chicken_quesadillas", "Chicken quesadillas", 15, "chicken_breast, flour_tortillas, cheddar, bell_pepper"],
  ["veggie_omelet", "Spinach and mushroom omelet with toast", 10, "egg, spinach, mushroom, cheddar, bread"],
  ["peanut_noodles", "Peanut noodles with cabbage", 20, "rice_noodles, peanut_butter, soy_sauce, lime, cabbage, carrot"],
  ["seafood_pasta", "Garlic seafood pasta", 25, "pasta, mixed_seafood, garlic, olive_oil, tomato"],
  ["chicken_curry", "Chicken coconut curry", 30, "chicken_thigh, coconut_milk, curry_paste, rice, bell_pepper"],
  ["chickpea_curry", "Chickpea and tomato curry", 25, "chickpeas, coconut_milk, canned_tomatoes, onion, garlic, rice, cumin"],
  ["burrito_bowl", "Beef burrito bowl", 25, "ground_beef, rice, black_beans, tomato, lime, cilantro"],
  ["pork_chops", "Pork chops with green beans and sweet potato", 35, "pork_chop, green_beans, sweet_potato, olive_oil"],
  ["fish_tacos", "Cod tacos with lime slaw", 20, "cod_fillet, tortillas, cabbage, lime, yogurt"],
  ["pesto_pasta", "Pesto pasta with peas", 15, "pasta, pesto, frozen_peas, lemon"],
  ["cashew_stir_fry", "Cashew chicken stir-fry", 25, "chicken_breast, cashews, bell_pepper, soy_sauce, rice, sesame_oil"],
];

const list = (s: string) => s.split(",").map((x) => x.trim()).filter((x) => x.length > 0);

export const RECIPES: readonly Recipe[] = ROWS.map(([id, name, minutes, ingredients]) => ({ id, version: 1, name, meal: "dinner", minutes, ingredientIds: list(ingredients) }));

export const CATALOG: readonly FoodCandidate[] = RECIPES.map((r) => ({ ...r, kind: "recipe", manifestVersion: CATALOG_VERSION }));

/**
 * The allergen flags of a candidate from its manifest. An ingredient outside `table`, or one whose status is
 * unknown, gives an `unknown` flag; a place (no manifest) gives one `unknown` flag.
 */
export function allergenFlags(c: FoodCandidate, table: (id: string) => Ingredient | null = ingredient): AllergenFlag[] {
  // A place, or a manifest that lists nothing, says nothing about allergens.
  if (c.manifestVersion === null || c.ingredientIds.length === 0) return [{ code: "*", status: "unknown", basis: "unknown" }];
  const flags = new Map<string, AllergenFlag>();
  for (const id of c.ingredientIds) {
    const ing = table(id);
    if (ing === null || !ing.known) {
      flags.set(`?${id}`, { code: "*", status: "unknown", basis: "unknown" });
      continue;
    }
    for (const code of ing.allergens) {
      // A code the gazetteer doesn't know can't be matched against a rule, so the status is unknown.
      if (gazetteerEntry(code) === null) flags.set(`?${id}:${code}`, { code: "*", status: "unknown", basis: "unknown" });
      else flags.set(code, { code, status: "contains", basis: "manifest" });
    }
  }
  return [...flags.values()];
}
