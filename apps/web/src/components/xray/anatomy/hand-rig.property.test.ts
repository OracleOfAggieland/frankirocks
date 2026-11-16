// A whole hand's bones (brief 051 part C): every finger bone ends on its two joints, and no hand, however folded or
// collapsed, makes a NaN.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Vec3 } from "./bone-place";
import { FINGER_BONES, KNUCKLES, PALM_BASE, handRig } from "./hand-rig";

const finite = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const vec: fc.Arbitrary<Vec3> = fc.record({ x: finite(-2, 2), y: finite(-2, 2), z: finite(-2, 2) });
const hand = fc.oneof(
  fc.array(vec, { minLength: 21, maxLength: 21 }),
  // Every joint in one place, or the hand seen exactly edge on.
  vec.map((v) => Array.from({ length: 21 }, () => v)),
  fc.array(vec, { minLength: 21, maxLength: 21 }).map((ps) => ps.map((p) => ({ ...p, x: 0, z: 0 }))),
);

const near = (a: Vec3, b: Vec3) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z)) < 1e-9;
const endOf = (p: { origin: Vec3; dir: Vec3; length: number }) => ({ x: p.origin.x + p.dir.x * p.length, y: p.origin.y + p.dir.y * p.length, z: p.origin.z + p.dir.z * p.length });

describe("hand rig properties", () => {
  it("puts each finger bone's ends on its joints, and each palm bone's far end on its knuckle", () => {
    fc.assert(
      fc.property(hand, (ps) => {
        const rig = handRig(ps);
        FINGER_BONES.forEach(([a, b], i) => {
          expect(near(rig.bones[i]!.place.origin, ps[a]!)).toBe(true);
          expect(near(endOf(rig.bones[i]!.place), ps[b]!)).toBe(true);
        });
        KNUCKLES.forEach((k, i) => {
          const bone = rig.bones[FINGER_BONES.length + i]!;
          expect(near(endOf(bone.place), ps[k]!)).toBe(true);
          const base = { x: ps[0]!.x + (ps[k]!.x - ps[0]!.x) * PALM_BASE, y: ps[0]!.y + (ps[k]!.y - ps[0]!.y) * PALM_BASE, z: ps[0]!.z + (ps[k]!.z - ps[0]!.z) * PALM_BASE };
          expect(near(bone.place.origin, base)).toBe(true);
        });
      }),
    );
  });

  it("never makes a NaN, and sizes every bone above nothing", () => {
    fc.assert(
      fc.property(hand, (ps) => {
        const rig = handRig(ps);
        expect(rig.size).toBeGreaterThan(0);
        for (const b of [...rig.bones, ...rig.forearm]) {
          for (const v of [b.thickness, b.place.length, b.place.origin.x, b.place.origin.y, b.place.origin.z, ...b.place.quat]) expect(Number.isFinite(v)).toBe(true);
        }
        for (const w of rig.wrist) for (const v of [w.at.x, w.at.y, w.at.z, w.radius]) expect(Number.isFinite(v)).toBe(true);
      }),
    );
  });
});
