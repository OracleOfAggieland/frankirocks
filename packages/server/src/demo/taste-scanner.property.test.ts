/**
 * The taste scanner is sound (brief 054 design, correctness property 9; R25.2). 1,000 runs.
 *   FOR ALL Denied_List words w, strings s and insertion points i, the scanner flags s with w inserted at i on a
 *   word boundary, whatever w's case, width (NFKC) or the whitespace between its words;
 *   AND FOR ALL lists and strings, the scanner flags a string exactly when, after NFKC and case folding, one of the
 *   list's words stands in it as a whole word, so it flags no string that holds none of them (a word inside a longer
 *   word does not count).
 * The lists are generated here; the real Denied_List is a data file of its own, read by property 8.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deniedWordsIn, foldText, holdsDeniedWord } from "./taste-scanner";

const RUNS = { numRuns: 1000 };

const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789éÉßøÅñ".split("");
const piece = fc.array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 6 }).map((a) => a.join(""));
/** One word of a list entry: letters, sometimes joined inside by a mark a brand might carry ("A&B", "x-y", "o'k"). */
const token = fc.tuple(piece, fc.option(fc.tuple(fc.constantFrom("&", "-", "'", "."), piece), { nil: undefined })).map(([a, b]) => (b === undefined ? a : a + b[0] + b[1]));
/** A list entry: one to three words with one space between them. */
const entry = fc.array(token, { minLength: 1, maxLength: 3 }).map((ws) => ws.join(" "));

/** ASCII letters and digits as their fullwidth forms, which NFKC folds back. */
const fullwidth = (s: string) => s.replace(/[A-Za-z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
const variant = fc.constantFrom<(w: string) => string>(
  (w) => w,
  (w) => w.toUpperCase(),
  (w) => w.toLowerCase(),
  fullwidth,
  (w) => w.replace(/ /g, "\n"),
  (w) => w.replace(/ /g, "  \t"),
);
/** What may stand on either side of a word without joining it. */
const edge = fc.constantFrom(" ", "\n", ", ", ". ", "(", ")", "\"", "!", " - ");

describe("taste scanner: every denied word is caught", () => {
  it("flags any string with a denied word inserted on a word boundary", () => {
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 5 }), fc.nat(), fc.string({ maxLength: 60 }), fc.nat(), variant, edge, edge, (list, pick, s, i, v, left, right) => {
        const w = list[pick % list.length]!;
        const at = i % (s.length + 1);
        const text = s.slice(0, at) + left + v(w) + right + s.slice(at);
        expect(holdsDeniedWord(text, list)).toBe(true);
        expect(deniedWordsIn(text, list)).toContain(w);
      }),
      RUNS,
    );
  });

  it("flags a word at the very start or end of a string", () => {
    fc.assert(
      fc.property(entry, fc.string({ maxLength: 30 }), variant, (w, s, v) => {
        expect(holdsDeniedWord(`${v(w)} ${s}`, [w])).toBe(true);
        expect(holdsDeniedWord(`${s} ${v(w)}`, [w])).toBe(true);
        expect(holdsDeniedWord(v(w), [w])).toBe(true);
      }),
      RUNS,
    );
  });
});

/** A small alphabet, so generated lists and strings meet often, with separators that are never part of a word. */
const small = fc.array(fc.constantFrom("a", "b", "A", "B"), { minLength: 1, maxLength: 3 }).map((a) => a.join(""));
const sep = fc.constantFrom(" ", ",", "-", ".", "\n", "!", "'", "&");
const smallText = fc.array(fc.tuple(small, sep), { maxLength: 8 }).map((ps) => ps.map(([w, s]) => w + s).join(""));

/** The oracle: the string's whole words, after folding, as a set. */
const wordsOf = (s: string) => new Set(foldText(s).split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w !== ""));

describe("taste scanner: nothing else is caught", () => {
  it("flags a string exactly when a one-word entry stands in it as a whole word", () => {
    fc.assert(
      fc.property(fc.array(small, { minLength: 1, maxLength: 4 }), smallText, (list, text) => {
        const words = wordsOf(text);
        const expected = list.filter((w) => words.has(foldText(w)));
        expect(holdsDeniedWord(text, list)).toBe(expected.length > 0);
        expect(deniedWordsIn(text, list).sort()).toEqual([...new Set(expected)].sort());
      }),
      RUNS,
    );
  });

  it("flags no string drawn from letters no denied word uses", () => {
    const own = fc.array(fc.constantFrom(..."abcdefghijklm".split("")), { minLength: 1, maxLength: 6 }).map((a) => a.join(""));
    const other = fc.array(fc.constantFrom(..."nopqrstuvwxyz ,.!\n".split("")), { maxLength: 80 }).map((a) => a.join(""));
    fc.assert(
      fc.property(fc.array(own, { minLength: 1, maxLength: 5 }), other, (list, text) => {
        expect(holdsDeniedWord(text, list)).toBe(false);
        expect(deniedWordsIn(text, list)).toEqual([]);
      }),
      RUNS,
    );
  });

  it("never matches an empty or blank entry", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.constantFrom("", " ", "\n\t", "　"), (text, blank) => {
        expect(holdsDeniedWord(text, [blank])).toBe(false);
      }),
      RUNS,
    );
  });
});
