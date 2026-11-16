// Properties of the X-ray machine's motion (brief 051 part B), written red first. The motion is pure numbers, so
// every property runs in node: any time step and any run of views keeps every channel finite and in its declared
// range, a long frame counts as a capped one, and a fixed view settles every eased channel on the settled pose.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { XrayPropView, XraySignal } from "../../../ui/xray/types";
import {
  EASED_CHANNELS,
  MAX_FRAME,
  XRAY_MOTION_RANGES,
  type XrayMotion,
  settledXrayMotion,
  stepXrayMotion,
} from "./motion";

const SIGNALS: readonly XraySignal[] = ["dark", "asking", "warming", "searching", "seeing", "filmOnly", "blocked", "noCamera", "paused"];

const viewArb: fc.Arbitrary<XrayPropView> = fc.record({
  power: fc.constantFrom("off" as const, "on" as const),
  signal: fc.constantFrom(...SIGNALS),
});

/** Any time step a browser could hand over, and some it shouldn't. */
const dtArb = fc.oneof(
  fc.double({ min: 0, max: 1 / 30, noNaN: true }),
  fc.double({ min: -5, max: 60, noNaN: true }),
  fc.constantFrom(0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e9, 5e-324),
);

const CHANNELS = Object.keys(XRAY_MOTION_RANGES) as (keyof typeof XRAY_MOTION_RANGES)[];
const INTEGER_CHANNELS = new Set<string>(["arcSeed"]);
const OPEN_TOP = new Set<string>(["t", "scanPhase"]);

/** Any state inside the declared ranges: where the motion might be after some history. */
const motionArb: fc.Arbitrary<XrayMotion> = fc.record(
  Object.fromEntries(
    CHANNELS.map((k) => {
      const [lo, hi] = XRAY_MOTION_RANGES[k];
      return [k, INTEGER_CHANNELS.has(k) ? fc.integer({ min: lo, max: hi }) : fc.double({ min: lo, max: hi, noNaN: true, maxExcluded: OPEN_TOP.has(k) })];
    }),
  ) as { [K in keyof XrayMotion]: fc.Arbitrary<XrayMotion[K]> },
);

function inRange(m: XrayMotion): string | null {
  for (const k of CHANNELS) {
    const v = m[k];
    const [lo, hi] = XRAY_MOTION_RANGES[k];
    if (!Number.isFinite(v)) return `${k} is ${v}`;
    if (v < lo || v > hi) return `${k} = ${v} is outside [${lo}, ${hi}]`;
  }
  return null;
}

describe("the X-ray machine's motion, for any input", () => {
  it("stays finite and inside every declared range, for any time step and any run of views", () => {
    fc.assert(
      fc.property(motionArb, fc.array(fc.tuple(viewArb, fc.boolean(), dtArb), { minLength: 1, maxLength: 40 }), (start, steps) => {
        let m = start;
        for (const [v, hover, dt] of steps) {
          m = stepXrayMotion(m, v, hover, dt);
          expect(inRange(m)).toBeNull();
        }
      }),
    );
  });

  it("draws the settled pose inside every declared range too", () => {
    fc.assert(
      fc.property(viewArb, fc.boolean(), (v, hover) => {
        expect(inRange(settledXrayMotion(v, hover))).toBeNull();
      }),
    );
  });

  it("caps a long frame: any frame past MAX_FRAME moves exactly as far as MAX_FRAME", () => {
    fc.assert(
      fc.property(motionArb, viewArb, fc.boolean(), fc.double({ min: MAX_FRAME, max: 1e6, noNaN: true }), (m, v, hover, dt) => {
        expect(stepXrayMotion(m, v, hover, dt)).toEqual(stepXrayMotion(m, v, hover, MAX_FRAME));
      }),
    );
  });

  it("settles every eased channel on the settled pose, from any state, under a fixed view", () => {
    fc.assert(
      fc.property(motionArb, viewArb, fc.boolean(), fc.constantFrom(1 / 60, 1 / 30, 1 / 144, MAX_FRAME), (start, v, hover, dt) => {
        let m = start;
        for (let i = 0; i < Math.ceil(30 / dt); i++) m = stepXrayMotion(m, v, hover, dt);
        const settled = settledXrayMotion(v, hover);
        for (const k of EASED_CHANNELS) expect(Math.abs(m[k] - settled[k]), k).toBeLessThan(1e-3);
      }),
    );
  });
});
