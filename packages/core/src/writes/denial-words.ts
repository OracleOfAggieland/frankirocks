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

/** Words in an affirming clause that point at the asked allergen (brief 043, finding 3): "I'm allergic to it". */
export const CUE_POINTERS: ReadonlySet<string> = new Set(["it", "that", "them"]);

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
    const affirming = sentence.split(/[,:—–-]+/).filter(clauseAffirms);
    if (affirming.length === 0) continue;
    // Brief 043, finding 3: a cue whose clause points at the asked allergen ("it", "that", "them") or names it always
    // affirms, whatever else the sentence names.
    if (affirming.some((c) => c.split(/[^\p{L}\p{N}']+/u).some((w) => CUE_POINTERS.has(w)) || (code !== "unresolved" && scanAliases(c).some((a) => a.code === code)))) return true;
    const codes = scanAliases(sentence).map((a) => a.code);
    if (code === "unresolved" || codes.length === 0 || codes.includes(code)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Brief 043, finding 3: a denial removes a pending rule only as a whole utterance from a closed list.

/** Answer words that may open a whole denial ("No, I'm not."), or be all of it ("Nope."). */
export const DENIAL_LEADS: readonly string[] = ["no", "nope", "nah", "no no"];

/**
 * The closed list of whole denials after the optional lead (a ruling for this build, brief 043; question W-210). `{X}`
 * is the asked allergen, by one of its own aliases, or a pointer to it from `DENIAL_POINTERS`. Nothing else may be in
 * the answer: "No, I'm allergic to it", "No joke" and "No, but my brother is" are not denials.
 */
export const WHOLE_DENIALS: readonly string[] = [
  "",
  "i'm not",
  "i am not",
  "not me",
  "not really",
  "not at all",
  "i'm not allergic",
  "i am not allergic",
  "not allergic",
  "i'm not allergic to {X}",
  "i am not allergic to {X}",
  "not allergic to {X}",
  "i don't have that allergy",
  "i don't have an allergy",
  "i don't have any allergies",
  "nobody",
  "no one",
  "nobody is",
  "nobody's allergic",
  "nobody is allergic",
  "nobody's allergic to {X}",
  "nobody is allergic to {X}",
  "nobody has that allergy",
  "nobody has it",
  "not an allergy",
  "it's not an allergy",
  "it isn't an allergy",
  "just a dislike",
  "only a dislike",
  "it's just a dislike",
  "it's only a dislike",
  "i just don't like it",
];

/** Words that point back at the asked allergen in a whole denial: "not allergic to that". */
export const DENIAL_POINTERS: readonly string[] = ["it", "that", "them", "those", "that stuff", "those things", "either", "any of that", "any of them"];

/** Lowercase, NFKC, curly apostrophes straight, every other mark a space, spaces collapsed. */
function answerWords(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/(^| )'+|'+( |$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `words` is the asked allergen by its own alias, whole, or a pointer to it. */
function isAskedObject(words: string, askedCode: string): boolean {
  if (DENIAL_POINTERS.includes(words)) return true;
  if (askedCode === "unresolved") return false;
  const hits = scanAliases(words);
  return hits.length === 1 && hits[0]!.code === askedCode && hits[0]!.start === 0 && hits[0]!.end === words.length;
}

/**
 * True when the owner's whole answer is one whole denial: an optional lead from `DENIAL_LEADS`, then one form from
 * `WHOLE_DENIALS`, with nothing else, as `isPlainYes` reads a yes. Fails closed: any other answer keeps the rule.
 */
export function isWholeDenial(text: string, askedCode: string): boolean {
  const t = answerWords(text);
  if (t === "") return false;
  const leads = ["", ...DENIAL_LEADS];
  for (const lead of leads) {
    if (lead !== "" && t !== lead && !t.startsWith(`${lead} `)) continue;
    const rest = lead === "" ? t : t.slice(lead.length).trim();
    for (const form of WHOLE_DENIALS) {
      if (form === "" && (lead === "" || rest !== "")) continue;
      if (!form.includes("{X}")) {
        if (rest === form) return true;
        continue;
      }
      const head = form.slice(0, form.indexOf("{X}"));
      if (rest.startsWith(head) && isAskedObject(rest.slice(head.length).trim(), askedCode)) return true;
    }
  }
  return false;
}
