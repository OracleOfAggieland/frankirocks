/**
 * The allergen gazetteer (design 2.1): a closed, versioned table of IDs, labels, domains, aliases and `includes`.
 * Pure. A later version adds entries and aliases; it never reuses or renames an ID.
 *
 * Matching is over word tokens, so offsets stay on the caller's own text: a token is a run of letters and digits,
 * with inner apostrophes kept ("i'm"), normalized on its own (NFKC, lowercase, curly apostrophes straight, a final
 * possessive 's dropped). A hyphen is not a letter, so "tree-nuts" is two tokens, as the normal form's "hyphens to
 * spaces" asks. An alias is a token sequence; at every position the matches are found, and a match inside a longer
 * one is dropped, so the longer alias wins ("cashew nuts" gives `cashew`, "pea nuts" gives `peanut`).
 */

export const GAZETTEER_VERSION = "gz1";

export type AllergenDomain = "food" | "drug" | "material" | "insect" | "environment" | "animal" | "pseudo";

export interface GazetteerEntry {
  id: string;
  label: string;
  domain: AllergenDomain;
  aliases: readonly string[];
  /** Read only by F7's food filter; matching never uses it. */
  includes: readonly string[];
}

type Row = [id: string, label: string, domain: AllergenDomain, aliases: string, includes?: string];

