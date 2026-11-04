/**
 * Text rules shared by Evidence, Slices and Spans (R20.2, R24.7; contracts §5 "Absolute LF UTF-16 spans").
 * Offsets are UTF-16 code units over LF-normalized text, end-exclusive.
 */

/** Converts every CRLF pair and every lone CR to LF (R20.2). */
export function normalizeLF(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** True when `offset` falls between the two halves of a surrogate pair. */
export function splitsSurrogate(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  return isHigh(text.charCodeAt(offset - 1)) && isLow(text.charCodeAt(offset));
}

export type RangeError_ = "outOfRange" | "reversed" | "surrogateSplit";

/** Checks `[start, end)` against `text`. Returns null when the range is usable. */
export function checkRange(text: string, start: number, end: number): RangeError_ | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > text.length) return "outOfRange";
  if (start > end) return "reversed";
  if (splitsSurrogate(text, start) || splitsSurrogate(text, end)) return "surrogateSplit";
  return null;
}

/** Returns the text at `[start, end)`, or null when the range is not usable. */
export function textAt(text: string, start: number, end: number): string | null {
  return checkRange(text, start, end) === null ? text.slice(start, end) : null;
}

/** UTF-8 bytes of a string. Lone surrogates make the input invalid for hashing. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** True when the string has no unpaired surrogate. */
export function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isHigh(c)) {
      if (i + 1 >= text.length || !isLow(text.charCodeAt(i + 1))) return false;
      i++;
    } else if (isLow(c)) {
      return false;
    }
  }
  return true;
}

/** Token split used by chunking and the asked test: NFKC, lowercase, runs of letters and digits. */
export function tokenize(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
