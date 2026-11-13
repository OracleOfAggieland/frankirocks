// Property (brief 047, ui.radio, ruling 9): automatic hops never pass RADIO_MAX_HOPS.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RADIO_MAX_HOPS } from "./radio-machine";
import { moveArb, run, stationsArb } from "./testing/radio-arbitraries";

describe("ui.radio property", () => {
  it("hops at most three times", () => {
    fc.assert(
      fc.property(stationsArb(), fc.array(moveArb, { maxLength: 60 }), (stations, moves) => {
        for (const s of run(moves, stations)) expect(s.hops).toBeLessThanOrEqual(RADIO_MAX_HOPS);
      }),
      { numRuns: 1000 },
    );
  });
});
