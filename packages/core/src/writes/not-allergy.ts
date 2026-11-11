/**
 * Cue sentences and the `notAllergy` check (design 2.5, G3). Pure.
 *
 * Cue sentences: sentences split at `.`, `!`, `?`, `;` and line breaks, offsets kept. They are the sentences with an
 * RX4 match; on an answering turn, the whole text; with no RX4 match and a valid answer, the sentences holding a
 * verified allergy item span; with no RX4 match and no valid answer, the whole text. Only their U parts are scanned.
 * A subject mention is left out ("my dog is allergic to chicken" doesn't count dog) only when it is plain (at most
 * `MENTION_MAX_WORDS` words, no RX4 word) and validation resolved a subject from it; any other mention is scanned
 * like the rest of the text, so a model-chosen mention can never switch coverage or the fallback off.
 *
 * The code's half of G3 holds when the turn's U text names no gazetteer alias, every cue word in an RX4 sentence is
 * `allerg…` or `intoleran…` (never `anaphyla…`, `epipen` or `celiac`), and no generic object word stands within six
 * words of a cue, except a compound right after "allergy" ("allergy pill").
 */
import { REGEX_TABLE, normalizeForRegex } from "../intents/regex";
import type { Span } from "../schema/primitives";
import { scanAliases, wordTokens } from "./gazetteer";
import { uParts, verifyTurnSpan } from "./spans";
import type { FastSlotsOut, TurnEvidence } from "./types";

/** The closed list of G3, used only by the `notAllergy` check. */
export const GENERIC_ALLERGY_OBJECTS = [
  "something", "anything", "it", "that", "this", "these", "those", "stuff", "food", "foods", "ingredient", "ingredients",
  "dish", "dishes", "meal", "meals", "sauce", "medicine", "medication", "medications", "meds", "pill", "pills", "drug",
  "drugs", "plant", "plants", "animal", "animals",
] as const;

/** Words that don't count when they directly follow "allergy" or "allergies". */
export const ALLERGY_COMPOUNDS = ["pill", "pills", "meds", "medicine", "medication", "shot", "shots", "tablet", "tablets", "spray"] as const;

/** How many words on each side of a cue the generic-object check looks at. */
export const GENERIC_WINDOW = 6;

/** The longest subject mention that may be left out of the cue sentences ("my little brother's friend"). */
export const MENTION_MAX_WORDS = 5;

const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;
const GENERIC: ReadonlySet<string> = new Set(GENERIC_ALLERGY_OBJECTS);
const COMPOUND: ReadonlySet<string> = new Set(ALLERGY_COMPOUNDS);

export interface Range {
  start: number;
  end: number;
}

/** Sentences split at . ! ? ; and line breaks, with offsets on the text (leading spaces left out). */
export function sentencesOf(text: string): Range[] {
  const out: Range[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || ".!?;\n".includes(text[i]!)) {
      let from = start;
      while (from < i && /\s/.test(text[from]!)) from++;
      if (i > from) out.push({ start: from, end: i });
      start = i + 1;
    }
  }
  return out;
}

/** The sentences with an RX4 match. */
export function rx4Sentences(text: string): Range[] {
  return sentencesOf(text).filter((s) => RX4.test(normalizeForRegex(text.slice(s.start, s.end))));
}

/** The cue sentences, whole (before the U and mention cuts). */
export function cueSentenceRanges(e: TurnEvidence, out: FastSlotsOut | null, answering: boolean): Range[] {
  const whole = e.text.length === 0 ? [] : [{ start: 0, end: e.text.length }];
  if (answering) return whole;
  const rx = rx4Sentences(e.text);
  if (rx.length > 0) return rx;
  if (out === null) return whole;
  const spans = out.items.flatMap((it) => (it.kind === "allergy" ? [verifyTurnSpan(it.span, e)].filter((s): s is Span => s !== null) : []));
  return sentencesOf(e.text).filter((s) => spans.some((sp) => sp.start < s.end && s.start < sp.end));
}

