// Property (brief 051, ui.xray): off always means dark, with no camera open.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { XRAY_OFF_VIEW } from "./types";
import { moveArb, run } from "./testing/xray-arbitraries";
import { xrayView } from "./xray-machine";

describe("ui.xray property", () => {
  it("is dark with no camera open whenever it is off", () => {
    fc.assert(
      fc.property(fc.array(moveArb, { maxLength: 40 }), (moves) => {
        for (const s of run(moves)) {
          if (s.power !== "off") continue;
          expect({ signal: s.signal, cameraOpen: s.cameraOpen }).toEqual({ signal: "dark", cameraOpen: false });
          expect(xrayView(s)).toEqual(XRAY_OFF_VIEW);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
