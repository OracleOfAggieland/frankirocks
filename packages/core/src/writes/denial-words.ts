/**
 * What code can see of a denial and of an affirmation in the owner's words (brief 025, question W-187). Pure.
 *
 * The model's polarity alone never removes a rule. A denial removes a stored rule only when it is the asked rule this
 * turn answers, the owner's words hold a denial from `DENIAL_FORMS`, and the turn holds no affirming cue for that
 * allergen (`affirmsAllergen`). Both lists are closed and fail closed: a word missing from the denial list keeps the
 * rule, and an affirming cue that names no allergen counts for the asked one.
 */
import { normalizeForRegex } from "../intents/regex";
import { scanAliases } from "./gazetteer";

/**
 * The closed list of denial forms, tied to the allergen or to the question (a ruling for this build, W-187): a bare
 * answer word, a negated allergy word, "no allergy", "don't have any allergies", "not mine", "no longer", "outgrew".
 */
export const DENIAL_FORMS: readonly RegExp[] = [
  /^(no|nope|nah|none|nobody|never|no one|not really|not at all|not me|not mine)\b/,
  /(\bnot|n't|\bnever|\bno longer)( (really|actually|even|at all))? (be )?(allergic|intolerant|an allergy|a allergy)\b/,
  /\bno( (food|known|real))? (allerg(y|ies)|intolerances?)\b/,
  /\b(don't|doesn't|didn't|do not|does not|did not|never) (have|had) (any |an |a |that |the )?(\w+ )?(allerg(y|ies)|intolerances?)\b/,
  /\bnot (mine|me|him|her|them|us)\b/,
  /\b(nobody|no one|none of us|neither of us)\b/,
  /\boutgr(ew|own)\b/,
];

export function hasDenialForm(quote: string): boolean {
  const t = normalizeForRegex(quote);
  return DENIAL_FORMS.some((re) => re.test(t));
}

/** An affirming cue's words: "allergic", "allergy", "intolerant", and "can't eat" or "can't have". */
const CUE = /^(allerg(ic|y|ies)|intoleran(t|ce)|anaphyla\w*|epipen|celiac|coeliac)$/;
const CANT = /^(can't|cannot|shouldn't|mustn't)$/;
const CANT_OBJECT = /^(eat|have|touch|take|drink)$/;
const NEGATION_WORDS = new Set(["not", "no", "never", "nobody", "none", "nothing", "neither", "nor"]);
const NEGATES = (w: string) => NEGATION_WORDS.has(w.replace(/'s$/, "")) || (w.endsWith("n't") && !CANT.test(w));
/** How many words before a cue a negation still negates it ("I'm not really allergic"). */
export const CUE_NEGATION_REACH = 3;

/** True when a clause (no commas or sentence marks) holds an affirming cue that no near negation word cancels. */
function clauseAffirms(clause: string): boolean {
  const words = clause.split(/[^\p{L}\p{N}']+/u).filter((w) => w !== "");
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (CANT.test(w) && CANT_OBJECT.test(words[i + 1] ?? "")) return true;
    if (w === "can" && words[i + 1] === "not" && CANT_OBJECT.test(words[i + 2] ?? "")) return true;
    if (!CUE.test(w)) continue;
    if (!words.slice(Math.max(0, i - CUE_NEGATION_REACH), i).some(NEGATES)) return true;
  }
  return false;
}

/**
 * True when `text` holds an affirming cue for `code`: in a sentence that names `code`, or names no allergen at all
 * ("I can't eat it, I'm allergic."). For `unresolved` (the all-food rule), any affirming cue counts.
 */
export function affirmsAllergen(text: string, code: string): boolean {
  const t = normalizeForRegex(text);
  for (const sentence of t.split(/(?<=[.!?;])\s+|[.!?;]+$/)) {
    if (sentence.trim() === "") continue;
    if (!sentence.split(/[,:—–-]+/).some(clauseAffirms)) continue;
    const codes = scanAliases(sentence).map((a) => a.code);
    if (code === "unresolved" || codes.length === 0 || codes.includes(code)) return true;
  }
  return false;
}
