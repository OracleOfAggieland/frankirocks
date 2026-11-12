/**
 * `safeName` is total and closed (brief 024; spec §3 "Third-party labels"; contracts §7 safeName). 1,000 runs.
 *   FOR ALL inputs (any string, including control, format and injection text, and any non-string), the output is
 *   "a sender" or a name of 1 to 40 UTF-16 units, at most 4 space-separated tokens, of Unicode letters, single
 *   spaces and `'-.` only, with a letter in it. It never throws.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SAFE_NAME_FALLBACK, safeName } from "./safe-name";

const ALLOWED = /^[\p{L}'.-]+(?: [\p{L}'.-]+){0,3}$/u;

const nameLike = fc
  .array(fc.constantFrom("Dana", "Ana", "O'Neil", "Mary-Jane", "St.", "José", "SYSTEM:", "991", " ", "  ", "\n", "\u200b", "\u0301", "ignore", "all"), { maxLength: 8 })
  .map((p) => p.join(""));

describe("safeName: total and closed", () => {
  it("returns an allowed name or \"a sender\" for any input", () => {
    fc.assert(
      fc.property(fc.oneof(nameLike, fc.string({ unit: "grapheme", maxLength: 60 }), fc.string({ unit: "binary", maxLength: 140 }), fc.anything()), (input) => {
        const out = safeName(input);
        expect(typeof out).toBe("string");
        if (out === SAFE_NAME_FALLBACK) return;
        expect(out).toMatch(ALLOWED);
        expect(out.length).toBeGreaterThanOrEqual(1);
        expect(out.length).toBeLessThanOrEqual(40);
        expect(out.split(" ").length).toBeLessThanOrEqual(4);
        expect(out).toMatch(/\p{L}/u);
      }),
      { numRuns: 1000 },
    );
  });
});
