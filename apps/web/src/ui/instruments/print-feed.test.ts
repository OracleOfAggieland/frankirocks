import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FEED_STEPS, feedKeyframes } from "./print-feed";

describe("receipt feed", () => {
  it("prints out of the slot in eight pushes, each followed by a pause", () => {
    const f = feedKeyframes();
    expect(FEED_STEPS).toBe(8);
    expect(f.y[0]).toBe("100%");
    expect(f.y.at(-1)).toBe("0%");
    expect(f.y).toHaveLength(17);
    expect(f.times).toHaveLength(17);
    expect(f.pushes).toHaveLength(16);
    expect(f.pushes.filter(Boolean)).toHaveLength(8);
    expect(f.y.slice(1, 3)).toEqual(["87.5%", "87.5%"]);
    expect(f.times[0]).toBe(0);
    expect(f.times.at(-1)).toBe(1);
  });

  it("only ever rises, with times strictly in order, for any step count and push share", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 24 }), fc.double({ min: 0, max: 1, noNaN: true }), (steps, move) => {
        const f = feedKeyframes(steps, move);
        const ys = f.y.map((v) => Number.parseFloat(v));
        for (let i = 1; i < ys.length; i += 1) {
          expect(ys[i]).toBeLessThanOrEqual(ys[i - 1]);
          expect(f.times[i]).toBeGreaterThan(f.times[i - 1]);
          // A pause holds still; a push moves.
          if (f.pushes[i - 1]) expect(ys[i]).toBeLessThan(ys[i - 1]);
          else expect(ys[i]).toBe(ys[i - 1]);
        }
        expect(f.times.at(-1)).toBe(1);
        expect(ys.at(-1)).toBe(0);
      }),
    );
  });
});
