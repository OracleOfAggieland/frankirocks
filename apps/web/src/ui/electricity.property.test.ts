import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BRANCH, type Point, bolt, boltPath, regenGapMs } from "./electricity";

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

  it("branches: one or two, each starting on an interior trunk point, short, well formed, repeatable", () => {
    fc.assert(
      fc.property(fc.array(point, { minLength: 2, maxLength: 5 }), fc.integer(), fc.integer({ min: 1, max: 5 }), (waypoints, seed, depth) => {
        const b = bolt(waypoints, seed, depth);
        const per = 2 ** depth;
        // The trunk: every waypoint once at k * 2^depth, each leg near its own line.
        expect(b.trunk).toHaveLength((waypoints.length - 1) * per + 1);
        waypoints.forEach((w, k) => expect(b.trunk[k * per]).toEqual(w));
        for (let k = 1; k < waypoints.length; k++) {
          const half = Math.hypot(waypoints[k].x - waypoints[k - 1].x, waypoints[k].y - waypoints[k - 1].y) / 2;
          for (const p of b.trunk.slice((k - 1) * per, k * per + 1)) expect(distanceToSegment(p, waypoints[k - 1], waypoints[k])).toBeLessThanOrEqual(half + 1e-9);
        }
        const legs = waypoints.slice(1).map((w, k) => Math.hypot(w.x - waypoints[k].x, w.y - waypoints[k].y));
        const scale = legs.reduce((s, l) => s + l, 0) / legs.length;
        if (scale === 0) {
          expect(b.branches).toEqual([]);
          return;
        }
        expect(b.branches.length).toBeGreaterThanOrEqual(BRANCH.min);
        expect(b.branches.length).toBeLessThanOrEqual(BRANCH.max);
        const interior = b.trunk.slice(1, -1);
        for (const br of b.branches) {
          expect(br).toHaveLength(2 ** BRANCH.depth + 1);
          expect(interior.some((p) => p.x === br[0].x && p.y === br[0].y)).toBe(true);
          const chord = Math.hypot(br.at(-1)!.x - br[0].x, br.at(-1)!.y - br[0].y);
          expect(chord).toBeLessThanOrEqual(BRANCH.maxShare * scale * (1 + 1e-9) + 1e-9);
          for (const p of br) expect(distanceToSegment(p, br[0], br.at(-1)!)).toBeLessThanOrEqual(chord / 2 + 1e-9);
          for (const p of br) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        }
        expect(bolt(waypoints, seed, depth)).toEqual(b);
      }),
      { numRuns: 300 },
    );
  });

  it("is visibly jagged at stage size: at least five clear kinks", () => {
    const stageCoord = fc.double({ min: 0, max: 200, noNaN: true });
    const stagePoint = fc.record({ x: stageCoord, y: stageCoord });
    fc.assert(
      fc.property(stagePoint, stagePoint, fc.integer(), (a, b, seed) => {
        fc.pre(Math.hypot(b.x - a.x, b.y - a.y) >= 40);
        expect(kinks(boltPath(a, b, seed, 4))).toBeGreaterThanOrEqual(5);
      }),
      { numRuns: 500 },
    );
  });
});

/** Vertices where the path turns by at least `minDeg` degrees. */
function kinks(path: readonly Point[], minDeg = 20): number {
  let n = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const a = Math.atan2(path[i].y - path[i - 1].y, path[i].x - path[i - 1].x);
    const b = Math.atan2(path[i + 1].y - path[i].y, path[i + 1].x - path[i].x);
    let turn = Math.abs(b - a);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if ((turn * 180) / Math.PI >= minDeg) n++;
  }
  return n;
}
