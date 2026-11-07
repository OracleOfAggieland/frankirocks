import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Point, boltPath, regenGapMs } from "./electricity";

/** Distance from p to the segment a-b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Feature: lab-ui-foundation, Property 19: Electricity paths are well formed
describe("Property 19: Electricity paths are well formed", () => {
  const coord = fc.double({ min: -1000, max: 1000, noNaN: true });
  const point = fc.record({ x: coord, y: coord });

  it("starts at a, ends at b, has 2^depth + 1 points near the line, and repeats per seed", () => {
    fc.assert(
      fc.property(point, point, fc.integer(), fc.integer({ min: 1, max: 6 }), (a, b, seed, depth) => {
        const path = boltPath(a, b, seed, depth);
        expect(path).toHaveLength(2 ** depth + 1);
        expect(path[0]).toEqual(a);
        expect(path[path.length - 1]).toEqual(b);
        const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
        for (const p of path) expect(distanceToSegment(p, a, b)).toBeLessThanOrEqual(half + 1e-9);
        expect(boltPath(a, b, seed, depth)).toEqual(path);
        const gap = regenGapMs(seed);
        expect(Number.isInteger(gap)).toBe(true);
        expect(gap).toBeGreaterThanOrEqual(60);
        expect(gap).toBeLessThanOrEqual(90);
      }),
      { numRuns: 300 },
    );
  });
});
