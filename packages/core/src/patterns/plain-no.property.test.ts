// Feature: what the voice machine sends (brief 040, item 2): only a plain no is a no.
// In a call, `answer` takes no arguments and code reads the choice from the owner's own words. A no is one whole
// utterance from a short closed list: a negative, with at most "thanks" or "thank you" after it, and nothing left
// over. Case and punctuation don't matter. Nothing is both a plain yes and a plain no. The list below is written out
// by hand, independent of the product's, as brief 037's property 4 does for the yes.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isPlainNo, isPlainYes } from "./offer";

const NEGATIVES = ["no", "nope", "nah", "not now", "not today", "no way"];
const TAILS = ["", "thanks", "thank you"];
const CLOSED = new Set(NEGATIVES.flatMap((a) => TAILS.map((t) => (t === "" ? a : `${a} ${t}`))));

/** The oracle's reading of an utterance: lower case, apostrophes dropped, everything else not a letter or digit a space. */
const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const WORDS = ["but", "maybe", "later", "tomorrow", "i", "think", "so", "not", "sure", "yes", "no", "thanks", "please", "do", "it", "wait", "dont", "know", "actually", "yeah", "now", "today"];
const punct = fc.constantFrom("", ".", ",", "!", "?", " ...", " -");
const wordArb = fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...WORDS) }, { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 6 }) });
const caseArb = (s: string) => fc.constantFrom(s, s.toUpperCase(), s.charAt(0).toUpperCase() + s.slice(1));
const negArb = fc.constantFrom(...NEGATIVES);

describe("Brief 040 item 2: only a plain no is a no", () => {
  it("a plain no from the closed list, in any case and punctuation, is a no", () => {
    fc.assert(
      fc.property(negArb.chain(caseArb), fc.constantFrom(...TAILS), punct, punct, (a, t, p1, p2) => {
        expect(isPlainNo(t === "" ? `${a}${p2}` : `${a}${p1} ${t}${p2}`)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("a plain no followed by more words is not a no unless the whole is on the list", () => {
    fc.assert(
      fc.property(negArb.chain(caseArb), punct, fc.array(wordArb, { minLength: 1, maxLength: 5 }), punct, (a, p1, more, p2) => {
        const text = `${a}${p1} ${more.join(" ")}${p2}`;
        expect(isPlainNo(text), text).toBe(CLOSED.has(norm(text)));
      }),
      { numRuns: 1000 },
    );
  });

  it("any utterance is a no only when it is on the list, and never a yes and a no at once", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 40 }), fc.array(wordArb, { minLength: 1, maxLength: 6 }).map((w) => w.join(" "))), (text) => {
        if (isPlainNo(text)) {
          expect(CLOSED.has(norm(text)), text).toBe(true);
          expect(isPlainYes(text), text).toBe(false);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
