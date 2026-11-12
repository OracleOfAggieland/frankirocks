/**
 * Hand-written test oracle: animal-derived kinds per ingredient.
 *
 * Written from general knowledge of typical US store versions of each food,
 * independent of the product's ingredient table, which was not read while
 * writing this file. A product table is checked against this oracle, so it
 * must never be generated from or edited to match that table.
 *
 * Policy: this oracle errs toward listing a kind. When a meaningful share of
 * brands or typical preparations hold an animal-derived kind, the kind is
 * listed. `varies: true` marks prepared or multi-ingredient foods whose makeup
 * varies by brand or recipe. An empty `kinds` list means plant-only.
 *
 * Kind notes: animal rennet and gelatin come from slaughtered animals, so
 * they count as "meat". Squid, octopus, mussels, clams and other molluscs
 * count as "shellfish".
 */

export type OracleKind = "meat" | "poultry" | "fish" | "shellfish" | "dairy" | "egg" | "honey";

export interface KindOracleFood {
  id: string;
  label: string;
  kinds: readonly OracleKind[];
  varies: boolean;
  note?: string;
}

export const INGREDIENT_KINDS_ORACLE: readonly KindOracleFood[] = [
  { id: "chicken_thigh", label: "chicken thighs", kinds: ["poultry"], varies: false },
  { id: "chicken_breast", label: "chicken breast", kinds: ["poultry"], varies: false },
  { id: "ground_beef", label: "ground beef", kinds: ["meat"], varies: false },
  { id: "pork_chop", label: "pork chops", kinds: ["meat"], varies: false },
  { id: "salmon_fillet", label: "salmon fillets", kinds: ["fish"], varies: false },
  { id: "cod_fillet", label: "cod fillets", kinds: ["fish"], varies: false },
  { id: "shrimp", label: "shrimp", kinds: ["shellfish"], varies: false },
  { id: "egg", label: "eggs", kinds: ["egg"], varies: false },
  { id: "tofu", label: "firm tofu", kinds: [], varies: false },
  { id: "black_beans", label: "black beans", kinds: [], varies: false },
  { id: "chickpeas", label: "chickpeas", kinds: [], varies: false },
  { id: "red_lentils", label: "red lentils", kinds: [], varies: false },
  { id: "rice", label: "rice", kinds: [], varies: false },
  {
    id: "pasta",
    label: "wheat pasta",
    kinds: ["egg"],
    varies: true,
    note: "Dried semolina pasta is often egg-free, but fresh pasta, egg noodles and many specialty shapes contain egg.",
  },
  { id: "rice_noodles", label: "rice noodles", kinds: [], varies: false },
  {
    id: "tortillas",
    label: "corn tortillas",
    kinds: [],
    varies: false,
    note: "Typically masa, water and lime; lard is uncommon in store corn tortillas.",
  },
  {
    id: "flour_tortillas",
    label: "flour tortillas",
    kinds: ["meat"],
    varies: true,
    note: "Many traditional and some store brands use lard (pork fat); others use vegetable shortening.",
  },
  {
    id: "bread",
    label: "bread",
    kinds: ["dairy", "egg", "honey"],
    varies: true,
    note: "Many loaves contain milk, whey or butter; enriched breads (brioche, challah, some sandwich loaves) contain egg; wheat and multigrain loaves often contain honey.",
  },
  { id: "potato", label: "potatoes", kinds: [], varies: false },
  { id: "sweet_potato", label: "sweet potatoes", kinds: [], varies: false },
  { id: "broccoli", label: "broccoli", kinds: [], varies: false },
  { id: "spinach", label: "spinach", kinds: [], varies: false },
  { id: "bell_pepper", label: "bell peppers", kinds: [], varies: false },
  { id: "onion", label: "onions", kinds: [], varies: false },
  { id: "garlic", label: "garlic", kinds: [], varies: false },
  { id: "tomato", label: "tomatoes", kinds: [], varies: false },
  { id: "canned_tomatoes", label: "canned tomatoes", kinds: [], varies: false },
  { id: "zucchini", label: "zucchini", kinds: [], varies: false },
  { id: "carrot", label: "carrots", kinds: [], varies: false },
  { id: "cabbage", label: "cabbage", kinds: [], varies: false },
  { id: "green_beans", label: "green beans", kinds: [], varies: false },
  { id: "avocado", label: "avocado", kinds: [], varies: false },
  { id: "lime", label: "limes", kinds: [], varies: false },
  { id: "lemon", label: "lemons", kinds: [], varies: false },
  { id: "cilantro", label: "cilantro", kinds: [], varies: false },
  { id: "ginger", label: "fresh ginger", kinds: [], varies: false },
  { id: "olive_oil", label: "olive oil", kinds: [], varies: false },
  { id: "sesame_oil", label: "sesame oil", kinds: [], varies: false },
  {
    id: "soy_sauce",
    label: "soy sauce",
    kinds: [],
    varies: false,
    note: "Soybeans, wheat, salt and water; no fish or honey in typical brewed soy sauce.",
  },
  {
    id: "peanut_butter",
    label: "peanut butter",
    kinds: ["honey"],
    varies: true,
    note: "Plain peanut butter is plant-only, but honey-sweetened varieties are common on store shelves.",
  },
  { id: "cashews", label: "cashews", kinds: [], varies: false },
  {
    id: "parmesan",
    label: "parmesan cheese",
    kinds: ["dairy", "meat"],
    varies: false,
    note: "Parmigiano-Reggiano must use animal (calf) rennet, and many US parmesans do too.",
  },
  {
    id: "cheddar",
    label: "cheddar cheese",
    kinds: ["dairy", "meat"],
    varies: true,
    note: "Many cheddars use microbial rennet, but a meaningful share use animal rennet.",
  },
  { id: "butter", label: "butter", kinds: ["dairy"], varies: false },
  {
    id: "yogurt",
    label: "plain yogurt",
    kinds: ["dairy", "meat"],
    varies: true,
    note: "Some brands thicken with gelatin, which comes from meat.",
  },
  { id: "coconut_milk", label: "coconut milk", kinds: [], varies: false },
  {
    id: "curry_paste",
    label: "curry paste",
    kinds: ["fish", "shellfish"],
    varies: true,
    note: "Thai curry pastes commonly contain shrimp paste, and some contain fish sauce or dried fish.",
  },
  { id: "chili_flakes", label: "chili flakes", kinds: [], varies: false },
  { id: "cumin", label: "ground cumin", kinds: [], varies: false },
  { id: "basil", label: "fresh basil", kinds: [], varies: false },
  {
    id: "fish_sauce",
    label: "fish sauce",
    kinds: ["fish"],
    varies: false,
    note: "Fermented anchovies and salt.",
  },
  {
    id: "pesto",
    label: "basil pesto",
    kinds: ["dairy", "meat"],
    varies: true,
    note: "Typically holds parmesan or pecorino, often made with animal rennet; anchovy is not typical in basil pesto.",
  },
  {
    id: "mixed_seafood",
    label: "mixed seafood",
    kinds: ["fish", "shellfish"],
    varies: true,
    note: "Usually shrimp, squid, mussels and clams; some mixes include fish pieces or surimi.",
  },
  { id: "mushroom", label: "mushrooms", kinds: [], varies: false },
  { id: "frozen_peas", label: "frozen peas", kinds: [], varies: false },
];
