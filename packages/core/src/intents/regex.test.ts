import { describe, expect, it } from "vitest";
import { REGEX_TABLE, normalizeForRegex, regexMatch } from "./regex";

describe("Regex_Table", () => {
  it.each([
    ["RX1", ["please forget that", "delete it", "erase the note", "unsave this"]],
    ["RX2", ["this is between us", "off the record", "keep that private", "stop mentioning it"]],
    ["RX3", ["you're on speaker", "my aunt walked in", "they can hear you"]],
    ["RX4", ["a nut allergy", "allergic to cats", "anaphylactic shock", "my epipen", "celiac", "lactose intolerant"]],
    ["RX5", ["suicidal thoughts", "i feel hopeless", "a panic attack", "i can't breathe", "self-harm"]],
    ["RX6", ["that's wrong", "i meant tuesday", "not what i said"]],
    ["RX7", ["she passed away", "he died", "diagnosed last week", "we broke up", "getting divorced", "laid off"]],
  ])("%s matches its cue words", (id, lines) => {
    for (const l of lines) expect(regexMatch(l)).toContain(id);
  });

  it("normalizes case, curly apostrophes and spacing", () => {
    expect(normalizeForRegex("  That\u2019S   WRONG ")).toBe("that's wrong");
    expect(regexMatch("THAT\u2019S WRONG")).toEqual(["RX6"]);
  });

  it("near misses don't match RX1", () => {
    for (const l of ["I forgot my umbrella", "she forgets", "I keep forgetting", "I deleted a game"]) expect(regexMatch(l)).not.toContain("RX1");
  });

  it("returns IDs only, in table order, and nothing for ordinary talk", () => {
    expect(regexMatch("I'm hopeless, please forget it")).toEqual(["RX1", "RX5"]);
    expect(regexMatch("What's your favourite season?")).toEqual([]);
    expect(REGEX_TABLE.map((r) => r.id)).toEqual(["RX1", "RX2", "RX3", "RX4", "RX5", "RX6", "RX7"]);
  });
});
