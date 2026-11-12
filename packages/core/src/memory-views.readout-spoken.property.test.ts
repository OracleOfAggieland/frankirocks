/**
 * The readout is spoken-grade (brief 020; spec §15 "What do you know about me?"; contracts §6 snapshot: "Voice cards
 * spokenGrade"). 1,000 runs.
 *   FOR ALL memory sets and audiences, every line `snapshot()` returns (cards and recent told lines) and every line
 *   of the readout passes `spokenGrade`, is at or under the audience's ceiling, and its text is the row's own
 *   stored line: nothing new is said. Recent told lines come from told rows (class U or C) only.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { docRef } from "./eligible";
import { type ViewRow, readout, shownCeiling, snapshot } from "./memory-views";
import { recallLineText } from "./recall";
import { spokenGrade } from "./spoken";
import { buildStore, storeCase } from "./testing/memory-store-arb";

const RANK = { S0: 0, S1: 1, S2: 2 } as const;

describe("memory views: the readout is spoken-grade", () => {
  it("says only spoken-grade lines, each the row's own stored line", () => {
    fc.assert(
      fc.property(storeCase(), (k) => {
        const s = buildStore(k);
        const byId = new Map<string, ViewRow>(s.rows.map((r) => [r.id, r]));
        const grade = (id: string, text: string) => {
          const r = byId.get(id);
          expect(r).toBeDefined();
          expect(spokenGrade({ ref: docRef("memories", id, r!.memory.rev), row: r!.memory }, s.ctx.ec, s.snapshot).allow).toBe(true);
          expect(RANK[r!.memory.sens] <= RANK[shownCeiling(k.audience)]).toBe(true);
          expect(text).toBe(recallLineText(r!.memory));
        };
        const view = snapshot(s.rows, s.ctx, null)!;
        for (const c of view.cards) {
          expect(c.lines.length).toBeGreaterThan(0);
          for (const line of c.lines) grade(c.id, line);
        }
        for (const w of view.overview.recentTold) {
          grade(w.noteId, w.text);
          expect(["U", "C"]).toContain(byId.get(w.noteId)!.memory.sourceClass);
        }
        for (const l of readout(s.rows, s.ctx).lines) grade(l.id, l.text);
      }),
      { numRuns: 1000 },
    );
  });
});
