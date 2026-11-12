/**
 * The closed ingredient table (spec §10, contracts `candidates`). Each ingredient carries the gazetteer allergen
 * codes it holds, at the most specific level known. `known:false` means its allergen status is unknown, so any
 * recipe holding it is removed. Generic names only, no brands.
 */

export interface Ingredient {
  id: string;
  label: string;
  /** Gazetteer codes (packages/core/src/writes/gazetteer.ts). */
  allergens: readonly string[];
  known: boolean;
}

type Row = [id: string, label: string, allergens: string, known?: false];

const ROWS: readonly Row[] = [
  ["chicken_thigh", "chicken thighs", "chicken"],
  ["chicken_breast", "chicken breast", "chicken"],
  ["ground_beef", "ground beef", "red_meat"],
  ["pork_chop", "pork chops", "red_meat"],
  ["salmon_fillet", "salmon fillets", "salmon"],
  ["cod_fillet", "cod fillets", "cod"],
  ["shrimp", "shrimp", "shrimp"],
  ["egg", "eggs", "egg"],
  ["tofu", "firm tofu", "soy"],
  ["black_beans", "black beans", ""],
  ["chickpeas", "chickpeas", "chickpea"],
  ["red_lentils", "red lentils", "lentil"],
  ["rice", "rice", "rice"],
  ["pasta", "wheat pasta", "wheat"],
  ["rice_noodles", "rice noodles", "rice"],
  ["tortillas", "corn tortillas", "corn"],
  ["flour_tortillas", "flour tortillas", "wheat"],
  ["bread", "bread", "wheat, yeast"],
  ["potato", "potatoes", "potato"],
  ["sweet_potato", "sweet potatoes", ""],
  ["broccoli", "broccoli", ""],
  ["spinach", "spinach", ""],
  ["bell_pepper", "bell peppers", "bell_pepper"],
  ["onion", "onions", "onion"],
  ["garlic", "garlic", "garlic"],
  ["tomato", "tomatoes", "tomato"],
  ["canned_tomatoes", "canned tomatoes", "tomato"],
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
  ["soy_sauce", "soy sauce", "soy, wheat"],
  ["peanut_butter", "peanut butter", "peanut"],
  ["cashews", "cashews", "cashew"],
  ["parmesan", "parmesan cheese", "milk"],
  ["cheddar", "cheddar cheese", "milk"],
  ["butter", "butter", "milk"],
  ["yogurt", "plain yogurt", "milk"],
  ["coconut_milk", "coconut milk", "coconut"],
  ["curry_paste", "curry paste", "", false],
  ["chili_flakes", "chili flakes", "chili"],
  ["cumin", "ground cumin", ""],
  ["basil", "fresh basil", ""],
  ["fish_sauce", "fish sauce", "anchovy"],
  ["pesto", "basil pesto", "milk, pine_nut"],
  ["mixed_seafood", "mixed seafood", "shellfish, fish"],
  ["mushroom", "mushrooms", "mushroom"],
  ["frozen_peas", "frozen peas", "pea"],
];

const list = (s: string) => s.split(",").map((x) => x.trim()).filter((x) => x.length > 0);

export const INGREDIENTS: readonly Ingredient[] = ROWS.map(([id, label, allergens, known]) => ({ id, label, allergens: list(allergens), known: known !== false }));

const BY_ID = new Map(INGREDIENTS.map((i) => [i.id, i]));

export function ingredient(id: string): Ingredient | null {
  return BY_ID.get(id) ?? null;
}
