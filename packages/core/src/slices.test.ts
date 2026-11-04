import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJSON, type Hasher, idParts, isIdShape } from "./ids";
import { gravityFloor, maxSens, sensFloor } from "./lexicon";
import { buildSlice, classifyTyped, sliceHashInput, sliceHashMatches, turnTextSlice } from "./slices";

const hasher: Hasher = {
  id: (parts) => createHash("sha256").update(canonicalJSON(parts)).digest("base64url"),
  sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
};
const EID = "e".repeat(43);

describe("classifyTyped", () => {
  it("short single-line text is ordinary U", () => expect(classifyTyped("My dog is called Pip")).toEqual({ kind: "ordinary", class: "U" }));
  it.each([
    ["over 280 units", "x".repeat(281)],
    ["LF", "line one\nline two"],
    ["CR", "line one\rline two"],
    ["From:", "From: someone"],
    ["Subject:", "Subject: hello"],
    ["URL", "see https://example.com/x"],
    ["www URL", "see www.example.com"],
  ])("pasted T when %s", (_why, text) => expect(classifyTyped(text)).toEqual({ kind: "pasted", class: "T" }));
  it("exactly 280 units is ordinary", () => expect(classifyTyped("x".repeat(280)).kind).toBe("ordinary"));
});

describe("slices", () => {
  it("hashes the UTF-8 bytes of the range", () => {
    const s = buildSlice({ eid: EID, fieldPath: "text", fieldText: "héllo world", start: 0, end: 5, class: "U", sens: "S0" }, hasher);
    expect(s.contentHash).toBe(createHash("sha256").update("héllo", "utf8").digest("hex"));
    expect(sliceHashMatches(s, "héllo world", hasher)).toBe(true);
    expect(sliceHashMatches(s, "hello world", hasher)).toBe(false);
  });
  it("rejects a surrogate split and un-normalized text before hashing", () => {
    expect(sliceHashInput("a🐶", 0, 2)).toEqual({ ok: false, error: "surrogateSplit" });
    expect(sliceHashInput("a\r\nb", 0, 1)).toEqual({ ok: false, error: "notNormalized" });
    expect(() => buildSlice({ eid: EID, fieldPath: "text", fieldText: "a🐶", start: 0, end: 2, class: "U", sens: "S0" }, hasher)).toThrow();
  });
  it("turn text slice covers the whole text with the lexicon floor", () => {
    const s = turnTextSlice(EID, "My boss called", "U", hasher);
    expect(s).toMatchObject({ fieldPath: "text", start: 0, end: 14, class: "U", sens: "S1" });
  });
});

describe("lexicon floors", () => {
  it("sensitivity", () => {
    expect(sensFloor("My dog is called Pip")).toBe("S0");
    expect(sensFloor("I have a job interview")).toBe("S1");
    expect(sensFloor("My mom has cancer")).toBe("S2");
    expect(maxSens("S1", "S0")).toBe("S1");
    expect(maxSens("S0", "S2")).toBe("S2");
  });
  it("gravity", () => {
    expect(gravityFloor("lunch was fine")).toBe(0);
    expect(gravityFloor("she had surgery")).toBe(2);
    expect(gravityFloor("he died last week")).toBe(3);
  });
});

describe("ids", () => {
  it("canonicalJSON sorts keys and rejects non-finite numbers", () => {
    expect(canonicalJSON({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(() => canonicalJSON({ a: Number.NaN })).toThrow();
    expect(() => canonicalJSON({ a: undefined })).toThrow();
  });
  it("id parts follow the design table", () => {
    expect(idParts.session("u", "r")).toEqual(["session", "u", "r"]);
    expect(idParts.evidence("log", 1)).toEqual(["log", 1]);
    expect(idParts.extractJob("eid")).toEqual(["job", "extract", "eid"]);
  });
  it("isIdShape", () => {
    expect(isIdShape("a".repeat(43))).toBe(true);
    expect(isIdShape("a".repeat(42))).toBe(false);
    expect(isIdShape(`${"a".repeat(42)}+`)).toBe(false);
  });
});
