// Feature: review of the hero and food (brief 037), Property 4: only a plain yes is a yes.
// A yes is one whole utterance from a short closed list: an affirmative, with at most "please", "thanks" or "let's do
// it" after it, and nothing left over. Case and punctuation don't matter. For any utterance outside that list,
// including any plain yes followed by more words, `isPlainYes` is false. The list below is written out by hand,
// independent of the product's.
// (The other half, "a yes that is not the next turn after the offer was presented writes nothing", is server side.)
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isPlainYes } from "./offer";

const AFFIRMATIVES = ["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "absolutely", "definitely", "sounds good", "go ahead", "lets do it", "lets do that"];
const TAILS = ["", "please", "thanks", "thank you", "lets do it"];
const CLOSED = new Set(AFFIRMATIVES.flatMap((a) => TAILS.map((t) => (t === "" ? a : `${a} ${t}`))));

/** The oracle's reading of an utterance: lower case, apostrophes dropped, everything else not a letter or digit a space. */
const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const WORDS = ["tell", "me", "more", "first", "tomorrow", "right", "after", "i", "check", "with", "sam", "actually", "hmm", "what", "are", "they", "think", "about", "it", "do", "later", "please", "thanks", "yes", "no", "sure", "go", "ahead"];
const punct = fc.constantFrom("", ".", ",", "!", "?", " ...", " -");
const wordArb = fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...WORDS) }, { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 6 }) });
const caseArb = (s: string) => fc.constantFrom(s, s.toUpperCase(), s.charAt(0).toUpperCase() + s.slice(1));
const affirmArb = fc.constantFrom(...AFFIRMATIVES).map((a) => a.replace("lets", "let's"));

describe("Property 4: only a plain yes is a yes", () => {
  it("a plain yes from the closed list, in any case and punctuation, is a yes", () => {
    fc.assert(
      fc.property(affirmArb.chain(caseArb), fc.constantFrom(...TAILS), punct, punct, (a, t, p1, p2) => {
        expect(isPlainYes(t === "" ? `${a}${p2}` : `${a}${p1} ${t.replace("lets", "let's")}${p2}`)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("a plain yes followed by more words is not a yes unless the whole is on the list", () => {
    fc.assert(
      fc.property(affirmArb.chain(caseArb), punct, fc.array(wordArb, { minLength: 1, maxLength: 5 }), punct, (a, p1, more, p2) => {
        const text = `${a}${p1} ${more.join(" ")}${p2}`;
        expect(isPlainYes(text), text).toBe(CLOSED.has(norm(text)));
      }),
      { numRuns: 1000 },
    );
  });

  it("any utterance is a yes only when it is on the list", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 40 }), fc.array(wordArb, { minLength: 1, maxLength: 6 }).map((w) => w.join(" "))), (text) => {
        if (isPlainYes(text)) expect(CLOSED.has(norm(text)), text).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});
