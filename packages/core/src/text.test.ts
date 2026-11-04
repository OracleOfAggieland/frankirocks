import { describe, expect, it } from "vitest";
import { checkRange, isWellFormed, normalizeLF, splitsSurrogate, textAt, tokenize } from "./text";

describe("normalizeLF", () => {
  it("CRLF and lone CR to LF", () => {
    expect(normalizeLF("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(normalizeLF("\r\r\n\n")).toBe("\n\n\n");
    expect(normalizeLF("no breaks")).toBe("no breaks");
  });
  it("leaves no CR behind", () => expect(normalizeLF("x\r\n\r\ry\r")).not.toContain("\r"));
});

describe("ranges", () => {
  const dog = "my 🐶 Pip"; // 🐶 is two code units at offsets 3 and 4
  it("surrogate split rejected", () => {
    expect(splitsSurrogate(dog, 4)).toBe(true);
    expect(checkRange(dog, 0, 4)).toBe("surrogateSplit");
    expect(checkRange(dog, 4, 6)).toBe("surrogateSplit");
    expect(textAt(dog, 0, 4)).toBeNull();
  });
  it("whole surrogate pairs pass", () => {
    expect(checkRange(dog, 3, 5)).toBeNull();
    expect(textAt(dog, 3, 5)).toBe("🐶");
  });
  it("out of range and reversed", () => {
    expect(checkRange(dog, 0, dog.length + 1)).toBe("outOfRange");
    expect(checkRange(dog, -1, 2)).toBe("outOfRange");
    expect(checkRange(dog, 3, 2)).toBe("reversed");
    expect(checkRange(dog, 0, dog.length)).toBeNull();
  });
  it("isWellFormed finds lone surrogates", () => {
    expect(isWellFormed(dog)).toBe(true);
    expect(isWellFormed("a\ud83d")).toBe(false);
    expect(isWellFormed("\udc36b")).toBe(false);
  });
});

describe("tokenize", () => {
  it("NFKC, lowercase, letter and digit runs", () => {
    expect(tokenize("My dog's name is PIP-2!")).toEqual(["my", "dog", "s", "name", "is", "pip", "2"]);
    expect(tokenize("ﬁne Ｃafé")).toEqual(["fine", "café"]);
  });
});