/** `ranges` minus `cut`, in order. */
function minus(ranges: readonly Range[], cut: readonly Range[]): Range[] {
  let out = [...ranges];
  for (const c of cut) {
    out = out.flatMap((r) => (c.end <= r.start || r.end <= c.start ? [r] : [{ start: r.start, end: c.start }, { start: c.end, end: r.end }].filter((x) => x.start < x.end)));
  }
  return out;
}

/** A mention short enough to name a person and holding no RX4 word: the only kind a subject may come from. */
export function plainMention(quote: string): boolean {
  const w = wordTokens(quote);
  return w.length > 0 && w.length <= MENTION_MAX_WORDS && !w.some((t) => RX4.test(t.word));
}

/** The verified, plain subject mentions of the allergy items at `cuttable` (the items a subject was resolved from). */
function mentionRanges(e: TurnEvidence, out: FastSlotsOut | null, cuttable: ReadonlySet<number>): Range[] {
  return (out?.items ?? []).flatMap((it, i) => {
    if (!cuttable.has(i) || it.kind !== "allergy" || it.subject.mention === null) return [];
    const m = verifyTurnSpan(it.subject.mention, e);
    return m === null || !plainMention(m.quote) ? [] : [{ start: m.start, end: m.end }];
  });
}

/** The cue sentences' U ranges on the Evidence text, mention cuts not applied: the fallback's scope. */
export function cueSentenceUParts(e: TurnEvidence, out: FastSlotsOut | null, answering: boolean): Range[] {
  return cueSentenceRanges(e, out, answering).flatMap((s) => uParts(e.slices, s.start, s.end));
}

/** The cue sentences' U ranges on the Evidence text, with the plain mentions of the items at `cuttable` left out. */
export function cueSentences(e: TurnEvidence, out: FastSlotsOut | null, answering: boolean, cuttable: ReadonlySet<number>): Range[] {
  return minus(cueSentenceUParts(e, out, answering), mentionRanges(e, out, cuttable));
}

/** The first RX4 cue word inside `ranges`, as a Span quoting the Evidence text at its offsets (design 2.5). */
export function cueSpan(e: TurnEvidence, ranges: readonly Range[]): Span | null {
  for (const r of ranges) {
    for (const t of wordTokens(e.text, r.start, r.end)) {
      if (RX4.test(t.word)) return { eid: e.eid, fieldPath: "text", start: t.start, end: t.end, quote: e.text.slice(t.start, t.end) };
    }
  }
  return null;
}

/**
 * The code's half of the G3 check. The model's half is the caller's. An alias anywhere in the turn's U text fails it
 * ("I'm allergic. To shellfish."), so an empty answer never decides alone that a named allergen isn't one.
 */
export function notAllergyByCode(e: TurnEvidence): boolean {
  const rx = rx4Sentences(e.text);
  if (rx.length === 0) return false;
  if (uParts(e.slices, 0, e.text.length).some((r) => scanAliases(e.text, r.start, r.end).length > 0)) return false;
  for (const s of rx) {
    if (scanAliases(e.text, s.start, s.end).length > 0) return false;
    const w = wordTokens(e.text, s.start, s.end).map((t) => t.word);
    const cues = w.flatMap((x, i) => (RX4.test(x) ? [i] : []));
    if (cues.length === 0) return false;
    for (const i of cues) {
      if (!/^(allerg|intoleran)/.test(w[i]!)) return false;
      for (let j = Math.max(0, i - GENERIC_WINDOW); j <= Math.min(w.length - 1, i + GENERIC_WINDOW); j++) {
        if (j === i || !GENERIC.has(w[j]!)) continue;
        if (j === i + 1 && /^allerg(y|ies)$/.test(w[i]!) && COMPOUND.has(w[j]!)) continue;
        return false;
      }
    }
  }
  return true;
}
