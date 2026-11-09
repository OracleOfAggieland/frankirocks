import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BRANCH, CRACKLE_SHARE, type Point, WANDER, bolt, boltPath, crackle, regenGapMs, ribbon } from "./electricity";

/** Distance from p to the segment a-b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const same = (p: Point, q: Point) => p.x === q.x && p.y === q.y;
const chordOf = (path: readonly Point[]) => Math.hypot(path.at(-1)!.x - path[0].x, path.at(-1)!.y - path[0].y);

/** A path well formed by Property 19: its points stay within half its chord of the chord. */
function expectNearChord(path: readonly Point[]) {
  const half = chordOf(path) / 2;
  // One assertion per path, not per point, so 300 runs stay quick.
  expect(path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  expect(Math.max(...path.map((p) => distanceToSegment(p, path[0], path.at(-1)!)))).toBeLessThanOrEqual(half + 1e-9);
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
        expect(Math.max(...path.map((p) => distanceToSegment(p, a, b)))).toBeLessThanOrEqual(half + 1e-9);
        expect(boltPath(a, b, seed, depth)).toEqual(path);
        const gap = regenGapMs(seed);
        expect(Number.isInteger(gap)).toBe(true);
        expect(gap).toBeGreaterThanOrEqual(60);
        expect(gap).toBeLessThanOrEqual(90);
      }),
      { numRuns: 300 },
    );
  });

  it("a bolt: a trunk through every waypoint, branches off its middle, twigs off the branches, all well formed and repeatable", () => {
    fc.assert(
      fc.property(fc.array(point, { minLength: 2, maxLength: 9 }), fc.integer(), fc.integer({ min: 1, max: 5 }), (waypoints, seed, depth) => {
        const b = bolt(waypoints, seed, depth);
        const per = 2 ** depth;
        // The trunk: the ends exactly; every interior waypoint at k * 2^depth, moved outward from the
        // middle of the waypoints by at most WANDER of its shorter leg; each leg near its own line.
        expect(b.trunk).toHaveLength((waypoints.length - 1) * per + 1);
        expect(b.trunk[0]).toEqual(waypoints[0]);
        expect(b.trunk.at(-1)).toEqual(waypoints.at(-1));
        const legLength = (k: number) => Math.hypot(waypoints[k].x - waypoints[k - 1].x, waypoints[k].y - waypoints[k - 1].y);
        const mid = { x: waypoints.reduce((s, w) => s + w.x, 0) / waypoints.length, y: waypoints.reduce((s, w) => s + w.y, 0) / waypoints.length };
        for (let k = 1; k < waypoints.length - 1; k++) {
          const at = b.trunk[k * per];
          const w = waypoints[k];
          expect(Math.hypot(at.x - w.x, at.y - w.y)).toBeLessThanOrEqual(WANDER * Math.min(legLength(k), legLength(k + 1)) * (1 + 1e-9) + 1e-9);
          // Outward: never closer to the middle.
          expect(Math.hypot(at.x - mid.x, at.y - mid.y)).toBeGreaterThanOrEqual(Math.hypot(w.x - mid.x, w.y - mid.y) * (1 - 1e-9) - 1e-9);
        }
        for (let k = 1; k < waypoints.length; k++) expectNearChord(b.trunk.slice((k - 1) * per, k * per + 1));
        const legs = waypoints.length - 1;
        const total = waypoints.slice(1).reduce((s, _, k) => s + legLength(k + 1), 0);
        // Wandering waypoints can lengthen the bolt by at most twice WANDER.
        const scale = (total / Math.sqrt(legs)) * (1 + 2 * WANDER);
        if (scale === 0) {
          expect(b.branches).toEqual([]);
          expect(b.twigs).toEqual([]);
          return;
        }
        // Branches: one to three (at most two on a bolt of one or two legs), each starting on a trunk
        // point clear of the trunk's first and last tenth, no longer than its share of the scale.
        expect(b.branches.length).toBeGreaterThanOrEqual(BRANCH.min);
        expect(b.branches.length).toBeLessThanOrEqual(legs >= 3 ? BRANCH.max : BRANCH.max - 1);
        const lo = Math.max(1, Math.floor(b.trunk.length * 0.1));
        const middle = b.trunk.slice(lo, Math.max(lo + 1, Math.ceil(b.trunk.length * 0.9)));
        for (const br of b.branches) {
          expect(br).toHaveLength(2 ** BRANCH.depth + 1);
          expect(middle.some((p) => same(p, br[0]))).toBe(true);
          expect(chordOf(br)).toBeLessThanOrEqual(BRANCH.share * scale * (1 + 1e-9) + 1e-9);
          expectNearChord(br);
        }
        // Twigs: at most one per branch, each starting on an interior point of a branch, shorter than it.
        expect(b.twigs.length).toBeLessThanOrEqual(b.branches.length);
        for (const tw of b.twigs) {
          expect(tw).toHaveLength(2 ** BRANCH.twigDepth + 1);
          const parent = b.branches.find((br) => br.slice(1, -1).some((p) => same(p, tw[0])));
          expect(parent).toBeDefined();
          expect(chordOf(tw)).toBeLessThanOrEqual(BRANCH.twig.max * BRANCH.share * scale * (1 + 1e-9) + 1e-9);
          expectNearChord(tw);
        }
        expect(bolt(waypoints, seed, depth)).toEqual(b);
      }),
      { numRuns: 300 },
    );
  });

  it("the still crackle: arms from each end over at most CRACKLE_SHARE of the trunk, keeping only the offshoots on them", () => {
    fc.assert(
      fc.property(fc.array(point, { minLength: 2, maxLength: 9 }), fc.integer(), fc.integer({ min: 1, max: 5 }), (waypoints, seed, depth) => {
        const b = bolt(waypoints, seed, depth);
        const legs = waypoints.length - 1;
        const c = crackle(b, legs);
        const n = b.trunk.length;
        if (legs === 1) expect(c.arms).toEqual([b.trunk]);
        else {
          expect(c.arms).toHaveLength(2);
          const k = c.arms[0].length - 1;
          expect(k).toBeGreaterThanOrEqual(1);
          expect(k).toBeLessThanOrEqual(Math.max(1, Math.round(CRACKLE_SHARE * (n - 1))));
          expect(c.arms[0]).toEqual(b.trunk.slice(0, k + 1));
          expect(c.arms[1]).toEqual(b.trunk.slice(n - 1 - k).reverse());
        }
        for (const br of c.branches) {
          expect(b.branches).toContain(br);
          expect(c.arms.some((arm) => arm.some((p) => same(p, br[0])))).toBe(true);
        }
        for (const tw of c.twigs) {
          expect(b.twigs).toContain(tw);
          expect(c.branches.some((br) => br.some((p) => same(p, tw[0])))).toBe(true);
        }
      }),
      { numRuns: 200 },
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

  it("the tapered core: one outline point each side of every path point, mirrored, never wider than the widest half width", () => {
    const width = fc.double({ min: 0, max: 5, noNaN: true });
    fc.assert(
      fc.property(point, point, fc.integer(), fc.integer({ min: 1, max: 5 }), width, width, width, fc.double({ min: 0, max: 1, noNaN: true }), (a, b, seed, depth, start, peak, end, at) => {
        const path = boltPath(a, b, seed, depth);
        const outline = ribbon(path, start, peak, end, at);
        const n = path.length;
        expect(outline).toHaveLength(2 * n);
        const widest = Math.max(start, peak, end);
        const bad = path.findIndex((p, i) => {
          const l = outline[i];
          const r = outline[2 * n - 1 - i];
          const finite = [l.x, l.y, r.x, r.y].every(Number.isFinite);
          const mirrored = Math.abs((l.x + r.x) / 2 - p.x) < 1e-6 && Math.abs((l.y + r.y) / 2 - p.y) < 1e-6;
          return !finite || !mirrored || Math.hypot(l.x - p.x, l.y - p.y) > widest + 1e-9;
        });
        expect(bad).toBe(-1);
      }),
      { numRuns: 200 },
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
