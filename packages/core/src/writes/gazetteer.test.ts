// The allergen gazetteer's unit witnesses (design 2.1).
import { describe, expect, it } from "vitest";
import { GAZETTEER, GAZETTEER_VERSION, gazetteerEntry, lookupAllergen, normalizeAllergenText, scanAliases } from "./gazetteer";
import { ORACLE_GAZETTEER } from "./testing/gazetteer-oracle";

describe("the allergen gazetteer", () => {
  it("is version gz1, with unique IDs of at most 64 characters and labels of at most 40", () => {
    expect(GAZETTEER_VERSION).toBe("gz1");
    const ids = GAZETTEER.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of GAZETTEER) {
      expect(e.id.length).toBeLessThanOrEqual(64);
      expect(e.label.length).toBeLessThanOrEqual(40);
      expect(e.aliases.length).toBeGreaterThan(0);
    }
  });

  it("maps no alias to two IDs, and every alias is in normal form", () => {
    const owner = new Map<string, string>();
    for (const e of GAZETTEER) {
      for (const a of e.aliases) {
        expect(owner.get(a), `alias "${a}" of ${e.id}`).toBeUndefined();
        owner.set(a, e.id);
        expect(normalizeAllergenText(a), a).toBe(a);
      }
    }
  });

  it("names only existing IDs in includes, with no cycle", () => {
    const visit = (id: string, path: string[]): void => {
      expect(path, `cycle through ${id}`).not.toContain(id);
      const e = gazetteerEntry(id);
      expect(e, `includes names ${id}`).not.toBeNull();
      for (const c of e!.includes) visit(c, [...path, id]);
    };
    for (const e of GAZETTEER) visit(e.id, []);
  });

  it("is the table of the design note, entry for entry", () => {
    expect(Object.fromEntries(GAZETTEER.map((e) => [e.id, { domain: e.domain, aliases: [...e.aliases] }]))).toEqual(ORACLE_GAZETTEER);
  });

  it("matches nothing in jokes and everyday words", () => {
    for (const t of ["Mondays", "my boss", "work", "I'm allergic to Mondays."]) expect(lookupAllergen(t), t).toEqual([]);
    expect(scanAliases("nothing new there")).toEqual([]);
  });

  it("lets the longer alias win, and keeps every code the owner named", () => {
    expect(lookupAllergen("cashew nuts")).toEqual(["cashew"]);
    expect(lookupAllergen("nuts, especially cashews")).toEqual(["nuts", "cashew"]);
    expect(lookupAllergen("nuts and peanuts")).toEqual(["nuts", "peanut"]);
    expect(lookupAllergen("shellfish, mostly shrimp")).toEqual(["shellfish", "shrimp"]);
    expect(lookupAllergen("gluten and wheat")).toEqual(["gluten", "wheat"]);
    expect(lookupAllergen("shell fish")).toEqual(["shellfish"]);
    expect(lookupAllergen("cray fish")).toEqual(["crayfish"]);
    expect(lookupAllergen("pea nuts")).toEqual(["peanut"]);
    expect(lookupAllergen("peanut")).toEqual(["peanut"]);
    expect(lookupAllergen("peanut butter")).toEqual(["peanut"]);
    expect(lookupAllergen("tree-nuts")).toEqual(["tree_nut"]);
    expect(lookupAllergen("Shrimp’s shells")).toEqual(["shrimp"]);
  });

  it("gives none only from lookupAllergen, never from scanAliases", () => {
    expect(lookupAllergen("any allergies")).toEqual(["none"]);
    expect(lookupAllergen("nothing")).toEqual(["none"]);
    expect(scanAliases("I'm not allergic to anything")).toEqual([]);
  });

  it("gives offsets on the caller's own text, inside the range asked", () => {
    const text = "Café first. I'm allergic to Tree-Nuts and shell fish!";
    const found = scanAliases(text);
    expect(found.map((f) => [f.code, text.slice(f.start, f.end)])).toEqual([
      ["tree_nut", "Tree-Nuts"],
      ["shellfish", "shell fish"],
    ]);
    expect(scanAliases(text, 0, 30).map((f) => f.code)).toEqual([]);
    expect(scanAliases(text, 28).map((f) => f.code)).toEqual(["tree_nut", "shellfish"]);
  });

  it("normalizes as the design says", () => {
    expect(normalizeAllergenText("  Tree-Nuts’s  and\tＭＩＬＫ ")).toBe("tree nuts and milk");
  });
});
