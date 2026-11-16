// Bone placement's invariants (brief 051 part C), written and run red first against a placement that normalised
// without a guard and built its turn with the half-angle formula alone.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Vec3, placeBone, turnUp } from "./bone-place";

const finite = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const coord = finite(-50, 50);
const vec: fc.Arbitrary<Vec3> = fc.record({ x: coord, y: coord, z: coord });
/** Joints that sit on top of each other, or almost, or straight up or straight down from each other. */
const awkward: fc.Arbitrary<[Vec3, Vec3]> = fc.oneof(
  vec.map((a) => [a, a] as [Vec3, Vec3]),
  fc.tuple(vec, finite(-1e-12, 1e-12)).map(([a, e]) => [a, { x: a.x + e, y: a.y, z: a.z - e }] as [Vec3, Vec3]),
  fc.tuple(vec, finite(-40, 40)).map(([a, d]) => [a, { x: a.x, y: a.y + d, z: a.z }] as [Vec3, Vec3]),
);
const pair = fc.oneof(fc.tuple(vec, vec), awkward);

const tol = (a: Vec3, b: Vec3) => 1e-9 * Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(a.z), Math.abs(b.x), Math.abs(b.y), Math.abs(b.z));

describe("bone placement properties", () => {
  it("puts a bone's two ends exactly on its two joints", () => {
    fc.assert(
      fc.property(pair, ([a, b]) => {
        const p = placeBone(a, b);
        expect(p.origin).toEqual(a);
        const end = { x: p.origin.x + p.dir.x * p.length, y: p.origin.y + p.dir.y * p.length, z: p.origin.z + p.dir.z * p.length };
        const e = tol(a, b);
        expect(Math.abs(end.x - b.x)).toBeLessThanOrEqual(e);
        expect(Math.abs(end.y - b.y)).toBeLessThanOrEqual(e);
        expect(Math.abs(end.z - b.z)).toBeLessThanOrEqual(e);
      }),
    );
  });

  it("turns the bone's own up onto the line between its joints", () => {
    fc.assert(
      fc.property(pair, ([a, b]) => {
        const p = placeBone(a, b);
        const up = turnUp(p.quat);
        expect(Math.abs(Math.hypot(...p.quat) - 1)).toBeLessThan(1e-9);
        expect(Math.abs(up.x - p.dir.x)).toBeLessThan(1e-9);
        expect(Math.abs(up.y - p.dir.y)).toBeLessThan(1e-9);
        expect(Math.abs(up.z - p.dir.z)).toBeLessThan(1e-9);
      }),
    );
  });

  it("never makes a NaN, even for two joints in the same place", () => {
    fc.assert(
      fc.property(pair, ([a, b]) => {
        const p = placeBone(a, b);
        for (const v of [p.length, p.dir.x, p.dir.y, p.dir.z, ...p.quat]) expect(Number.isFinite(v)).toBe(true);
        expect(p.length).toBeGreaterThanOrEqual(0);
        expect(Math.abs(Math.hypot(p.dir.x, p.dir.y, p.dir.z) - 1)).toBeLessThan(1e-9);
      }),
    );
  });
});
