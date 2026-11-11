// The generators and fixtures of the wave A properties are sound on their own: if one of these fails, a red
// property says nothing about the code under test.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolveLineage } from "../../lineage";
import { checkRange } from "../../text";
import type { Evidence } from "../../schema/records";
import { Slice, Span } from "../../schema/primitives";
import { validate } from "../../schema/v";
import { PRIOR, PRIOR_EID, TARGET_ROWS, TURN_AT, TURN_EID, buildEvidence, changeItem, clauseArb, compose, exactOn, hasher, itemChangeArb, itemInQuote, verified } from "./arb-writes";
import { aliasesIn, codeNamedIn, hasWholeWords, oracleNormal } from "./gazetteer-oracle";

describe("wave A fixtures", () => {
  it("the target rows resolve to the prior turn", () => {
    const evidence = new Map<string, Evidence>([[PRIOR_EID, PRIOR]]);
    for (const m of TARGET_ROWS) expect(resolveLineage({ memory: m, evidence, hasher }).ok).toBe(true);
  });

  it("the oracle reads whole words in normal form", () => {
    expect(oracleNormal("Tree-Nuts’s")).toBe("tree nuts");
    expect(hasWholeWords("I'm allergic to peanuts.", "peanuts")).toBe(true);
    expect(hasWholeWords("I'm allergic to peanuts.", "pea")).toBe(false);
    expect(hasWholeWords("No, her name is Mara", "nut")).toBe(false);
    expect(codeNamedIn("cashew", "cashew nuts")).toBe(true);
    expect(aliasesIn("I'm allergic to Mondays.")).toEqual([]);
  });

  it("careful items quote the composed text exactly, and allergy items hold their item", () => {
    fc.assert(
      fc.property(fc.array(clauseArb, { minLength: 1, maxLength: 5 }), (clauses) => {
        const { text, items } = compose(clauses);
        const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
        for (const s of e.fieldSlices) expect(validate(Slice, s).ok).toBe(true);
        for (const item of items) {
          expect(validate(Span, item.span).ok).toBe(true);
          expect(exactOn(item.span, text)).toBe(true);
          expect(verified(item.span, e)).toEqual(item.span);
          if (item.kind === "allergy") expect(itemInQuote(item.item, item.span.quote)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("changed items are well formed, and both faulty and clean ones are generated", () => {
    const seen = { clean: 0, faulty: 0 };
    fc.assert(
      fc.property(fc.array(clauseArb, { minLength: 1, maxLength: 5 }), fc.array(itemChangeArb, { minLength: 8, maxLength: 8 }), (clauses, changes) => {
        const { text, items } = compose(clauses);
        const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
        items.slice(0, 8).forEach((it, i) => {
          const c = changeItem(it, changes[i]!, text);
          expect(c.span.start).toBeGreaterThanOrEqual(0);
          expect(c.span.end).toBeGreaterThanOrEqual(c.span.start);
          const v = verified(c.span, e);
          const ok = v !== null && c.act === "direct" && (c.kind !== "allergy" || itemInQuote(c.item, v.quote));
          seen[ok ? "clean" : "faulty"]++;
        });
      }),
      { numRuns: 200 },
    );
    expect(seen.clean).toBeGreaterThan(50);
    expect(seen.faulty).toBeGreaterThan(50);
  });

  it("buildEvidence moves a cut that would split a surrogate pair to the next boundary", () => {
    const cases: [string, number[], number[]][] = [
      ["a\u{1F436}b", [2], [0, 3]],
      ["a\u{1F436}b", [1, 2], [0, 1, 3]],
      ["a\u{1F436}b", [2, 3], [0, 3]],
      ["a\u{1F436}b", [1, 2, 3], [0, 1, 3]],
      ["a\u{1F436}", [2], [0]],
      ["ab", [1], [0, 1]],
    ];
    for (const [text, cuts, starts] of cases) {
      const e = buildEvidence(TURN_EID, text, cuts, ["U", "T", "U", "T"], TURN_AT);
      for (const s of e.fieldSlices) expect(checkRange(text, s.start!, s.end!)).toBeNull();
      expect(e.fieldSlices.map((s) => s.start)).toEqual(starts);
      expect(e.fieldSlices.at(-1)!.end).toBe(text.length);
    }
  });
});
