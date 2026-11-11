/**
 * An independent copy of the allergen gazetteer's IDs and aliases, taken from the table in
 * `docs/briefs/012-design.md` section 2.1, for the properties' oracles. Plain module, not guarded. It is not the
 * product's table (`writes/gazetteer.ts`); a property that needs to know which words are aliases reads this one, so
 * a fault in the product's table can't hide itself.
 */
export const ORACLE_GAZETTEER: Record<string, { domain: string; aliases: readonly string[] }> = {
  "milk": { domain: "food", aliases: ["milk","dairy","lactose","cow milk","cheese","butter","cream","yogurt","yoghurt","whey","casein"] },
  "egg": { domain: "food", aliases: ["egg","eggs","egg white","egg whites","egg yolk","egg yolks"] },
  "peanut": { domain: "food", aliases: ["peanut","peanuts","pea nut","pea nuts","groundnut","groundnuts","ground nut","ground nuts","peanut butter"] },
  "nuts": { domain: "food", aliases: ["nut","nuts"] },
  "tree_nut": { domain: "food", aliases: ["tree nut","tree nuts"] },
  "almond": { domain: "food", aliases: ["almond","almonds","almond nut","almond nuts"] },
  "cashew": { domain: "food", aliases: ["cashew","cashews","cashew nut","cashew nuts"] },
  "walnut": { domain: "food", aliases: ["walnut","walnuts","wal nut","wal nuts"] },
  "pecan": { domain: "food", aliases: ["pecan","pecans","pecan nut","pecan nuts"] },
  "pistachio": { domain: "food", aliases: ["pistachio","pistachios","pistachio nut","pistachio nuts"] },
  "hazelnut": { domain: "food", aliases: ["hazelnut","hazelnuts","hazel nut","hazel nuts","filbert","filberts"] },
  "brazil_nut": { domain: "food", aliases: ["brazil nut","brazil nuts"] },
  "macadamia": { domain: "food", aliases: ["macadamia","macadamias","macadamia nut","macadamia nuts"] },
  "pine_nut": { domain: "food", aliases: ["pine nut","pine nuts"] },
  "chestnut": { domain: "food", aliases: ["chestnut","chestnuts"] },
  "coconut": { domain: "food", aliases: ["coconut","coconuts","coco nut"] },
  "seafood": { domain: "food", aliases: ["seafood"] },
  "fish": { domain: "food", aliases: ["fish","finfish"] },
  "salmon": { domain: "food", aliases: ["salmon"] },
  "tuna": { domain: "food", aliases: ["tuna","tuna fish"] },
  "cod": { domain: "food", aliases: ["cod","cod fish"] },
  "halibut": { domain: "food", aliases: ["halibut"] },
  "tilapia": { domain: "food", aliases: ["tilapia"] },
  "trout": { domain: "food", aliases: ["trout"] },
  "mackerel": { domain: "food", aliases: ["mackerel"] },
  "anchovy": { domain: "food", aliases: ["anchovy","anchovies"] },
  "sardine": { domain: "food", aliases: ["sardine","sardines"] },
  "shellfish": { domain: "food", aliases: ["shellfish","shell fish"] },
  "crustacean": { domain: "food", aliases: ["crustacean","crustaceans"] },
  "shrimp": { domain: "food", aliases: ["shrimp","shrimps","prawn","prawns"] },
  "crab": { domain: "food", aliases: ["crab","crabs"] },
  "lobster": { domain: "food", aliases: ["lobster","lobsters"] },
  "crayfish": { domain: "food", aliases: ["crayfish","cray fish","crawfish","craw fish","crawdad","crawdads"] },
  "mollusc": { domain: "food", aliases: ["mollusc","molluscs","mollusk","mollusks"] },
  "clam": { domain: "food", aliases: ["clam","clams"] },
  "mussel": { domain: "food", aliases: ["mussel","mussels"] },
  "oyster": { domain: "food", aliases: ["oyster","oysters"] },
  "scallop": { domain: "food", aliases: ["scallop","scallops"] },
  "squid": { domain: "food", aliases: ["squid","calamari"] },
  "octopus": { domain: "food", aliases: ["octopus"] },
  "snail": { domain: "food", aliases: ["snail","snails","escargot"] },
  "gluten": { domain: "food", aliases: ["gluten","celiac","coeliac"] },
  "wheat": { domain: "food", aliases: ["wheat"] },
  "barley": { domain: "food", aliases: ["barley"] },
  "rye": { domain: "food", aliases: ["rye"] },
  "oat": { domain: "food", aliases: ["oat","oats","oatmeal"] },
  "rice": { domain: "food", aliases: ["rice"] },
  "corn": { domain: "food", aliases: ["corn","maize"] },
  "buckwheat": { domain: "food", aliases: ["buckwheat"] },
  "soy": { domain: "food", aliases: ["soy","soya","soybean","soybeans","soy sauce","tofu","edamame"] },
  "sesame": { domain: "food", aliases: ["sesame","sesame seed","sesame seeds","tahini"] },
  "sunflower": { domain: "food", aliases: ["sunflower","sunflower seed","sunflower seeds","sun flower"] },
  "poppy_seed": { domain: "food", aliases: ["poppy seed","poppy seeds"] },
  "mustard": { domain: "food", aliases: ["mustard"] },
  "celery": { domain: "food", aliases: ["celery","celeriac"] },
  "lupin": { domain: "food", aliases: ["lupin","lupine"] },
  "sulphite": { domain: "food", aliases: ["sulphite","sulphites","sulfite","sulfites"] },
  "red_meat": { domain: "food", aliases: ["red meat","alpha gal","beef","pork","lamb"] },
  "chicken": { domain: "food", aliases: ["chicken"] },
  "kiwi": { domain: "food", aliases: ["kiwi","kiwis","kiwifruit"] },
  "banana": { domain: "food", aliases: ["banana","bananas"] },
  "peach": { domain: "food", aliases: ["peach","peaches"] },
  "apple": { domain: "food", aliases: ["apple","apples"] },
  "cherry": { domain: "food", aliases: ["cherry","cherries"] },
  "strawberry": { domain: "food", aliases: ["strawberry","strawberries"] },
  "mango": { domain: "food", aliases: ["mango","mangoes","mangos"] },
  "pineapple": { domain: "food", aliases: ["pineapple","pineapples"] },
  "citrus": { domain: "food", aliases: ["citrus","orange","oranges","lemon","lemons","lime","limes","grapefruit"] },
  "tomato": { domain: "food", aliases: ["tomato","tomatoes"] },
  "potato": { domain: "food", aliases: ["potato","potatoes"] },
  "carrot": { domain: "food", aliases: ["carrot","carrots"] },
  "avocado": { domain: "food", aliases: ["avocado","avocados"] },
  "bell_pepper": { domain: "food", aliases: ["bell pepper","bell peppers","capsicum"] },
  "chili": { domain: "food", aliases: ["chili","chilli","chilies","chillies","chili pepper","chili peppers","hot pepper","hot peppers","capsaicin"] },
  "garlic": { domain: "food", aliases: ["garlic"] },
  "onion": { domain: "food", aliases: ["onion","onions"] },
  "coriander": { domain: "food", aliases: ["coriander","cilantro"] },
  "cinnamon": { domain: "food", aliases: ["cinnamon"] },
  "mushroom": { domain: "food", aliases: ["mushroom","mushrooms"] },
  "chickpea": { domain: "food", aliases: ["chickpea","chickpeas","garbanzo","garbanzos","hummus"] },
  "lentil": { domain: "food", aliases: ["lentil","lentils"] },
  "pea": { domain: "food", aliases: ["pea","peas","pea protein"] },
  "cocoa": { domain: "food", aliases: ["chocolate","cocoa","cacao"] },
  "honey": { domain: "food", aliases: ["honey"] },
  "yeast": { domain: "food", aliases: ["yeast"] },
  "gelatin": { domain: "food", aliases: ["gelatin","gelatine"] },
  "alcohol": { domain: "food", aliases: ["alcohol","ethanol"] },
  "caffeine": { domain: "food", aliases: ["caffeine"] },
  "msg": { domain: "food", aliases: ["msg","monosodium glutamate"] },
  "food_dye": { domain: "food", aliases: ["food dye","food dyes","food coloring","food colouring","artificial coloring","red dye","tartrazine"] },
  "penicillin": { domain: "drug", aliases: ["penicillin","penicillins","amoxicillin","ampicillin"] },
  "sulfa": { domain: "drug", aliases: ["sulfa","sulfa drugs","sulfonamide","sulfonamides"] },
  "aspirin": { domain: "drug", aliases: ["aspirin"] },
  "nsaid": { domain: "drug", aliases: ["nsaid","nsaids","ibuprofen","naproxen"] },
  "opioid": { domain: "drug", aliases: ["opioid","opioids","codeine","morphine"] },
  "contrast_dye": { domain: "drug", aliases: ["contrast dye","iodine contrast"] },
  "latex": { domain: "material", aliases: ["latex"] },
  "nickel": { domain: "material", aliases: ["nickel"] },
  "fragrance": { domain: "material", aliases: ["fragrance","fragrances","perfume","perfumes"] },
  "insect_venom": { domain: "insect", aliases: ["bee","bees","bee sting","bee stings","wasp","wasps","hornet","hornets","yellow jacket","yellow jackets","insect sting","insect stings","venom"] },
  "pollen": { domain: "environment", aliases: ["pollen","hay fever","ragweed"] },
  "grass": { domain: "environment", aliases: ["grass","grass pollen"] },
  "dust_mite": { domain: "environment", aliases: ["dust","dust mite","dust mites"] },
  "mold": { domain: "environment", aliases: ["mold","mould"] },
  "pet_dander": { domain: "animal", aliases: ["dander","pet dander"] },
  "cat": { domain: "animal", aliases: ["cat","cats"] },
  "dog": { domain: "animal", aliases: ["dog","dogs"] },
  "none": { domain: "pseudo", aliases: ["none","nothing","anything","any allergies","no allergies"] },
};

