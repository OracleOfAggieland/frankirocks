/**
 * Sanitized evidence text, pure (spec §8 step 5; contracts §8 "Sanitize"). A sentence holding any removed range
 * drops whole, except a verified rule span disjoint from every range, which is copied intact. Kept pieces are
 * joined by a neutral separator; no fragments are joined into new sentences. The map says where each kept piece
 * came from.
 */
import { splitsSurrogate } from "../text";

export interface TextRange {
  start: number;
  end: number;
}

export interface SanitizePiece {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  /** True for a verified rule span kept out of a dropped sentence. */
  ruleSpan: boolean;
}

export interface Sanitized {
  text: string;
  pieces: SanitizePiece[];
  droppedSentences: number;
}

/** The neutral separator between kept pieces. */
export const SANITIZE_SEPARATOR = " ";

/**
 * Short words that end in "." without ending a sentence ("Dr. Patel", "St. Louis"). A "." after one of these, after
 * a single letter (an initial) or after a dotted token ("a.m.", "e.g.", "U.S.") never ends a sentence, so a hit
 * sentence drops on to the next sure end or line break (fails closed; review 028 finding 1).
 */
export const NON_FINAL_ABBREVIATIONS: ReadonlySet<string> = new Set([
  "dr", "mr", "mrs", "ms", "mx", "prof", "st", "mt", "ave", "rd", "blvd", "jr", "sr", "sen", "rep", "gov", "gen", "col", "capt", "lt", "sgt", "rev", "fr",
  "vs", "etc", "inc", "ltd", "co", "corp", "no", "vol", "fig", "dept", "approx", "est", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept",
  "oct", "nov", "dec", "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
]);

/** True when the "." at `i` (followed by whitespace) surely ends a sentence. */
function periodEnds(text: string, i: number): boolean {
  let j = i;
  while (j > 0 && /[\p{L}.]/u.test(text[j - 1]!)) j--;
  const token = text.slice(j, i);
  if (token.includes(".") || /^\p{L}$/u.test(token) || NON_FINAL_ABBREVIATIONS.has(token.toLowerCase())) return false;
  let k = i + 1;
  while (k < text.length && /\s/.test(text[k]!)) {
    if (text[k] === "\n") return true;
    k++;
  }
  if (k === text.length) return true;
  // A lowercase word or a number after the "." continues the sentence ("3 a.m. and", "approx. 5").
  return !/[\p{Ll}\p{N}]/u.test(text[k]!);
}

/**
 * Sentences: split after `!` or `?` followed by whitespace or the end, after a `.` that surely ends a sentence
 * (`periodEnds`), and at each line break; trimmed.
 */
export function sentenceRanges(text: string): TextRange[] {
  const out: TextRange[] = [];
  let start = 0;
  const push = (end: number) => {
    let a = start;
    let b = end;
    while (a < b && /\s/.test(text[a]!)) a++;
    while (b > a && /\s/.test(text[b - 1]!)) b--;
    if (b > a) out.push({ start: a, end: b });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") {
      push(i);
      start = i + 1;
    } else if ((ch === "." || ch === "!" || ch === "?") && (i + 1 === text.length || /\s/.test(text[i + 1]!)) && (ch !== "." || periodEnds(text, i))) {
      push(i + 1);
      start = i + 1;
    }
  }
  push(text.length);
  return out;
}

const overlaps = (a: TextRange, b: TextRange) => a.start < b.end && b.start < a.end;

/** A range widened so it never splits a surrogate pair. */
function snapOut(text: string, r: TextRange): TextRange {
  let { start, end } = r;
  if (splitsSurrogate(text, start)) start--;
  if (splitsSurrogate(text, end)) end++;
  return { start, end };
}

export function sanitizeText(text: string, removed: readonly TextRange[], ruleSpans: readonly TextRange[]): Sanitized {
  const live = removed.filter((r) => r.end > r.start).map((r) => snapOut(text, r));
  // A rule span is kept only whole, disjoint from every range, and not overlapping another kept span.
  const spans = [...ruleSpans]
    .filter((r) => r.end > r.start && r.start >= 0 && r.end <= text.length && !splitsSurrogate(text, r.start) && !splitsSurrogate(text, r.end))
    .filter((r) => !live.some((x) => overlaps(r, x)))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const pieces: SanitizePiece[] = [];
  let out = "";
  let dropped = 0;
  const emit = (r: TextRange, ruleSpan: boolean) => {
    if (pieces.length > 0) out += SANITIZE_SEPARATOR;
    pieces.push({ oldStart: r.start, oldEnd: r.end, newStart: out.length, newEnd: out.length + (r.end - r.start), ruleSpan });
    out += text.slice(r.start, r.end);
  };
  for (const sentence of sentenceRanges(text)) {
    if (!live.some((r) => overlaps(sentence, r))) {
      emit(sentence, false);
      continue;
    }
    dropped++;
    let lastEnd = -1;
    for (const r of spans) {
      if (r.start < sentence.start || r.end > sentence.end || r.start < lastEnd) continue;
      emit(r, true);
      lastEnd = r.end;
    }
  }
  return { text: out, pieces, droppedSentences: dropped };
}
