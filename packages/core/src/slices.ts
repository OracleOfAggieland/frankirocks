/**
 * Turn slice classification and Slice construction (R18 typed classification; R20.2–R20.4, R20.7).
 * A Slice `contentHash` is SHA-256 of the UTF-8 bytes of the LF-normalized field text at `[start, end)`.
 * Ranges that split a surrogate pair are rejected before hashing.
 */
import type { Hasher } from "./ids";
import { sensFloor } from "./lexicon";
import type { Class, FP, Sens, Slice } from "./schema/primitives";
import { checkRange, normalizeLF, utf8, type RangeError_ } from "./text";

export const PASTED_MAX_UNITS = 280;
const URL_PATTERN = /\bhttps?:\/\/|\bwww\.[^\s]+\.[a-z]{2,}/i;

export type TypedClass = { kind: "ordinary"; class: "U" } | { kind: "pasted"; class: "T" };

/**
 * Typed text classification (contracts §6 Routes "Typed/chip"; design "One typed turn"): pasted/T if the raw text
 * is over 280 UTF-16 code units, contains CR or LF, `From:` or `Subject:`, or a URL; otherwise ordinary/U.
 */
export function classifyTyped(raw: string): TypedClass {
  const pasted =
    raw.length > PASTED_MAX_UNITS || /[\r\n]/.test(raw) || raw.includes("From:") || raw.includes("Subject:") || URL_PATTERN.test(raw);
  return pasted ? { kind: "pasted", class: "T" } : { kind: "ordinary", class: "U" };
}

/** The bytes hashed for a Slice's contentHash, or the reason the range cannot be hashed. */
export function sliceHashInput(
  fieldText: string,
  start: number,
  end: number,
): { ok: true; bytes: Uint8Array } | { ok: false; error: RangeError_ | "notNormalized" } {
  if (fieldText !== normalizeLF(fieldText)) return { ok: false, error: "notNormalized" };
  const bad = checkRange(fieldText, start, end);
  if (bad !== null) return { ok: false, error: bad };
  return { ok: true, bytes: utf8(fieldText.slice(start, end)) };
}

export interface SliceSpec {
  eid: string;
  fieldPath: FP;
  fieldText: string;
  start: number;
  end: number;
  class: Class;
  sens: Sens;
}

/** Builds a Slice with its contentHash. Throws on an unusable range: callers build slices from code-owned ranges. */
export function buildSlice(spec: SliceSpec, hasher: Hasher): Slice {
  const input = sliceHashInput(spec.fieldText, spec.start, spec.end);
  if (!input.ok) throw new RangeError(`buildSlice: ${input.error}`);
  return {
    eid: spec.eid,
    fieldPath: spec.fieldPath,
    start: spec.start,
    end: spec.end,
    contentHash: hasher.sha256(input.bytes),
    class: spec.class,
    sens: spec.sens,
  };
}

/** The one whole-text Slice of a user turn's Evidence (design "Turn evidence"): class U, or T when pasted. */
export function turnTextSlice(eid: string, text: string, cls: "U" | "T", hasher: Hasher): Slice {
  return buildSlice({ eid, fieldPath: "text", fieldText: text, start: 0, end: text.length, class: cls, sens: sensFloor(text) }, hasher);
}

/** True when a Slice's contentHash matches the field text (the W-LINEAGE hash check). */
export function sliceHashMatches(slice: Slice, fieldText: string, hasher: Hasher): boolean {
  if (slice.start === null || slice.end === null) return false;
  const input = sliceHashInput(fieldText, slice.start, slice.end);
  return input.ok && hasher.sha256(input.bytes) === slice.contentHash;
}
