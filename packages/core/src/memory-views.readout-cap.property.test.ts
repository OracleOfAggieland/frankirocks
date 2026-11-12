/**
 * The readout's cap holds (brief 020; spec §11 last paragraph: the floor reads all lines "capped at 200"; contracts
 * §6 snapshot "Page50/floor200"). 1,000 runs.
 *   FOR ALL memory sets of 120 to 260 rows, the readout never returns more than 200 lines, never repeats a row, every
 *   `snapshot()` page holds at most 50 cards, and the readout is marked truncated exactly when more rows were
 *   shown-eligible than it returned.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { READOUT_MAX_LINES, SNAPSHOT_PAGE, readout, shown, snapshot } from "./memory-views";
import { buildStore, memoryCase, storeCase } from "./testing/memory-store-arb";

/** Mostly showable rows, so the cap is reached often. */
const showable = memoryCase.map((m) => ({ ...m, status: "active" as const, sourceClass: "U" as const, sens: "S0" as const, flow: "open" as const, forgotten: false, dirty: false }));

describe("memory views: the readout cap", () => {
  it("never returns more than 200 lines", () => {
    fc.assert(
      fc.property(
        storeCase(0),
        fc.array(fc.oneof({ weight: 4, arbitrary: showable }, { weight: 1, arbitrary: memoryCase }), { minLength: 120, maxLength: 260 }),
        (base, memories) => {
          const s = buildStore({ ...base, memories, evidence: base.evidence.map((e) => ({ ...e, status: "retained" as const })) });
          const r = readout(s.rows, s.ctx);
          expect(READOUT_MAX_LINES).toBe(200);
          expect(r.lines.length).toBeLessThanOrEqual(200);
          expect(new Set(r.lines.map((l) => l.id)).size).toBe(r.lines.length);
          const eligibleCount = s.rows.filter((row) => shown(row, s.ctx)).length;
          expect(r.truncated).toBe(eligibleCount > r.lines.length);
          expect(snapshot(s.rows, s.ctx, null)!.cards.length).toBeLessThanOrEqual(SNAPSHOT_PAGE);
        },
      ),
      { numRuns: 1000 },
    );
    // Each run builds and validates a store of 120 to 260 rows: about 20 ms a run.
  }, 120_000);
});
