// Property (brief 051, the X-ray store): dispose() stops everything, whatever ran before. No stream is live, none
// handed over afterwards stays live, the tracker is closed, no timer or picture watch is left, the element is empty,
// and nothing more is published.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { act, flush, xrayActionArb, xrayHarness } from "./testing/xray-fakes";

describe("xray store property", () => {
  it("leaves nothing running after dispose", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(xrayActionArb, { maxLength: 40, size: "max" }), fc.array(xrayActionArb, { maxLength: 10 }), async (before, after) => {
        const h = xrayHarness();
        for (const a of before) await act(h, a);
        h.watch.dispose();
        await flush();
        const published = h.camera.log.filter((l) => l.startsWith("publish")).length;
        expect(h.camera.liveCount()).toBe(0);
        expect(h.tracker.loaded).toBe(false);
        expect(h.timers.timers).toEqual([]);
        expect(h.timers.pictureWatchers).toEqual([]);
        expect(h.video.srcObject).toBeNull();
        // Whatever arrives or happens afterwards changes nothing.
        while (h.camera.pending.length > 0) h.camera.answer(0, "ok");
        while (h.tracker.loads.length > 0) h.tracker.settle(0, true);
        for (const a of after) await act(h, a);
        await flush();
        expect(h.camera.liveCount()).toBe(0);
        expect(h.camera.log.filter((l) => l.startsWith("publish")).length).toBe(published);
      }),
      { numRuns: 1000 },
    );
  });
});
