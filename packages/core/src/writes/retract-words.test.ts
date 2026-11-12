// Brief 043, finding 5: the closed list that lets a null replacement retract.
import { describe, expect, it } from "vitest";
import { RETRACT_NEGATIONS, RETRACT_REACH, retractionSaid } from "./retract-words";

describe("retractionSaid", () => {
  it("holds the closed list", () => {
    expect([...RETRACT_NEGATIONS]).toContain("not");
    expect(RETRACT_REACH).toBe(3);
  });
  it("a negation tied to the value or the name", () => {
    expect(retractionSaid("I don't have a sister named Maya, that was wrong", ["sister"])).toBe(true);
    expect(retractionSaid("Maya isn't my sister", ["sister", "Maya"])).toBe(true);
    expect(retractionSaid("She's not my sister", ["sister"])).toBe(true);
  });
  it("no negation tied to it", () => {
    expect(retractionSaid("That's wrong, I meant my sister Maya is coming Saturday", ["sister", "Maya"])).toBe(false);
    expect(retractionSaid("That's not right, I meant my sister", ["sister"])).toBe(false);
    expect(retractionSaid("My sister is coming", ["sister"])).toBe(false);
  });
});
