/**
 * The closed ingredient table (spec §10, contracts `candidates`). Each ingredient carries the gazetteer allergen
 * codes it holds, at the most specific level known. `known:false` means its allergen status is unknown, so any
 * recipe holding it is removed. Generic names only, no brands.
 *
 * Profiles (brief 037, finding 3). A whole, single-ingredient food has a `complete` profile: its tags are all it
 * holds, so a rule its tags don't reach leaves it alone. A prepared food whose makeup varies by brand (a sauce, a
 * bread, a cheese, canned goods) has a `varies` profile: it is tagged with the union of the allergens it commonly
 * holds, and it can't rule out anything else, so any food rule that covers someone eating removes it.
 */

export type IngredientProfile = "complete" | "varies";

export interface Ingredient {
  id: string;
  label: string;
  /** Gazetteer codes (packages/core/src/writes/gazetteer.ts). */
  allergens: readonly string[];
  known: boolean;
  /** Absent means `complete`. Every row of the product's table sets it. */
  profile?: IngredientProfile;
}

/** `V`: a prepared food whose makeup varies by brand. `U`: allergen status unknown. */
const V = "varies" as const;
const U = "unknown" as const;
type Row = [id: string, label: string, allergens: string, kind?: typeof V | typeof U];

const ROWS: readonly Row[] = [
  ["chicken_thigh", "chicken thighs", "chicken"],
  ["chicken_breast", "chicken breast", "chicken"],
  ["ground_beef", "ground beef", "red_meat"],
  ["pork_chop", "pork chops", "red_meat"],
  // Farmed salmon is often sold with colour added.
  ["salmon_fillet", "salmon fillets", "salmon, food_dye"],
  ["cod_fillet", "cod fillets", "cod"],
  // Sulphites are often used on shrimp against black spot.
  ["shrimp", "shrimp", "shrimp, sulphite"],
  ["egg", "eggs", "egg"],
  ["tofu", "firm tofu", "soy", V],
  ["black_beans", "black beans", "", V],
  ["chickpeas", "chickpeas", "chickpea", V],
  ["red_lentils", "red lentils", "lentil"],
  ["rice", "rice", "rice"],
  ["pasta", "wheat pasta", "wheat, egg", V],
  ["rice_noodles", "rice noodles", "rice, corn", V],
  ["tortillas", "corn tortillas", "corn, wheat", V],
  ["flour_tortillas", "flour tortillas", "wheat, soy, milk", V],
  ["bread", "bread", "wheat, barley, yeast, milk, egg, soy, sesame", V],
  ["potato", "potatoes", "potato"],
  ["sweet_potato", "sweet potatoes", ""],
  ["broccoli", "broccoli", ""],
  ["spinach", "spinach", ""],
  ["bell_pepper", "bell peppers", "bell_pepper"],
  ["onion", "onions", "onion"],
  ["garlic", "garlic", "garlic"],
  ["tomato", "tomatoes", "tomato"],
  ["canned_tomatoes", "canned tomatoes", "tomato, garlic, onion", V],
  ["zucchini", "zucchini", ""],
  ["carrot", "carrots", "carrot"],
  ["cabbage", "cabbage", ""],
  ["green_beans", "green beans", ""],
  ["avocado", "avocado", "avocado"],
  ["lime", "limes", "citrus"],
  ["lemon", "lemons", "citrus"],
  ["cilantro", "cilantro", "coriander"],
  ["ginger", "fresh ginger", ""],
  ["olive_oil", "olive oil", ""],
  ["sesame_oil", "sesame oil", "sesame"],
  ["soy_sauce", "soy sauce", "soy, wheat, alcohol, food_dye", V],
  ["peanut_butter", "peanut butter", "peanut, soy", V],
  ["cashews", "cashews", "cashew"],
  ["parmesan", "parmesan cheese", "milk", V],
  ["cheddar", "cheddar cheese", "milk, food_dye", V],
  ["butter", "butter", "milk, food_dye", V],
  ["yogurt", "plain yogurt", "milk, gelatin", V],
  ["coconut_milk", "coconut milk", "coconut, sulphite", V],
  ["curry_paste", "curry paste", "chili, garlic, onion, shrimp, coriander, citrus, mustard, msg", U],
  ["chili_flakes", "chili flakes", "chili"],
  ["cumin", "ground cumin", ""],
  ["basil", "fresh basil", ""],
  ["fish_sauce", "fish sauce", "anchovy, fish, msg", V],
  ["pesto", "basil pesto", "milk, pine_nut, cashew, walnut, almond, garlic, citrus, sunflower", V],
  ["mixed_seafood", "mixed seafood", "shellfish, fish, shrimp, squid, mussel, clam, scallop, octopus, crab, wheat, egg, soy, sulphite", V],
  ["mushroom", "mushrooms", "mushroom"],
  ["frozen_peas", "frozen peas", "pea"],
];

const list = (s: string) => s.split(",").map((x) => x.trim()).filter((x) => x.length > 0);

export const INGREDIENTS: readonly Ingredient[] = ROWS.map(([id, label, allergens, kind]) => ({
  id,
  label,
  allergens: list(allergens),
  known: kind !== U,
  // Unknown status removes the recipe anyway; it never claims a complete profile either.
  profile: kind === undefined ? "complete" : "varies",
}));

const BY_ID = new Map(INGREDIENTS.map((i) => [i.id, i]));

export function ingredient(id: string): Ingredient | null {
  return BY_ID.get(id) ?? null;
}
