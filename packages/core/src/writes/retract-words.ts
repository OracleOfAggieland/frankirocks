/**
 * When a correction with no replacement retracts a row, by the owner's words (brief 043, finding 5). Pure.
 *
 * Row C6 needed only the value's word ("sister") in the turn, so "That's wrong, I meant my sister Maya is coming
 * Saturday." retracted the sister. Now a retraction needs a negation word tied to the target's value or name: one of
 * `RETRACT_NEGATIONS` within `RETRACT_REACH` words before it, in the same clause ("I don't have a sister", "Maya isn't
 * my sister", "she's not my sister"). Otherwise the correction defers.
 */

/** Words that negate the value or name after them. A word ending in "n't" counts too. */
export const RETRACT_NEGATIONS: ReadonlySet<string> = new Set(["not", "no", "never", "nobody", "none"]);
/** How many words before the value or name a negation still reaches. */
export const RETRACT_REACH = 3;

const fold = (t: string) => t.normalize("NFKC").toLowerCase().replace(/[‘’ʼ]/g, "'");

/** True when `span` negates one of `words` (the target's value words, or its entity's current name). */
export function retractionSaid(span: string, words: readonly string[]): boolean {
  const s = fold(span);
  for (const w of words) {
    const n = fold(w).trim();
    if (n === "") continue;
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const m of s.matchAll(new RegExp(`(?<![\\p{L}\\p{N}'])${escaped}(?![\\p{L}\\p{N}])`, "gu"))) {
      const clause = s.slice(0, m.index).split(/[,.;:!?]/).pop() ?? "";
      const before = clause.split(/[^\p{L}\p{N}']+/u).filter((x) => x !== "").slice(-RETRACT_REACH);
      if (before.some((x) => RETRACT_NEGATIONS.has(x) || x.endsWith("n't"))) return true;
    }
  }
  return false;
}
