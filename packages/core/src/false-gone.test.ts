import { describe, expect, it } from "vitest";
import { claimsGone, falseGone } from "./false-gone";

describe("false gone check", () => {
  it.each(["Gone.", "I forgot that.", "It's deleted now", "Removed it from what I know", "That's been forgotten", "ERASED"])("claims gone: %s", (t) => {
    expect(claimsGone(t)).toBe(true);
  });
  it.each(["Want me to forget it?", "I can remove that if you like", "Going to the store", "Goner", "", "Your list is ready"])("does not claim gone: %s", (t) => {
    expect(claimsGone(t)).toBe(false);
  });
  it("asks only when a line claims gone and the turn has no receipt", () => {
    expect(falseGone(["Gone."], null)).toBe(true);
    expect(falseGone(["Gone."], "r1")).toBe(false);
    expect(falseGone(["Hello", "Sure thing"], null)).toBe(false);
    expect(falseGone([], null)).toBe(false);
  });
});
