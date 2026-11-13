// Property (brief 047, ui.radio): the station is always null or one of the list's own stations.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { moveArb, run, stationsArb } from "./testing/radio-arbitraries";

describe("ui.radio property", () => {
  it("never holds a station that is not in the list", () => {
    fc.assert(
      fc.property(stationsArb(), fc.array(moveArb, { maxLength: 40 }), (stations, moves) => {
        const ids = new Set(stations.map((x) => x.id));
        for (const s of run(moves, stations)) {
          if (s.stationId !== null) expect(ids.has(s.stationId)).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
