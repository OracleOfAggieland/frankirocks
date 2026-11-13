// Property (brief 047, ui.radio): off always means silent, no station and the panel closed.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { moveArb, run, stationsArb } from "./testing/radio-arbitraries";

describe("ui.radio property", () => {
  it("is silent with the panel closed whenever it is off", () => {
    fc.assert(
      fc.property(stationsArb(), fc.array(moveArb, { maxLength: 40 }), (stations, moves) => {
        for (const s of run(moves, stations)) {
          if (s.power === "off") expect({ signal: s.signal, panel: s.panel, stationId: s.stationId }).toEqual({ signal: "silent", panel: "closed", stationId: null });
        }
      }),
      { numRuns: 1000 },
    );
  });
});