/** The design's normal form, written out again: NFKC, lowercase, curly apostrophes, hyphens, possessive 's, spaces. */
export function oracleNormal(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[-\u2010-\u2015]/g, " ")
    .replace(/(\p{L})'s(?![\p{L}\p{N}])/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `phrase` occurs in `text` as a whole-word sequence, both in normal form. */
export function hasWholeWords(text: string, phrase: string): boolean {
  const t = ` ${oracleNormal(text).replace(/[^\p{L}\p{N}']+/gu, " ")} `;
  const p = oracleNormal(phrase).replace(/[^\p{L}\p{N}']+/gu, " ").trim();
  return p !== "" && t.includes(` ${p} `);
}

/** Every alias (of any code but `none`) that occurs in `text` as whole words. */
export function aliasesIn(text: string): { code: string; alias: string }[] {
  const found: { code: string; alias: string }[] = [];
  for (const [code, e] of Object.entries(ORACLE_GAZETTEER)) {
    if (code === "none") continue;
    for (const alias of e.aliases) if (hasWholeWords(text, alias)) found.push({ code, alias });
  }
  return found;
}

/** True when some alias of `code` occurs in `text` as whole words. */
export function codeNamedIn(code: string, text: string): boolean {
  return (ORACLE_GAZETTEER[code]?.aliases ?? []).some((a) => hasWholeWords(text, a));
}
