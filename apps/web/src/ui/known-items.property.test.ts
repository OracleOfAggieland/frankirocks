import type { InspectItem, SnapshotView } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { knownItems } from "./known-items";

// Brief 027, property "The sheet shows only what the route returned".
const ids = fc.constantFrom("a", "b", "c", "d", "e").map((x) => x.repeat(43));
const text = fc.string({ maxLength: 12 });

const card = fc.record({ id: ids, title: text, lines: fc.array(text, { maxLength: 3 }) }).map((c) => ({ ...c, kind: "memory" as const, sources: [], sens: "S0" as const }));
const page = fc.array(card, { maxLength: 5 }).map(
  (cards): SnapshotView => ({ cards, overview: { topics: [], guesses: 0, heldPrivate: 0, recentTold: [] }, coverage: { state: "complete", from: null, to: null, missingRanges: [], generation: 0 }, truncated: false, cursor: null }) as SnapshotView,
);
// A label never holds the separator the sheet joins labels with: the check below splits on it (seed 546194484 drew the label ", ").
const label = text.filter((t) => !t.includes(", "));
const item = fc.record({ id: ids, kind: fc.constantFrom("memory" as const, "evidence" as const), label, body: text }).map((i): InspectItem => ({ ...i, status: "active", refs: [] }));
const whys = fc.array(fc.tuple(ids, fc.option(fc.array(item, { maxLength: 4 }), { nil: null })), { maxLength: 6 }).map((e) => new Map(e));

describe("Property: the sheet shows only what the route returned", () => {
  it("every row is a card the overview returned, with its words, and a source the why view returned or none", () => {
    fc.assert(
      fc.property(fc.array(page, { maxLength: 3 }), whys, (pages, why) => {
        const cards = new Map<string, { title: string; lines: string[] }[]>();
        for (const p of pages) for (const c of p.cards) cards.set(c.id, [...(cards.get(c.id) ?? []), c]);
        const rows = knownItems(pages, why);
        expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
        for (const r of rows) {
          const from = cards.get(r.id);
          expect(from, r.id).toBeDefined();
          expect(from!.some((c) => c.title === r.text || c.lines.includes(r.text))).toBe(true);
          const answered = why.get(r.id);
          if (answered !== undefined && answered !== null) {
            // A why answer without the row means the route no longer shows it.
            expect(answered.some((i) => i.id === r.id && i.kind === "memory")).toBe(true);
            const labels = answered.filter((i) => i.kind === "evidence").map((i) => i.label);
            expect(r.from === COPY.sheetData.fromUnknown || r.from.split(", ").every((l) => labels.includes(l))).toBe(true);
          } else {
            expect(r.from).toBe(COPY.sheetData.fromUnknown);
          }
          expect(r.guessed).toBe(false);
          expect(r.hardRule).toBe(false);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
