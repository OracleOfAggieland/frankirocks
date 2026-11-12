import { describe, expect, it } from "vitest";
import { sanitizeText, sentenceRanges } from "./sanitize";

describe("sanitizeText (spec §8 step 5)", () => {
  it("drops the whole sentence holding a removed range, so its condition can't vanish", () => {
    const text = "I'm moving to Austin unless my brother relapses. Work was long.";
    const at = text.indexOf("my brother relapses");
    const out = sanitizeText(text, [{ start: at, end: at + "my brother relapses".length }], []);
    expect(out.text).toBe("Work was long.");
    expect(out.droppedSentences).toBe(1);
  });

  it("keeps a verified rule span out of a dropped sentence, and only when it is disjoint", () => {
    const text = "I'm allergic to shellfish and Danny relapsed.";
    const danny = text.indexOf("Danny relapsed");
    const rule = { start: 0, end: "I'm allergic to shellfish".length };
    expect(sanitizeText(text, [{ start: danny, end: danny + 14 }], [rule]).text).toBe("I'm allergic to shellfish");
    expect(sanitizeText(text, [{ start: 4, end: 12 }], [rule]).text).toBe("");
  });

  it("splits at sentence ends and line breaks, and never splits a surrogate pair", () => {
    expect(sentenceRanges("One. Two!\nThree? v1.2 stays")).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
      { start: 10, end: 16 },
      { start: 17, end: 27 },
    ]);
    const text = "Dog \u{1F436} here. Fine.";
    const out = sanitizeText(text, [{ start: 5, end: 6 }], []);
    expect(out.text).toBe("Fine.");
  });
});
