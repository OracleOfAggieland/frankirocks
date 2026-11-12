// Feature: forget (brief 021), Property FP2: a sentence never loses half its meaning (spec §8 step 5; contracts §8
// "Sanitize"). For any text built from whole sentences, any removed ranges and any rule spans, `sanitizeText`:
//   - keeps no piece of a sentence that overlapped a non-empty removed range, except a rule span disjoint from
//     every range, copied intact;
//   - keeps every sentence that overlapped no range, whole;
//   - writes nothing but its pieces, joined by the neutral separator, each verbatim from the old text.
// Sentence offsets come from the generator, not from the code under test.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SANITIZE_SEPARATOR, sanitizeText } from "./sanitize";
import { rangeIn, textArb } from "./testing/arb-forget";

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

const caseArb = textArb.chain((t) =>
  fc.tuple(
    fc.constant(t),
    fc.array(rangeIn(t.text.length), { maxLength: 4 }),
    fc.array(fc.tuple(fc.nat(), fc.nat(), fc.nat()), { maxLength: 3 }).map((picks) =>
      picks.map(([i, a, b]) => {
        const s = t.sentences[i % t.sentences.length]!;
        const len = s.end - s.start;
        const x = a % (len + 1);
        const y = b % (len + 1);
        return { start: s.start + Math.min(x, y), end: s.start + Math.max(x, y) };
      }),
    ),
  ),
);

describe("FP2: a sentence never loses half its meaning", () => {
  it("drops every sentence holding a removed range, except disjoint rule spans", () => {
    fc.assert(
      fc.property(caseArb, ([t, removed, ruleSpans]) => {
        const out = sanitizeText(t.text, removed, ruleSpans);
        const live = removed.filter((r) => r.end > r.start);
        for (const p of out.pieces) {
          expect(out.text.slice(p.newStart, p.newEnd)).toBe(t.text.slice(p.oldStart, p.oldEnd));
          for (const r of live) expect(overlaps({ start: p.oldStart, end: p.oldEnd }, r), "a kept piece overlaps a removed range").toBe(false);
          if (p.ruleSpan) {
            expect(ruleSpans.some((r) => r.start === p.oldStart && r.end === p.oldEnd)).toBe(true);
          } else {
            const s = t.sentences.find((x) => x.start === p.oldStart && x.end === p.oldEnd);
            expect(s, "a kept piece is not a whole sentence").toBeDefined();
          }
        }
        for (const s of t.sentences) {
          const hit = live.some((r) => overlaps(s, r));
          const kept = out.pieces.some((p) => !p.ruleSpan && p.oldStart === s.start && p.oldEnd === s.end);
          expect(kept).toBe(!hit);
          if (hit) {
            for (const p of out.pieces) if (overlaps({ start: p.oldStart, end: p.oldEnd }, s)) expect(p.ruleSpan).toBe(true);
          }
        }
        expect(out.text).toBe(out.pieces.map((p) => t.text.slice(p.oldStart, p.oldEnd)).join(SANITIZE_SEPARATOR));
      }),
      { numRuns: 1000 },
    );
  });
});
