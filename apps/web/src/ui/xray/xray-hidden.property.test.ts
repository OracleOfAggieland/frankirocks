// Property (brief 051, ui.xray): after the tab is hidden, no camera is open and none is asked for, whatever came before.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { moveArb, run } from "./testing/xray-arbitraries";
import { xrayStep } from "./xray-machine";

describe("ui.xray property", () => {
  it("leaves no camera open after hidden", () => {
    fc.assert(
      fc.property(fc.array(moveArb, { maxLength: 40 }), (moves) => {
        for (const s of run(moves)) {
          const { state, commands } = xrayStep(s, { kind: "hidden" });
          expect(state.cameraOpen).toBe(false);
          expect(commands.some((c) => c.kind === "openCamera")).toBe(false);
          if (s.cameraOpen) expect(commands.some((c) => c.kind === "stopCamera")).toBe(true);
          if (s.power === "on" && (s.cameraOpen || s.signal === "asking")) expect(state.signal).toBe("paused");
        }
      }),
      { numRuns: 1000 },
    );
  });
});