const ROWS: readonly Row[] = [
  ["milk", "milk", "food", "milk, dairy, lactose, cow milk, cheese, butter, cream, yogurt, yoghurt, whey, casein"],
  ["egg", "eggs", "food", "egg, eggs, egg white, egg whites, egg yolk, egg yolks"],
  ["peanut", "peanuts", "food", "peanut, peanuts, pea nut, pea nuts, groundnut, groundnuts, ground nut, ground nuts, peanut butter"],
  ["nuts", "nuts", "food", "nut, nuts", "peanut, tree_nut"],
  ["tree_nut", "tree nuts", "food", "tree nut, tree nuts", "almond, cashew, walnut, pecan, pistachio, hazelnut, brazil_nut, macadamia, pine_nut, chestnut"],
  ["almond", "almonds", "food", "almond, almonds, almond nut, almond nuts"],
  ["cashew", "cashews", "food", "cashew, cashews, cashew nut, cashew nuts"],
  ["walnut", "walnuts", "food", "walnut, walnuts, wal nut, wal nuts"],
  ["pecan", "pecans", "food", "pecan, pecans, pecan nut, pecan nuts"],
  ["pistachio", "pistachios", "food", "pistachio, pistachios, pistachio nut, pistachio nuts"],
  ["hazelnut", "hazelnuts", "food", "hazelnut, hazelnuts, hazel nut, hazel nuts, filbert, filberts"],
  ["brazil_nut", "Brazil nuts", "food", "brazil nut, brazil nuts"],
  ["macadamia", "macadamia nuts", "food", "macadamia, macadamias, macadamia nut, macadamia nuts"],
  ["pine_nut", "pine nuts", "food", "pine nut, pine nuts"],
  ["chestnut", "chestnuts", "food", "chestnut, chestnuts"],
  ["coconut", "coconut", "food", "coconut, coconuts, coco nut"],
  ["seafood", "seafood", "food", "seafood", "fish, shellfish"],
  ["fish", "fish", "food", "fish, finfish", "salmon, tuna, cod, halibut, tilapia, trout, mackerel, anchovy, sardine"],
  ["salmon", "salmon", "food", "salmon"],
  ["tuna", "tuna", "food", "tuna, tuna fish"],
  ["cod", "cod", "food", "cod, cod fish"],
  ["halibut", "halibut", "food", "halibut"],
  ["tilapia", "tilapia", "food", "tilapia"],
  ["trout", "trout", "food", "trout"],
  ["mackerel", "mackerel", "food", "mackerel"],
  ["anchovy", "anchovies", "food", "anchovy, anchovies"],
  ["sardine", "sardines", "food", "sardine, sardines"],
  ["shellfish", "shellfish", "food", "shellfish, shell fish", "crustacean, mollusc"],
  ["crustacean", "crustaceans", "food", "crustacean, crustaceans", "shrimp, crab, lobster, crayfish"],
  ["shrimp", "shrimp", "food", "shrimp, shrimps, prawn, prawns"],
  ["crab", "crab", "food", "crab, crabs"],
  ["lobster", "lobster", "food", "lobster, lobsters"],
  ["crayfish", "crayfish", "food", "crayfish, cray fish, crawfish, craw fish, crawdad, crawdads"],
  ["mollusc", "molluscs", "food", "mollusc, molluscs, mollusk, mollusks", "clam, mussel, oyster, scallop, squid, octopus, snail"],
  ["clam", "clams", "food", "clam, clams"],
  ["mussel", "mussels", "food", "mussel, mussels"],
  ["oyster", "oysters", "food", "oyster, oysters"],
  ["scallop", "scallops", "food", "scallop, scallops"],
  ["squid", "squid", "food", "squid, calamari"],
  ["octopus", "octopus", "food", "octopus"],
  ["snail", "snails", "food", "snail, snails, escargot"],
  ["gluten", "gluten", "food", "gluten, celiac, coeliac", "wheat, barley, rye"],
  ["wheat", "wheat", "food", "wheat"],
  ["barley", "barley", "food", "barley"],
  ["rye", "rye", "food", "rye"],
  ["oat", "oats", "food", "oat, oats, oatmeal"],
  ["rice", "rice", "food", "rice"],
  ["corn", "corn", "food", "corn, maize"],
  ["buckwheat", "buckwheat", "food", "buckwheat"],
  ["soy", "soy", "food", "soy, soya, soybean, soybeans, soy sauce, tofu, edamame"],
  ["sesame", "sesame", "food", "sesame, sesame seed, sesame seeds, tahini"],
  ["sunflower", "sunflower seeds", "food", "sunflower, sunflower seed, sunflower seeds, sun flower"],
  ["poppy_seed", "poppy seeds", "food", "poppy seed, poppy seeds"],
  ["mustard", "mustard", "food", "mustard"],
  ["celery", "celery", "food", "celery, celeriac"],
  ["lupin", "lupin", "food", "lupin, lupine"],
  ["sulphite", "sulphites", "food", "sulphite, sulphites, sulfite, sulfites"],
  ["red_meat", "red meat", "food", "red meat, alpha gal, beef, pork, lamb"],
  ["chicken", "chicken", "food", "chicken"],
  ["kiwi", "kiwi", "food", "kiwi, kiwis, kiwifruit"],
  ["banana", "bananas", "food", "banana, bananas"],
  ["peach", "peaches", "food", "peach, peaches"],
  ["apple", "apples", "food", "apple, apples"],
  ["cherry", "cherries", "food", "cherry, cherries"],
  ["strawberry", "strawberries", "food", "strawberry, strawberries"],
  ["mango", "mango", "food", "mango, mangoes, mangos"],
  ["pineapple", "pineapple", "food", "pineapple, pineapples"],
  ["citrus", "citrus", "food", "citrus, orange, oranges, lemon, lemons, lime, limes, grapefruit"],
  ["tomato", "tomatoes", "food", "tomato, tomatoes"],
  ["potato", "potatoes", "food", "potato, potatoes"],
  ["carrot", "carrots", "food", "carrot, carrots"],
  ["avocado", "avocado", "food", "avocado, avocados"],
  ["bell_pepper", "bell peppers", "food", "bell pepper, bell peppers, capsicum"],
  ["chili", "chili", "food", "chili, chilli, chilies, chillies, chili pepper, chili peppers, hot pepper, hot peppers, capsaicin"],
  ["garlic", "garlic", "food", "garlic"],
  ["onion", "onions", "food", "onion, onions"],
  ["coriander", "coriander", "food", "coriander, cilantro"],
  ["cinnamon", "cinnamon", "food", "cinnamon"],
  ["mushroom", "mushrooms", "food", "mushroom, mushrooms"],
  ["chickpea", "chickpeas", "food", "chickpea, chickpeas, garbanzo, garbanzos, hummus"],
  ["lentil", "lentils", "food", "lentil, lentils"],
  ["pea", "peas", "food", "pea, peas, pea protein"],
  ["cocoa", "chocolate", "food", "chocolate, cocoa, cacao"],
  ["honey", "honey", "food", "honey"],
  ["yeast", "yeast", "food", "yeast"],
  ["gelatin", "gelatin", "food", "gelatin, gelatine"],
  ["alcohol", "alcohol", "food", "alcohol, ethanol"],
  ["caffeine", "caffeine", "food", "caffeine"],
  ["msg", "MSG", "food", "msg, monosodium glutamate"],
  ["food_dye", "food dyes", "food", "food dye, food dyes, food coloring, food colouring, artificial coloring, red dye, tartrazine"],
  ["penicillin", "penicillin", "drug", "penicillin, penicillins, amoxicillin, ampicillin"],
  ["sulfa", "sulfa drugs", "drug", "sulfa, sulfa drugs, sulfonamide, sulfonamides"],
  ["aspirin", "aspirin", "drug", "aspirin"],
  ["nsaid", "NSAIDs", "drug", "nsaid, nsaids, ibuprofen, naproxen"],
  ["opioid", "opioids", "drug", "opioid, opioids, codeine, morphine"],
  ["contrast_dye", "contrast dye", "drug", "contrast dye, iodine contrast"],
  ["latex", "latex", "material", "latex"],
  ["nickel", "nickel", "material", "nickel"],
  ["fragrance", "fragrance", "material", "fragrance, fragrances, perfume, perfumes"],
  ["insect_venom", "insect stings", "insect", "bee, bees, bee sting, bee stings, wasp, wasps, hornet, hornets, yellow jacket, yellow jackets, insect sting, insect stings, venom"],
  ["pollen", "pollen", "environment", "pollen, hay fever, ragweed"],
  ["grass", "grass", "environment", "grass, grass pollen"],
  ["dust_mite", "dust mites", "environment", "dust, dust mite, dust mites"],
  ["mold", "mold", "environment", "mold, mould"],
  ["pet_dander", "pet dander", "animal", "dander, pet dander", "cat, dog"],
  ["cat", "cats", "animal", "cat, cats"],
  ["dog", "dogs", "animal", "dog, dogs"],
  ["none", "no allergies", "pseudo", "none, nothing, anything, any allergies, no allergies"],
];

