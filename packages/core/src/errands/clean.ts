/**
 * Brief 049 part A, review fix V3: helper-worded text and third-party labels reduced to a safe set before they are
 * spoken (`sayExactly` quotes the line inside the voice model's instructions) or shown on a card. Pure.
 *
 * Always: NFC; no double quotes (straight or typographic) and no backticks; no control, format (bidi, zero-width,
 * tag), line or paragraph separator, or invisible filler characters; no newlines (every run of whitespace is one
 * space); a URL-like token (a scheme, `www.`, or any bare host) becomes `[link]`.
 * A text that is empty after cleaning is `""`, and its caller drops it.
 */

/** What a URL-like token becomes. */
export const ERRAND_LINK_STAND_IN = "[link]";

const QUOTES = /["`“”„‟«»″‶＂｀]/gu;
/** Controls, format characters (bidi marks and overrides, zero-width, tags), separators and invisible fillers. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}ᅟᅠㅤﾠ︀-️\u{E0100}-\u{E01EF}]/gu;
/**
 * Review fix T12: a bare host is any run of dot-joined labels ending in a label of two or more letters (any script,
 * or a punycode `xn--` label), with no list of endings to fall behind. A one-letter label can't end it, so "e.g.",
 * "a.m." and "U.S." stay words; a missing space ("Dr.Smith") reads as a link, which fails safe.
 */
const LABEL = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62}[\p{L}\p{N}])?`;
const ENDING = String.raw`(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})`;
const URL_LIKE = new RegExp(
  String.raw`(?:\b[a-z][a-z0-9+.-]{1,15}:\/\/\S*|\b(?:mailto|javascript|data|tel|sms|file):\S+|\bwww\.\S+|(?<![\p{L}\p{N}-])(?:${LABEL}\.)+${ENDING}(?![\p{L}\p{N}-])(?:[/?#:]\S*)?)`,
  "giu",
);

export function cleanErrandText(text: string): string {
  let t: string;
  try {
    t = text.normalize("NFC");
  } catch {
    return "";
  }
  // Whitespace controls become spaces first, so "a\nb" stays two words.
  t = t.replace(/[\t\n\v\f\r\u0085\u2028\u2029]/gu, " ");
  t = t.replace(INVISIBLE, "").replace(QUOTES, "");
  t = t.replace(URL_LIKE, ERRAND_LINK_STAND_IN);
  return t.replace(/\s+/gu, " ").trim();
}

/** True when the text is already in the safe set (what `cleanErrandText` would leave unchanged). */
export const isCleanErrandText = (text: string): boolean => cleanErrandText(text) === text;
