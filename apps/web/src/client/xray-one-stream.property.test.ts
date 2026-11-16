// Property (brief 051, the X-ray store): with camera answers arriving in any order and at any time, never more
// than one camera stream is live.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { act, xrayActionArb, xrayHarness } from "./testing/xray-fakes";

describe("xray store property", () => {
  it("never holds two live streams", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(xrayActionArb, { maxLength: 40, size: "max" }), async (actions) => {
        const h = xrayHarness();
        for (const a of actions) {
          await act(h, a);
          expect(h.camera.liveCount()).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