const list = (s: string | undefined): string[] =>
  s === undefined
    ? []
    : s
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x !== "");

/** The table, in the design's order. */
export const GAZETTEER: readonly GazetteerEntry[] = ROWS.map(([id, label, domain, aliases, includes]) => ({ id, label, domain, aliases: list(aliases), includes: list(includes) }));

const BY_ID = new Map(GAZETTEER.map((e) => [e.id, e]));

/** The entry for an ID, or null. */
export function gazetteerEntry(id: string): GazetteerEntry | null {
  return BY_ID.get(id) ?? null;
}

/** The label a rule renders with, or null for an ID the table doesn't have. */
export function allergenLabel(id: string): string | null {
  return BY_ID.get(id)?.label ?? null;
}

/** The pseudo-entry a global denial names. Valid only with polarity `denied`. */
export const NONE_CODE = "none";

/** NFKC, lowercase, curly apostrophes to ', hyphens to spaces, a word-final possessive 's dropped, spaces collapsed. */
export function normalizeAllergenText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[-‐-―]/g, " ")
    .replace(/(\p{L})'s(?![\p{L}\p{N}])/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** One token's normal form: NFKC, lowercase, curly apostrophes straight, a final possessive 's dropped. */
const normalToken = (token: string): string =>
  token
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/(\p{L})'s$/u, "$1");

export interface WordToken {
  word: string;
  start: number;
  end: number;
}

const TOKEN = /[\p{L}\p{N}]+(?:['‘’ʼ][\p{L}\p{N}]+)*/gu;

/** The word tokens of `text[start, end)`, in normal form, with offsets on `text`. */
export function wordTokens(text: string, start = 0, end = text.length): WordToken[] {
  const out: WordToken[] = [];
  for (const m of text.slice(start, end).matchAll(TOKEN)) {
    const word = normalToken(m[0]);
    if (word !== "") out.push({ word, start: start + m.index, end: start + m.index + m[0].length });
  }
  return out;
}

const phraseTokens = (phrase: string): string[] => wordTokens(phrase).map((t) => t.word);

/** Aliases by their first token. */
const BY_FIRST = (() => {
  const m = new Map<string, { code: string; tokens: string[] }[]>();
  for (const e of GAZETTEER) {
    for (const a of e.aliases) {
      const tokens = phraseTokens(a);
      if (tokens.length === 0) continue;
      const at = m.get(tokens[0]!) ?? [];
      at.push({ code: e.id, tokens });
      m.set(tokens[0]!, at);
    }
  }
  return m;
})();

interface Match {
  code: string;
  /** Token indices, end-exclusive. */
  from: number;
  to: number;
}

/** Every alias match over the tokens, a match inside a longer one dropped, in order of appearance. */
function matches(tokens: readonly WordToken[]): Match[] {
  const found: Match[] = [];
  tokens.forEach((t, i) => {
    for (const a of BY_FIRST.get(t.word) ?? []) {
      if (i + a.tokens.length <= tokens.length && a.tokens.every((w, k) => tokens[i + k]!.word === w)) found.push({ code: a.code, from: i, to: i + a.tokens.length });
    }
  });
  const kept = found.filter((f) => !found.some((g) => g.from <= f.from && f.to <= g.to && g.to - g.from > f.to - f.from));
  const seen = new Set<string>();
  return kept.filter((m) => {
    const k = `${m.code}:${m.from}:${m.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Every code whose alias occurs as a whole-word sequence, longer aliases winning, in order. `none` only here. */
export function lookupAllergen(text: string): string[] {
  return [...new Set(matches(wordTokens(text)).map((m) => m.code))];
}

/** The aliases found in `text[start, end)`, with their offsets on `text`. Never the `none` entry. */
export function scanAliases(text: string, start = 0, end?: number): { code: string; start: number; end: number }[] {
  const tokens = wordTokens(text, start, end ?? text.length);
  return matches(tokens)
    .filter((m) => m.code !== NONE_CODE)
    .map((m) => ({ code: m.code, start: tokens[m.from]!.start, end: tokens[m.to - 1]!.end }));
}

/** The offsets on `text` of the first whole-word occurrence of `phrase` (both in normal form), or null. */
export function findWholeWords(text: string, phrase: string): { start: number; end: number } | null {
  const want = phraseTokens(phrase);
  if (want.length === 0) return null;
  const tokens = wordTokens(text);
  for (let i = 0; i + want.length <= tokens.length; i++) {
    if (want.every((w, k) => tokens[i + k]!.word === w)) return { start: tokens[i]!.start, end: tokens[i + want.length - 1]!.end };
  }
  return null;
}

/** True when `phrase` occurs in `text` as a whole-word sequence, both in normal form. */
export const hasWholeWordSequence = (text: string, phrase: string): boolean => findWholeWords(text, phrase) !== null;
