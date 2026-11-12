/**
 * The owner's own words around an item's span (brief 043, W-230): the whole sentence or sentences of the turn that the
 * span touches, on their U parts only. A first-person check that chooses whose allergy it is reads these words, never
 * the span alone, so the model's span boundaries can't drop the owner's "I". Pure.
 */
import type { Span } from "../schema/primitives";
import { sentencesOf } from "./not-allergy";
import { uParts } from "./spans";
import type { TurnEvidence } from "./types";

/** The range of the sentences of `ev.text` that `[span.start, span.end)` overlaps (the span itself if none). */
export function ownerSentenceRange(span: Pick<Span, "start" | "end">, ev: Pick<TurnEvidence, "text">): { start: number; end: number } {
  const touched = sentencesOf(ev.text).filter((s) => s.start < span.end && span.start < s.end);
  if (touched.length === 0) return { start: span.start, end: span.end };
  return { start: Math.min(span.start, touched[0]!.start), end: Math.max(span.end, touched[touched.length - 1]!.end) };
}

/** The U words of the sentences of `ev.text` that `[span.start, span.end)` overlaps, joined by a space. */
export function ownerSentence(span: Pick<Span, "start" | "end">, ev: Pick<TurnEvidence, "text" | "slices">): string {
  const r = ownerSentenceRange(span, ev);
  return uParts(ev.slices, r.start, r.end)
    .map((p) => ev.text.slice(p.start, p.end))
    .join(" ");
}
