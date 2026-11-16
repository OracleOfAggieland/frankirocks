// Property (brief 051, the X-ray store): off means off. Whenever the view says off or paused, no camera stream is
// live, and the video element shows nothing; whenever a stream is live, the view says the camera is on.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { act, xrayActionArb, xrayHarness } from "./testing/xray-fakes";

describe("xray store property", () => {
  it("leaves no stream live while off or paused", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(xrayActionArb, { maxLength: 40, size: "max" }), async (actions) => {
        const h = xrayHarness();
        for (const a of actions) {
          await act(h, a);
          const v = h.watch.getSnapshot();
          if (v.power === "off" || v.signal === "paused") {
            expect(h.camera.liveCount()).toBe(0);
            expect(h.video.srcObject).toBeNull();
            expect(h.watch.feed.latest()).toBeNull();
          }
          if (h.camera.liveCount() > 0) expect(v.cameraOn).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
