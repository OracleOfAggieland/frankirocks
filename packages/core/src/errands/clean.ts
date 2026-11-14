/**
 * Brief 049 part A, review fix V3: helper-worded text and third-party labels reduced to a safe set before they are
 * spoken (`sayExactly` quotes the line inside the voice model's instructions) or shown on a card. Pure.
 *
 * Always: NFC; no double quotes (straight or typographic) and no backticks; no control, format (bidi, zero-width,
 * tag), line or paragraph separator, or invisible filler characters; no newlines (every run of whitespace is one
 * space); a URL-like token (a scheme, `www.`, or a bare host with a common top-level domain) becomes `[link]`.
 * A text that is empty after cleaning is `""`, and its caller drops it.
 */

/** What a URL-like token becomes. */
export const ERRAND_LINK_STAND_IN = "[link]";

const QUOTES = /["`“”„‟«»″‶＂｀]/gu;
/** Controls, format characters (bidi marks and overrides, zero-width, tags), separators and invisible fillers. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}ᅟᅠㅤﾠ︀-️\u{E0100}-\u{E01EF}]/gu;
const URL_LIKE =
  /(?:\b[a-z][a-z0-9+.-]{1,15}:\/\/\S*|\b(?:mailto|javascript|data|tel|sms|file):\S+|\bwww\.\S+|\b(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+(?:com|net|org|io|co|us|uk|ly|app|dev|me|info|biz|gov|edu|ai|xyz|link|site|online|top|ru|cn|de|fr|gl|gg|to|tv|sh|page|click|zip|mov)\b(?:[/?#]\S*)?)/giu;

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
