// Property (brief 051, the X-ray store): a camera the browser hands over that the machine does not take (it came
// for an old session, after off, a flip, a retry or a hidden tab) is stopped before anything else happens: the next
// thing after its arrival is its stop, before any change is published. A stream that is taken is the one live stream
// and plays in the element.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { act, xrayActionArb, xrayHarness } from "./testing/xray-fakes";

describe("xray store property", () => {
  it("stops a late camera at once", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(xrayActionArb, { maxLength: 40, size: "max" }), async (actions) => {
        const h = xrayHarness();
        for (const a of actions) {
          const arrived = await act(h, a);
          if (arrived === null) continue;
          const i = h.camera.log.indexOf(`arrive ${arrived.id}`);
          if (arrived.live) {
            expect(h.watch.getSnapshot().cameraOn).toBe(true);
            expect(h.camera.liveCount()).toBe(1);
          } else {
            expect(h.camera.log[i + 1]).toBe(`stop ${arrived.id}`);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
