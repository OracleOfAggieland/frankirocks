// Property (brief 047, ui.radio): the owner's volume stays a number from 0 to 1, whatever setVolume is given.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { moveArb, run, stationsArb } from "./testing/radio-arbitraries";

describe("ui.radio property", () => {
  it("keeps the volume in 0 to 1", () => {
    fc.assert(
      fc.property(stationsArb(), fc.array(moveArb, { maxLength: 40 }), (stations, moves) => {
        for (const s of run(moves, stations)) {
          expect(Number.isFinite(s.volume)).toBe(true);
          expect(s.volume).toBeGreaterThanOrEqual(0);
          expect(s.volume).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
