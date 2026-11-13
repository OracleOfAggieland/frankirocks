// The globe's motion invariants (brief 047 part C), written and run red first against a motion with no clamps.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type GlobeMotion, INITIAL_GLOBE, MAX_FRAME, PITCH_LIMIT, dragBy, faceStation, faceTarget, release, stepGlobe } from "./motion";

const finite = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

/** One thing that can happen to the globe. */
type Op =
  | { kind: "drag"; dx: number; dy: number; size: number }
  | { kind: "release"; vx: number; vy: number; size: number }
  | { kind: "face"; lat: number; lon: number }
  | { kind: "step"; dt: number; idleSpin: boolean };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("drag" as const), dx: finite(-5000, 5000), dy: finite(-5000, 5000), size: finite(1, 2000) }),
  fc.record({ kind: fc.constant("release" as const), vx: finite(-1e5, 1e5), vy: finite(-1e5, 1e5), size: finite(1, 2000) }),
  fc.record({ kind: fc.constant("face" as const), lat: finite(-90, 90), lon: finite(-180, 180) }),
  fc.record({ kind: fc.constant("step" as const), dt: finite(-1, 30), idleSpin: fc.boolean() }),
);

function apply(m: GlobeMotion, o: Op, still: boolean): GlobeMotion {
  switch (o.kind) {
    case "drag":
      return dragBy(m, o.dx, o.dy, o.size);
    case "release":
      return release(m, o.vx, o.vy, o.size, { still });
    case "face":
      return faceStation(m, o.lat, o.lon, { still });
    case "step":
      return stepGlobe(m, o.dt, { idleSpin: o.idleSpin, still });
  }
}

/** Any state the globe can reach. */
const reached = fc.tuple(fc.array(op, { maxLength: 40 }), fc.boolean()).map(([ops, still]) => ops.reduce((m, o) => apply(m, o, still), INITIAL_GLOBE));

describe("globe motion properties", () => {
  it("never lets the pitch leave its clamp, whatever is done to it", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), fc.boolean(), (ops, still) => {
        let m = INITIAL_GLOBE;
        for (const o of ops) {
          m = apply(m, o, still);
          expect(Math.abs(m.pitch)).toBeLessThanOrEqual(PITCH_LIMIT);
        }
      }),
    );
  });

  it("keeps the yaw finite and normalised to [-pi, pi)", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), fc.boolean(), (ops, still) => {
        let m = INITIAL_GLOBE;
        for (const o of ops) {
          m = apply(m, o, still);
          expect(Number.isFinite(m.yaw)).toBe(true);
          expect(m.yaw).toBeGreaterThanOrEqual(-Math.PI);
          expect(m.yaw).toBeLessThan(Math.PI);
        }
      }),
    );
  });

  it("ends every ease exactly on its target, then stops", () => {
    fc.assert(
      fc.property(reached, finite(-90, 90), finite(-180, 180), fc.array(finite(1 / 240, MAX_FRAME), { minLength: 1, maxLength: 30 }), (start, lat, lon, frames) => {
        const target = faceTarget(lat, lon);
        let m = faceStation(release(start, 0, 0, 100, { still: false }), lat, lon, { still: false });
        // Frames as given, then 60 Hz frames, for four seconds in all.
        let t = 0;
        let i = 0;
        while (t < 4) {
          const dt = frames[i] ?? 1 / 60;
          i++;
          m = stepGlobe(m, dt, { idleSpin: false, still: false });
          t += dt;
        }
        expect(m.yaw).toBe(target.yaw);
        expect(m.pitch).toBe(target.pitch);
        expect(m.target).toBeNull();
        const after = stepGlobe(m, 1 / 60, { idleSpin: false, still: false });
        expect(after.yaw).toBe(m.yaw);
        expect(after.pitch).toBe(m.pitch);
      }),
    );
  });

  it("caps a long frame: anything past MAX_FRAME moves the globe no further", () => {
    fc.assert(
      fc.property(reached, finite(MAX_FRAME, 1e6), fc.boolean(), (m, dt, idleSpin) => {
        expect(stepGlobe(m, dt, { idleSpin, still: false })).toEqual(stepGlobe(m, MAX_FRAME, { idleSpin, still: false }));
      }),
    );
  });

  it("changes nothing on a step under still", () => {
    fc.assert(
      fc.property(reached, finite(-10, 1e6), fc.boolean(), (m, dt, idleSpin) => {
        expect(stepGlobe(m, dt, { idleSpin, still: true })).toEqual(m);
      }),
    );
  });
});
