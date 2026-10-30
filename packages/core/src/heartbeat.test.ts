import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isHeartbeatFresh } from "./heartbeat";

const time = fc.integer({ min: 0, max: 4_102_444_800_000 }); // through 2100
const window = fc.integer({ min: 0, max: 24 * 60 * 60 * 1000 });

describe("isHeartbeatFresh", () => {
  it("treats a beat written just now as fresh", () => {
    fc.assert(fc.property(time, window, (now, maxAge) => isHeartbeatFresh(now, now, maxAge)));
  });

  it("is fresh exactly when the beat is within the window", () => {
    fc.assert(
      fc.property(time, time, window, (beat, now, maxAge) => {
        expect(isHeartbeatFresh(beat, now, maxAge)).toBe(Math.abs(now - beat) <= maxAge);
      }),
    );
  });

  it("never gets fresher as a beat ages", () => {
    fc.assert(
      fc.property(time, window, window, window, (beat, maxAge, a, b) => {
        const [younger, older] = a <= b ? [a, b] : [b, a];
        if (isHeartbeatFresh(beat, beat + older, maxAge)) {
          expect(isHeartbeatFresh(beat, beat + younger, maxAge)).toBe(true);
        }
      }),
    );
  });

  it("rejects non-finite times and negative windows", () => {
    const bad = fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);
    fc.assert(fc.property(bad, time, window, (b, now, maxAge) => !isHeartbeatFresh(b, now, maxAge)));
    fc.assert(fc.property(time, bad, window, (beat, n, maxAge) => !isHeartbeatFresh(beat, n, maxAge)));
    fc.assert(
      fc.property(time, fc.integer({ min: -1e9, max: -1 }), (now, maxAge) => !isHeartbeatFresh(now, now, maxAge)),
    );
  });
});
