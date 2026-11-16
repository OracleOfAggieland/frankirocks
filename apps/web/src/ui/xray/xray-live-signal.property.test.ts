// Property (brief 051, ui.xray): warming, searching and seeing only ever hold while a camera is open.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { moveArb, run } from "./testing/xray-arbitraries";

const LIVE = new Set(["warming", "searching", "seeing"]);

describe("ui.xray property", () => {
  it("shows a live signal only with a camera open", () => {
    fc.assert(
      fc.property(fc.array(moveArb, { maxLength: 40 }), (moves) => {
        for (const s of run(moves)) if (LIVE.has(s.signal)) expect(s.cameraOpen).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});
