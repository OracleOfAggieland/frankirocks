/**
 * The allergen gazetteer (design 2.1): a closed, versioned table of IDs, labels and aliases. Pure.
 * Stub from wave A task A2; task A3 builds the table and the matchers.
 */
import { NotBuilt } from "./types";

export const GAZETTEER_VERSION = "gz1";

/** NFKC, lowercase, curly apostrophes to ', hyphens to spaces, a word-final possessive 's dropped, spaces collapsed. */
export function normalizeAllergenText(_text: string): string {
  throw new NotBuilt("normalizeAllergenText");
}

/** Every code whose alias occurs as a whole-word sequence, longer aliases winning. `none` only here. */
export function lookupAllergen(_text: string): string[] {
  throw new NotBuilt("lookupAllergen");
}

/** The aliases found in `text[start, end)`, with their offsets on `text`. Never the `none` entry. */
export function scanAliases(_text: string, _start = 0, _end?: number): { code: string; start: number; end: number }[] {
  throw new NotBuilt("scanAliases");
}
