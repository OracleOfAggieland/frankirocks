// Brief 043, finding 4: the closed lists that say which way a rename goes.
import { describe, expect, it } from "vitest";
import { NAME_ASSERTERS, NAME_NEGATORS, renameRefuted } from "./rename-words";

describe("renameRefuted", () => {
  it("holds the closed lists", () => {
    expect(NAME_NEGATORS).toContain("not");
    expect(NAME_ASSERTERS).toContain("name is");
  });
  it("refuses a new name the span negates, or an old name it asserts", () => {
    expect(renameRefuted("No, that's wrong, her name is Mara, not Maya", "Mara", "Maya")).toBe(true);
    expect(renameRefuted("Her name isn't Maya, it's Mara", "Mara", "Maya")).toBe(true);
    expect(renameRefuted("She's called Mara", "Mara", "Maya")).toBe(true);
  });
  it("lets the owner's own direction through", () => {
    expect(renameRefuted("No, that's wrong, her name is Mara, not Maya", "Maya", "Mara")).toBe(false);
    expect(renameRefuted("No, her name is Mara", "Maya", "Mara")).toBe(false);
    expect(renameRefuted("Not Maya, Mara", "Maya", "Mara")).toBe(false);
  });
});
