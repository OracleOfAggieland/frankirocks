// Property (brief 051, ui.xray): from any off state, two presses end off, with no camera open.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { moveArb, run } from "./testing/xray-arbitraries";
import { xrayStep } from "./xray-machine";

describe("ui.xray property", () => {
  it("press, press from off: off", () => {
    fc.assert(
      fc.property(fc.array(moveArb, { maxLength: 40 }), (moves) => {
        for (const s of run(moves)) {
          if (s.power !== "off") continue;
          const after = xrayStep(xrayStep(s, { kind: "press" }).state, { kind: "press" }).state;
          expect({ power: after.power, signal: after.signal, cameraOpen: after.cameraOpen }).toEqual({ power: "off", signal: "dark", cameraOpen: false });
        }
      }),
      { numRuns: 1000 },
    );
  });
});
