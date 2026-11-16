// The smoothing's invariants (brief 051 part C), written and run red first against an ease with no frame cap and no
// snap onto its target.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FADE_SECONDS, MAX_FRAME, type Quat, approach, approachQuat, fade } from "./smooth";

const finite = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const value = finite(-1e4, 1e4);
const halfLife = finite(0.005, 0.5);
const frame = finite(0, 0.05);
const anyDt = fc.oneof(finite(-10, 100), fc.constant(Number.NaN), fc.constant(Number.POSITIVE_INFINITY));

const quat: fc.Arbitrary<Quat> = fc
  .tuple(finite(-1, 1), finite(-1, 1), finite(-1, 1), finite(-1, 1))
  .filter(([x, y, z, w]) => Math.hypot(x, y, z, w) > 0.1)
  .map(([x, y, z, w]) => {
    const n = Math.hypot(x, y, z, w);
    return [x / n, y / n, z / n, w / n] as Quat;
  });

describe("smoothing properties", () => {
  it("ends exactly on its target", () => {
    fc.assert(
      fc.property(value, value, halfLife, finite(1 / 240, 1 / 20), (from, to, h, dt) => {
        let v = from;
        // Enough frames to cover sixty half-lives, which no number can outlast.
        const frames = Math.ceil((60 * h) / dt) + 1;
        for (let i = 0; i < frames; i++) v = approach(v, to, dt, h);
        expect(v).toBe(to);
      }),
    );
  });

  it("never passes its target, and moves toward it", () => {
    fc.assert(
      fc.property(value, value, halfLife, anyDt, (from, to, h, dt) => {
        const v = approach(from, to, dt, h);
        expect(v).toBeGreaterThanOrEqual(Math.min(from, to));
        expect(v).toBeLessThanOrEqual(Math.max(from, to));
      }),
    );
  });

  it("caps a long frame: anything longer moves no further than the cap", () => {
    fc.assert(
      fc.property(value, value, halfLife, finite(MAX_FRAME, 1e4), (from, to, h, dt) => {
        expect(approach(from, to, dt, h)).toBe(approach(from, to, MAX_FRAME, h));
        expect(fade(0.5, true, dt)).toBe(fade(0.5, true, MAX_FRAME));
      }),
    );
  });

  it("changes nothing when no time passes, or time runs backwards, or is not a number", () => {
    fc.assert(
      fc.property(value, value, halfLife, fc.oneof(fc.constant(0), finite(-100, 0), fc.constant(Number.NaN)), quat, quat, finite(0, 1), fc.boolean(), (from, to, h, dt, q, r, p, present) => {
        expect(approach(from, to, dt, h)).toBe(from);
        expect(approachQuat(q, r, dt, h)).toEqual(q);
        expect(fade(p, present, dt)).toBe(p);
      }),
    );
  });

  it("keeps a turn a unit turn, and lands on its target turn", () => {
    fc.assert(
      fc.property(quat, quat, halfLife, frame, (q, r, h, dt) => {
        const step = approachQuat(q, r, dt, h);
        expect(Math.abs(Math.hypot(...step) - 1)).toBeLessThan(1e-9);
        let v = q;
        const frames = Math.ceil((60 * h) / Math.max(dt, 1 / 240)) + 1;
        for (let i = 0; i < frames; i++) v = approachQuat(v, r, Math.max(dt, 1 / 240), h);
        expect(v).toEqual(r);
      }),
    );
  });

  it("fades in and out over its time, staying between 0 and 1", () => {
    fc.assert(
      fc.property(finite(0, 1), fc.boolean(), fc.array(frame, { maxLength: 40 }), (p0, present, frames) => {
        let p = p0;
        for (const dt of frames) {
          p = fade(p, present, dt);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
        let t = 0;
        while (t < FADE_SECONDS + 1e-9) {
          p = fade(p, present, 1 / 60);
          t += 1 / 60;
        }
        expect(p).toBe(present ? 1 : 0);
      }),
    );
  });
});
