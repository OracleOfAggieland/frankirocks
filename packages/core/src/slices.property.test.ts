/**
 * Slice-hash property (R20.7, R31.4, R31.5): FOR ALL Evidence text and Slice ranges, a Slice's contentHash equals
 * SHA-256 of the UTF-8 bytes of the LF-normalized UTF-16 range [start, end) of its field. Hashing here is done
 * independently of `buildSlice` (Node crypto over Buffer.from(..., "utf8")).
 */
import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalJSON, type Hasher } from "./ids";
import { buildSlice, sliceHashInput, sliceHashMatches, turnTextSlice } from "./slices";
import { normalizeLF, splitsSurrogate } from "./text";

const hasher: Hasher = {
  id: (parts) => createHash("sha256").update(canonicalJSON(parts)).digest("base64url"),
  sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
};
const EID = "e".repeat(43);
const reference = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

/** Raw text with CRLF, lone CR, LF, accents and astral characters. */
const rawText = fc
  .array(fc.oneof(fc.constantFrom("\r\n", "\r", "\n", "é", "🐶", "😀", "Pip", " "), fc.string({ unit: "grapheme", maxLength: 4 })), { maxLength: 30 })
  .map((parts) => parts.join(""));

/** A range over `text` that does not split a surrogate pair. */
function wholeRange(text: string, a: number, b: number): [number, number] {
  let start = Math.floor(a * text.length);
  let end = start + Math.floor(b * (text.length - start));
  if (splitsSurrogate(text, start)) start -= 1;
  if (splitsSurrogate(text, end)) end += 1;
  return [start, end];
}

const frac = fc.double({ min: 0, max: 1, noNaN: true });

describe("slice hash", () => {
  it("contentHash is SHA-256 of the LF-normalized UTF-16 range", () => {
    fc.assert(
      fc.property(rawText, frac, frac, (raw, a, b) => {
        const text = normalizeLF(raw);
        expect(text).not.toContain("\r");
        const [start, end] = wholeRange(text, a, b);
        const slice = buildSlice({ eid: EID, fieldPath: "text", fieldText: text, start, end, class: "U", sens: "S0" }, hasher);
        expect(slice.contentHash).toBe(reference(text.slice(start, end)));
        expect(sliceHashMatches(slice, text, hasher)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("CR variants of the same text give the same hash after normalization", () => {
    // Lines are non-empty and break-free: a lone CR followed directly by an LF break is one CRLF, by design.
    const line = fc.string({ unit: "grapheme", minLength: 1, maxLength: 5 }).filter((l) => !/[\r\n]/.test(l));
    fc.assert(
      fc.property(fc.array(line, { maxLength: 8 }), fc.array(fc.constantFrom("\r\n", "\r", "\n"), { minLength: 8, maxLength: 8 }), (lines, breaks) => {
        const lf = lines.join("\n");
        const mixed = lines.map((l, i) => (i === 0 ? l : breaks[i % breaks.length] + l)).join("");
        expect(normalizeLF(mixed)).toBe(normalizeLF(lf));
        expect(turnTextSlice(EID, normalizeLF(mixed), "U", hasher).contentHash).toBe(turnTextSlice(EID, normalizeLF(lf), "U", hasher).contentHash);
      }),
      { numRuns: 300 },
    );
  });

  it("a range that splits a surrogate pair is rejected before hashing", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 6 }), fc.string({ unit: "grapheme", maxLength: 6 }), (before, after) => {
        const text = `${normalizeLF(before)}🐶${normalizeLF(after)}`;
        const mid = normalizeLF(before).length + 1;
        expect(sliceHashInput(text, 0, mid)).toEqual({ ok: false, error: "surrogateSplit" });
        expect(sliceHashInput(text, mid, text.length)).toEqual({ ok: false, error: "surrogateSplit" });
      }),
      { numRuns: 200 },
    );
  });

  it("a Slice does not match text that differs inside its range", () => {
    fc.assert(
      fc.property(rawText.filter((t) => normalizeLF(t).length > 0), frac, (raw, a) => {
        const text = normalizeLF(raw);
        const slice = turnTextSlice(EID, text, "U", hasher);
        const i = Math.min(text.length - 1, Math.floor(a * text.length));
        const changed = text.slice(0, i) + (text[i] === "x" ? "y" : "x") + text.slice(i + 1);
        fc.pre(changed !== text && normalizeLF(changed) === changed);
        expect(sliceHashMatches(slice, changed, hasher)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});
