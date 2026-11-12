// Feature: forget (review 028, finding 1), Property FP2b: a sentence with an abbreviation never loses half its
// meaning (spec §8 step 5; contracts §8 "Sanitize"). For any text built from whole sentences that hold
// abbreviations ("a.m.", "Dr.", "e.g.", "St.", "U.S.", initials), and any removed ranges, `sanitizeText`:
//   - keeps no character of a generated sentence that overlapped a non-empty removed range;
//   - keeps every line that held no such sentence, whole;
//   - writes nothing but its pieces, each verbatim from the old text.
// The oracle uses the generator's own sentence and line offsets only; it never calls `sentenceRanges`. Dropping
// more than the hit sentence is allowed (failing closed), but never past its line.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SANITIZE_SEPARATOR, sanitizeText } from "./sanitize";

interface At {
  start: number;
  end: number;
}

const OPENERS = ["My brother", "Dr. Patel", "Mr. Lee", "We", "She", "Mrs. Ortiz", "J. Smith"];
const MIDDLES = [
  "relapsed at 3 a.m.",
  "said e.g. rest helps",
  "lives on Main St. near the park",
  "met Ms. Diaz",
  "moved to the U.S. last year",
  "left at 5 p.m. sharp",
  "counted approx. 5 pills",
  "works at Acme Inc. now",
  "said i.e. no visits",
  "drove to St. Louis",
  "saw A. B. Jones",
];
const ENDS = ["and he might lose custody", "with Ana", "today", "again"];
const TERMS = [".", "!", "?"];

const sentenceArb = fc
  .tuple(fc.constantFrom(...OPENERS), fc.constantFrom(...MIDDLES), fc.constantFrom(...ENDS), fc.constantFrom(...TERMS))
  .map(([o, m, e, t]) => `${o} ${m} ${e}${t}`);

const textArb = fc
  .tuple(fc.array(sentenceArb, { minLength: 1, maxLength: 6 }), fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }))
  .map(([picks, breaks]) => {
    let text = "";
    const sentences: (At & { line: number })[] = [];
    const lines: At[] = [{ start: 0, end: 0 }];
    picks.forEach((p, i) => {
      if (i > 0) {
        if (breaks[i]!) {
          text += "\n";
          lines.push({ start: text.length, end: text.length });
        } else text += " ";
      }
      sentences.push({ start: text.length, end: text.length + p.length, line: lines.length - 1 });
      text += p;
      lines[lines.length - 1]!.end = text.length;
    });
    return { text, sentences, lines };
  });

const caseArb = textArb.chain((t) =>
  fc.tuple(
    fc.constant(t),
    fc
      .array(fc.tuple(fc.nat(), fc.nat(), fc.nat()), { minLength: 1, maxLength: 3 })
      .map((picks) =>
        picks.map(([i, a, b]) => {
          const s = t.sentences[i % t.sentences.length]!;
          const len = s.end - s.start;
          const x = a % len;
          const y = x + 1 + (b % (len - x));
          return { start: s.start + x, end: s.start + y };
        }),
      ),
  ),
);

const overlaps = (a: At, b: At) => a.start < b.end && b.start < a.end;

describe("FP2b: a sentence with an abbreviation never loses half its meaning", () => {
  it("the fixed case: 'relapsed' removed drops the whole sentence, not only up to 'a.m.'", () => {
    const text = "My brother relapsed at 3 a.m. and he might lose custody.";
    const at = text.indexOf("relapsed");
    expect(sanitizeText(text, [{ start: at, end: at + "relapsed".length }], []).text).toBe("");
  });

  it("drops every character of a hit sentence, and never touches a line without one", () => {
    fc.assert(
      fc.property(caseArb, ([t, removed]) => {
        const out = sanitizeText(t.text, removed, []);
        const hit = t.sentences.filter((s) => removed.some((r) => overlaps(s, r)));
        for (const p of out.pieces) {
          const piece = { start: p.oldStart, end: p.oldEnd };
          expect(out.text.slice(p.newStart, p.newEnd)).toBe(t.text.slice(p.oldStart, p.oldEnd));
          for (const s of hit) expect(overlaps(piece, s), `kept "${t.text.slice(piece.start, piece.end)}" overlaps a removed sentence`).toBe(false);
        }
        const hitLines = new Set(hit.map((s) => s.line));
        for (const s of t.sentences) {
          if (hitLines.has(s.line)) continue;
          const whole = out.pieces.some((p) => p.oldStart <= s.start && p.oldEnd >= s.end && p.oldEnd <= t.lines[s.line]!.end && p.oldStart >= t.lines[s.line]!.start);
          expect(whole, `"${t.text.slice(s.start, s.end)}" on an untouched line was not kept whole`).toBe(true);
        }
        expect(out.text).toBe(out.pieces.map((p) => t.text.slice(p.oldStart, p.oldEnd)).join(SANITIZE_SEPARATOR));
      }),
      { numRuns: 1000 },
    );
  });
});
