/**
 * Sanitized evidence text, pure (spec §8 step 5; contracts §8 "Sanitize"). A sentence holding any removed range
 * drops whole, except a verified rule span disjoint from every range, which is copied intact. Kept pieces are
 * joined by a neutral separator; no fragments are joined into new sentences. The map says where each kept piece
 * came from.
 */
import { NotBuilt } from "./not-built";

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

/** Sentences: split after `.`, `!` or `?` followed by whitespace or the end, and at each line break; trimmed. */
export function sentenceRanges(_text: string): TextRange[] {
  throw new NotBuilt("sentenceRanges");
}

export function sanitizeText(_text: string, _removed: readonly TextRange[], _ruleSpans: readonly TextRange[]): Sanitized {
  throw new NotBuilt("sanitizeText");
}
