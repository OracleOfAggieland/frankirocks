// Property (brief 047, ui.radio): from any off state, two presses leave the radio on with the panel closed.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { radioStep } from "./radio-machine";
import { moveArb, run, stationsArb } from "./testing/radio-arbitraries";

const pick = fc.double({ min: 0, max: 1, noNaN: true });

describe("ui.radio property", () => {
  it("press, press from off: on, panel closed", () => {
    fc.assert(
      fc.property(stationsArb(1), fc.array(moveArb, { maxLength: 40 }), pick, pick, (stations, moves, p1, p2) => {
        for (const s of run(moves, stations)) {
          if (s.power !== "off") continue;
          const after = radioStep(radioStep(s, { kind: "press", pick: p1 }, stations), { kind: "press", pick: p2 }, stations);
          expect({ power: after.power, panel: after.panel }).toEqual({ power: "on", panel: "closed" });
        }
      }),
      { numRuns: 1000 },
    );
  });
});
