import { describe, expect, it } from "vitest";
import { OTHER_PERSON_WORDS, namesAnother } from "./allergy-subject";
import { ENTITIES, KNOWN } from "./testing/arb-writes";

describe("namesAnother (W-231)", () => {
  it("the closed list holds third-person and group words, not the item's pointers", () => {
    for (const w of ["he", "she", "they", "we", "our"]) expect(OTHER_PERSON_WORDS.has(w)).toBe(true);
    for (const w of ["it", "that", "them", "i", "my"]) expect(OTHER_PERSON_WORDS.has(w)).toBe(false);
  });
  it("reads pronouns, relation words and known names, by their stem", () => {
    for (const t of ["He's allergic to it", "My brother is allergic", "Maya is allergic", "We're allergic", "my friend's kid"]) expect(namesAnother(t, KNOWN, ENTITIES), t).toBe(true);
  });
  it("a first-person statement names no one else", () => {
    for (const t of ["I'm allergic to peanuts", "Yes, I am allergic to them", "Allergic to it"]) expect(namesAnother(t, KNOWN, ENTITIES), t).toBe(false);
  });
});
