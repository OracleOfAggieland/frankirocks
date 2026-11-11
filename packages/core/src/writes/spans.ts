/**
 * Span checks on the turn's Evidence (design 2.4: "The span check is extraction's"). Pure. A FastSlots span is
 * anchored and verified with extraction's own `anchorSpan` (SPAN_ANCHOR_SLACK) and `verifySpan`, over a packet that
 * holds only the turn, so any other eid fails. Authority is the class of the slice that covers the span whole, read
 * as extraction's `rangeClass` reads it: U only when one U slice covers it, T when a T slice does, M otherwise.
 */
import { type PlanContext, anchorSpan, verifySpan } from "../extract";
import type { Hasher } from "../ids";
import { maxSens, sensFloor } from "../lexicon";
import type { Class, Slice, Span } from "../schema/primitives";
import { utf8 } from "../text";
import type { TurnEvidence } from "./types";

function packetOf(ev: TurnEvidence): PlanContext {
  // anchorSpan and verifySpan read only `packet`, and of the Evidence only its inline `text` field.
  return { packet: new Map([[ev.eid, { evidence: { text: { kind: "inline", text: ev.text } }, fields: ["text"] }]]) } as unknown as PlanContext;
}

/** The span anchored onto its quote (within the slack), or as given when it can't be. Never verified. */
export function anchorTurnSpan(span: Span, ev: TurnEvidence): Span {
  return anchorSpan(span, packetOf(ev));
}

/** The verified span (anchored within the slack), or null when it doesn't match the turn's text. */
export function verifyTurnSpan(span: Span, ev: TurnEvidence): Span | null {
  const ctx = packetOf(ev);
  const anchored = anchorSpan(span, ctx);
  return verifySpan(anchored, ctx) === null ? null : anchored;
}

/** The class of the slice covering `[start, end)` whole on the turn's text field. */
export function rangeClassOn(slices: readonly Slice[], start: number, end: number): Class {
  const covering = slices.filter((s) => s.fieldPath === "text" && s.start !== null && s.end !== null && s.start <= start && end <= s.end);
  if (covering.some((s) => s.class === "U")) return "U";
  if (covering.some((s) => s.class === "T")) return "T";
  return "M";
}

/** The class a span's words carry on the turn: anchored offsets when it anchors, its own otherwise. */
export function spanClass(span: Span, ev: TurnEvidence): Class {
  if (span.eid !== ev.eid || span.fieldPath !== "text") return "M";
  const a = anchorTurnSpan(span, ev);
  return rangeClassOn(ev.slices, a.start, a.end);
}

/** The U slice covering `[start, end)` whole, or null. */
export function coveringU(slices: readonly Slice[], start: number, end: number): Slice | null {
  return slices.find((s) => s.class === "U" && s.fieldPath === "text" && s.start !== null && s.end !== null && s.start <= start && end <= s.end) ?? null;
}

/** The U parts of `[start, end)` on the turn's text field. */
export function uParts(slices: readonly Slice[], start: number, end: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const s of slices) {
    if (s.class !== "U" || s.fieldPath !== "text" || s.start === null || s.end === null) continue;
    const a = Math.max(start, s.start);
    const b = Math.min(end, s.end);
    if (a < b) out.push({ start: a, end: b });
  }
  return out.sort((x, y) => x.start - y.start);
}

/** A root Slice over a verified span of the turn, with its content hash (lineage, KC03). */
export function rootSliceOf(span: Span, ev: TurnEvidence, hasher: Hasher): Slice {
  const covering = coveringU(ev.slices, span.start, span.end);
  return {
    eid: ev.eid,
    fieldPath: "text",
    start: span.start,
    end: span.end,
    contentHash: hasher.sha256(utf8(ev.text.slice(span.start, span.end))),
    class: rangeClassOn(ev.slices, span.start, span.end),
    // The turn slice's floor covers the whole turn; the quote's own floor can only add to it (as extraction does).
    sens: maxSens(covering?.sens ?? "S0", sensFloor(ev.text.slice(span.start, span.end))),
  };
}
