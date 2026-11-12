/**
 * Which way a rename goes, by the owner's words (brief 043, finding 4). Pure.
 *
 * Row R1 checked only that the model's new name was in the span and the old one in the turn, so "her name is Mara,
 * not Maya" with the model's `Maya` renamed Mara to Maya. Now a rename is refused (deferred) when its new name is
 * negated in the span ("not Maya", "isn't Maya") or its old name is the one the span asserts ("her name is Mara").
 */

/** Words right before a name that negate it: "not Maya", "isn't Maya", "instead of Maya". */
export const NAME_NEGATORS: readonly string[] = ["not", "isn't", "is not", "wasn't", "was not", "never", "rather than", "instead of", "no longer"];

/** Words right before a name that assert it as the name: "her name is Mara", "she's called Mara". */
export const NAME_ASSERTERS: readonly string[] = ["name is", "name's", "names", "name was", "called", "named", "goes by", "it's", "it is", "she's", "he's", "they're", "she is", "he is"];

const fold = (t: string) => t.normalize("NFKC").toLowerCase().replace(/[‘’ʼ]/g, "'");

/** True when some whole-word occurrence of `name` in `span` has one of `before` right before it (commas and spaces between). */
function preceded(span: string, name: string, before: readonly string[]): boolean {
  const s = fold(span);
  const n = fold(name).trim();
  if (n === "") return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const m of s.matchAll(new RegExp(`(?<![\\p{L}\\p{N}'])${escaped}(?![\\p{L}\\p{N}])`, "gu"))) {
    const head = s.slice(0, m.index).replace(/[\s,]+$/u, "");
    if (before.some((b) => head === b || head.endsWith(` ${b}`) || head.endsWith(`,${b}`))) return true;
  }
  return false;
}

/** True when the owner's words in `span` say the rename goes the other way, or can't say it goes this way. */
export function renameRefuted(span: string, from: string, to: string): boolean {
  return preceded(span, to, NAME_NEGATORS) || preceded(span, from, NAME_ASSERTERS);
}
