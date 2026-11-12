/**
 * Nothing ineligible is shown (brief 020; contracts §6 GET /api/memory, KC06, KC09). 1,000 runs.
 *   FOR ALL store contents and audiences, every row that `snapshot()` (each page), the readout, the `item` view or
 *   the `why` view returns passes `spokenGrade` (and so the one `eligible` function) under the caller's audience,
 *   is at or under that audience's ceiling, and is never forgotten (below the current epoch), blocked or wrong.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { docRef } from "./eligible";
import { type ViewRow, itemView, readout, shownCeiling, snapshot, whyView } from "./memory-views";
import { spokenGrade } from "./spoken";
import { STORE_EPOCH, buildStore, storeCase } from "./testing/memory-store-arb";

const RANK = { S0: 0, S1: 1, S2: 2 } as const;

describe("memory views: nothing ineligible is shown", () => {
  it("returns only eligible, spoken-grade rows under the audience ceiling, never forgotten, blocked or wrong", () => {
    fc.assert(
      fc.property(storeCase(), (k) => {
        const s = buildStore(k);
        const byId = new Map<string, ViewRow>(s.rows.map((r) => [r.id, r]));
        const check = (id: string) => {
          const r = byId.get(id);
          expect(r, `unknown row ${id}`).toBeDefined();
          const m = r!.memory;
          expect(spokenGrade({ ref: docRef("memories", r!.id, m.rev), row: m }, s.ctx.ec, s.snapshot).allow, `row ${id} not spoken-grade`).toBe(true);
          expect(RANK[m.sens] <= RANK[shownCeiling(k.audience)]).toBe(true);
          expect(["wrong", "blocked", "retracted"]).not.toContain(m.status);
          expect(m.epoch).toBe(STORE_EPOCH);
        };
        let cursor: string | null = null;
        for (let page = 0; page < 10; page++) {
          const view = snapshot(s.rows, s.ctx, cursor as never);
          expect(view).not.toBeNull();
          for (const c of view!.cards) check(c.id);
          for (const w of view!.overview.recentTold) check(w.noteId);
          cursor = view!.cursor;
          if (cursor === null) break;
        }
        for (const l of readout(s.rows, s.ctx).lines) check(l.id);
        for (const r of s.rows) {
          for (const item of itemView(s.rows, r.id, s.ctx)) check(item.id);
          for (const item of whyView(s.rows, s.evidence, r.id, s.ctx)) if (item.kind === "memory") check(item.id);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
