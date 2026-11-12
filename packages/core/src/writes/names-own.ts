/**
 * Whether an answer names an allergen of its own (brief 018 task 0; report 012 "Open before wave B" items 1 and 2;
 * amends CQ 156 and CQ 161). Pure. Decided from the span as well as the item:
 *
 * - An item names nothing of its own only when every word is a reference, generic, cue, article, intensifier or
 *   question-echo word, and the gazetteer finds nothing in it.
 * - A generic noun ("stuff", "thing", "kind", "food") names nothing only beside a pointer or quantifier ("that stuff",
 *   "any of that kind of thing"). "Stuff" alone is something unnamed.
 * - A cue-word item ("allergic", "an allergy") names nothing only when the cue has no object of its own in the span:
 *   "I'm not allergic to durian." with item "allergic" names durian.
 * - An otherness word (other, another, different, else) in or before the item makes it name its own.
 * - An empty item names its own when the span does: a cue with an object of its own, or an otherness word.
 *
 * The asked rule's own aliases never count as "another thing": "Yes, I'm allergic to peanuts." with item "allergic"
 * answering a peanut rule names nothing else.
 */
import { NONE_CODE, findWholeWords, lookupAllergen, scanAliases, wordTokens } from "./gazetteer";

/** Words that point back at the asked allergen or only answer the question (CQ 156). */
export const REFERENCE_WORDS: ReadonlySet<string> = new Set(["it", "that", "this", "these", "those", "them", "one", "ones", "the", "same", "yes", "yeah", "yep", "yup", "no", "nope", "nah"]);

/** Generic pointer and quantifier words and generic nouns (CQ 161). */
export const GENERIC_WORDS: ReadonlySet<string> = new Set(["stuff", "thing", "things", "any", "all", "of", "either", "both", "nobody", "anyone", "anybody", "kind", "sort"]);

/** Generic nouns: they name nothing only beside a pointer or quantifier. */
export const GENERIC_NOUNS: ReadonlySet<string> = new Set(["stuff", "thing", "things", "kind", "sort", "food", "foods"]);

/** Pointers and quantifiers a generic noun may stand beside. */
export const POINTERS: ReadonlySet<string> = new Set(["it", "that", "this", "these", "those", "them", "the", "same", "any", "all", "either", "both", "every"]);

/** Articles and intensifiers: they add nothing of their own (item 2, echoes of the question). */
export const ARTICLES: ReadonlySet<string> = new Set(["a", "an", "the"]);
export const INTENSIFIERS: ReadonlySet<string> = new Set(["really", "very", "so", "definitely", "actually", "truly", "totally", "quite", "pretty", "super", "seriously", "just", "real"]);

/**
 * The words of Franki's own allergy questions ("what it was", "who it applies to", "whether it is a real reaction or
 * just a dislike"): an answer that echoes them names nothing of its own.
 */
export const ECHO_WORDS: ReadonlySet<string> = new Set(["real", "reaction", "reactions", "dislike", "dislikes", "just", "is", "was", "it", "applies", "apply", "what", "who", "whether", "or"]);

/** Words that make the item name its own ("the other thing", "something else"). */
export const OTHERNESS_WORDS: ReadonlySet<string> = new Set(["other", "others", "another", "different", "else"]);

/** Words after a cue that are not its object. */
const NOT_OBJECT: ReadonlySet<string> = new Set([
  "to", "of", "with", "too", "also", "anymore", "now", "though", "here", "at", "either", "really", "yes", "no", "not", "nope",
  "mine", "me", "myself", "yours", "his", "hers", "theirs", "ours",
  "i", "i'm", "am", "are", "is", "was", "be", "been", "have", "has", "had", "do", "does", "did", "and", "but", "so", "then", "after",
]);

const CUE_WORD = /^(allerg(y|ies|ic)|intoleran(t|ce))$/;

