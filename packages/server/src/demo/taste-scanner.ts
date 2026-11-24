/**
 * The taste scanner (brief 054, R25.2): does a line of the persona hold a word from a denied list? The list is an
 * argument, not an import, so the scanner is tested against generated lists (property 9) and the real Denied_List,
 * a data file of its own, is applied to the persona elsewhere (property 8).
 *
 * Both sides are compared folded: NFKC (so fullwidth and compatibility forms read as their plain letters), then case
 * folded, then every run of whitespace as one space. A denied entry counts only as a whole word or words: the
 * characters on either side of it may not be letters, marks or digits, so "Applesauce" never flags "apple". An entry
 * may hold several words or a joining mark ("A&B", "x-y"); it is matched as written, after the same folding.
 */

/** A letter, a combining mark or a digit: what continues a word. Everything else ends one. */
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;

/**
 * The folded form both sides are compared in. Upper then lower case folds more than lower case alone ("ß" and "SS"
 * both read "ss"); NFKC runs again after, since a case change can leave a composable sequence.
 */
export function foldText(s: string): string {
  return s.normalize("NFKC").toUpperCase().toLowerCase().normalize("NFKC").replace(/\s+/gu, " ");
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && WORD_CHAR.test(c);

/** The whole code point that ends just before `i`, so a letter outside the BMP is read as one character. */
function pointBefore(s: string, i: number): string | undefined {
  if (i <= 0) return undefined;
  const lo = s.charCodeAt(i - 1);
  const start = lo >= 0xdc00 && lo <= 0xdfff && i >= 2 ? i - 2 : i - 1;
  return String.fromCodePoint(s.codePointAt(start)!);
}

/** The whole code point that starts at `i`. */
const pointAt = (s: string, i: number): string | undefined => (i < s.length ? String.fromCodePoint(s.codePointAt(i)!) : undefined);

/** Whether the folded entry stands in the folded text as a whole word at least once. */
function standsIn(text: string, word: string): boolean {
  const first = pointAt(word, 0);
  const last = pointBefore(word, word.length);
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    // A boundary is needed only where the entry itself starts or ends with a word character.
    const before = isWordChar(first) && isWordChar(pointBefore(text, at));
    const after = isWordChar(last) && isWordChar(pointAt(text, at + word.length));
    if (!before && !after) return true;
  }
  return false;
}

/** The entries of `words` that `text` holds, in list order, each once. A blank entry never matches. */
export function deniedWordsIn(text: string, words: readonly string[]): string[] {
  const folded = foldText(text);
  const found: string[] = [];
  for (const w of words) {
    const f = foldText(w).trim();
    if (f === "" || found.includes(w)) continue;
    if (standsIn(folded, f)) found.push(w);
  }
  return found;
}

/** Whether `text` holds any entry of `words`. */
export function holdsDeniedWord(text: string, words: readonly string[]): boolean {
  return deniedWordsIn(text, words).length > 0;
}