const plain = (w: string) => REFERENCE_WORDS.has(w) || GENERIC_WORDS.has(w) || GENERIC_NOUNS.has(w) || ARTICLES.has(w) || INTENSIFIERS.has(w) || ECHO_WORDS.has(w) || CUE_WORD.test(w);

/** Offsets of the aliases in `quote` whose code is `askedCode`: they are the asked allergen, never "another thing". */
function askedRanges(quote: string, askedCode: string | null): { start: number; end: number }[] {
  return askedCode === null ? [] : scanAliases(quote).filter((a) => a.code === askedCode);
}

/**
 * True when a cue in `quote` (an `allerg…` or `intoleran…` word) has an object of its own after it: a word that is
 * not a lead, filler, pointer, generic, article, intensifier or echo word, not a `none` word ("anything"), and not an
 * alias of the asked allergen; or an otherness word; or a generic noun with no pointer before it.
 */
export function cueHasOwnObject(quote: string, askedCode: string | null): boolean {
  const w = wordTokens(quote);
  const asked = askedRanges(quote, askedCode);
  const isAsked = (t: { start: number; end: number }) => asked.some((a) => a.start <= t.start && t.end <= a.end);
  return w.some((t, i) => {
    if (!CUE_WORD.test(t.word)) return false;
    let pointer = false;
    for (const a of w.slice(i + 1)) {
      if (isAsked(a)) continue;
      if (OTHERNESS_WORDS.has(a.word)) return true;
      if (POINTERS.has(a.word)) pointer = true;
      if (GENERIC_NOUNS.has(a.word)) {
        if (!pointer) return true;
        continue;
      }
      if (NOT_OBJECT.has(a.word) || plain(a.word) || CUE_WORD.test(a.word)) continue;
      if (lookupAllergen(a.word).includes(NONE_CODE)) continue;
      return true;
    }
    return false;
  });
}

/**
 * True when `item`, found in `quote`, names nothing of its own. `askedCode` is the asked rule's code (its aliases
 * are not another thing), or null.
 */
export function itemNamesNothing(item: string, quote: string, askedCode: string | null): boolean {
  const words = wordTokens(item);
  if (words.length === 0) return !spanNamesOwn(quote, askedCode);
  if (lookupAllergen(item).length > 0) return false;
  if (!words.every((t) => plain(t.word))) return false;
  // The item's place in the span, and the pointer, quantifier or otherness words right before it.
  const at = findWholeWords(quote, item);
  const span = wordTokens(quote);
  const first = at === null ? -1 : span.findIndex((t) => t.start === at.start);
  const lead: string[] = [];
  for (let k = first - 1; k >= 0 && k >= first - 4; k--) {
    const word = span[k]!.word;
    if (!(POINTERS.has(word) || ARTICLES.has(word) || INTENSIFIERS.has(word) || OTHERNESS_WORDS.has(word) || GENERIC_WORDS.has(word))) break;
    lead.unshift(word);
  }
  const after = first < 0 ? undefined : span[first + words.length]?.word;
  if (lead.some((x) => OTHERNESS_WORDS.has(x)) || (after !== undefined && OTHERNESS_WORDS.has(after))) return false;
  // A generic noun needs a pointer or quantifier before it, in the item or right before it in the span.
  const seq = [...lead, ...words.map((t) => t.word)];
  for (let k = 0; k < seq.length; k++) {
    if (GENERIC_NOUNS.has(seq[k]!) && !seq.slice(0, k).some((x) => POINTERS.has(x))) return false;
  }
  // A cue word names nothing only when its cue has no object of its own; and whatever the item holds, a span whose
  // cue has an object of its own names that object ("Nobody here is allergic to durian", item "nobody").
  return !spanNamesOwn(quote, askedCode);
}

/** An empty item: the span names its own when a cue has an object of its own, or an otherness word is in it. */
export function spanNamesOwn(quote: string, askedCode: string | null): boolean {
  if (wordTokens(quote).some((t) => OTHERNESS_WORDS.has(t.word))) return true;
  return cueHasOwnObject(quote, askedCode);
}
