import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEG,
  LEGS,
  LOWER,
  MIN_REACH,
  REACH,
  REST_DISTANCE,
  UPPER,
  add,
  clampToReach,
  dist,
  hipOffset,
  restOffset,
  solveLeg,
  vec,
  wrapAngle,
} from "./geometry";
import { smoothHeading, smoothVelocity } from "./heading";

const arbAngle = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });

describe("spider geometry", () => {
  it("rest feet sit 13 to 15 px from the head at about 35, 70, 110 and 145 degrees, mirrored", () => {
    for (const d of REST_DISTANCE) expect(d >= 13 && d <= 15).toBe(true);
    const h = 0;
    for (let pair = 0; pair < 4; pair++) {
      const left = restOffset(pair, h);
      const right = restOffset(pair + 4, h);
      expect(left.x).toBeCloseTo(right.x, 9);
      expect(left.y).toBeCloseTo(-right.y, 9);
      expect(left.y).toBeLessThan(0);
    }
    expect(Math.atan2(restOffset(4, 0).y, restOffset(4, 0).x) / DEG).toBeCloseTo(35, 6);
    expect(Math.atan2(restOffset(7, 0).y, restOffset(7, 0).x) / DEG).toBeCloseTo(145, 6);
  });

  it("every rest foot is within easy reach of its hip, with the knee bent", () => {
    for (let leg = 0; leg < LEGS; leg++) {
      const d = dist(hipOffset(leg, 0), restOffset(leg, 0));
      expect(d).toBeGreaterThan(MIN_REACH);
      expect(d).toBeLessThan(REACH - 1);
    }
  });

  it("the leg solve keeps both bones their length, lands the foot, and bends the knee out", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: LEGS - 1 }), arbAngle, fc.double({ min: 0, max: 30, noNaN: true }), arbAngle, (leg, heading, r, a) => {
        const hip = hipOffset(leg, heading);
        const target = add(hip, vec(r * Math.cos(a), r * Math.sin(a)));
        const { knee, foot } = solveLeg(hip, target, heading, leg);
        expect(dist(hip, knee)).toBeCloseTo(UPPER, 6);
        expect(dist(knee, foot)).toBeCloseTo(LOWER, 6);
        if (r > MIN_REACH + 0.01 && r < REACH - 0.01) expect(dist(foot, target)).toBeLessThan(1e-6);
        expect(dist(hip, foot)).toBeLessThanOrEqual(REACH);
      }),
    );
  });

  it("at rest, each knee sits further from the body axis than the straight line from hip to foot", () => {
    for (let leg = 0; leg < LEGS; leg++) {
      const hip = hipOffset(leg, 0);
      const foot = restOffset(leg, 0);
      const { knee } = solveLeg(hip, foot, 0, leg);
      const side = leg < 4 ? -1 : 1;
      expect(side * knee.y).toBeGreaterThan(side * ((hip.y + foot.y) / 2));
    }
  });

  it("clampToReach brings any point to within reach of the hip", () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 100, noNaN: true }), fc.double({ min: -100, max: 100, noNaN: true }), (x, y) => {
        const p = clampToReach(vec(0, 0), vec(x, y), 0, 0);
        const d = dist(vec(0, 0), p);
        expect(d).toBeGreaterThanOrEqual(MIN_REACH - 1e-9);
        expect(d).toBeLessThanOrEqual(REACH + 1e-9);
      }),
    );
  });

  it("wrapAngle lands in (-PI, PI]", () => {
    fc.assert(
      fc.property(fc.double({ min: -50, max: 50, noNaN: true }), (a) => {
        const w = wrapAngle(a);
        expect(w).toBeGreaterThan(-Math.PI - 1e-12);
        expect(w).toBeLessThanOrEqual(Math.PI + 1e-12);
        expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
      }),
    );
  });
});

describe("spider heading", () => {
  it("follows the direction of travel and settles on it", () => {
    let h = -Math.PI / 2;
    let v = vec(0, 0);
    for (let i = 0; i < 60; i++) {
      v = smoothVelocity(v, vec(8, 0), 16);
      h = smoothHeading(h, v, 16);
    }
    expect(h).toBeCloseTo(0, 3);
  });

  it("is a low-pass: one frame turns only part of the way", () => {
    const h = smoothHeading(0, vec(0, 1), 16);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(Math.PI / 4);
  });

  it("holds when the pointer is nearly still", () => {
    expect(smoothHeading(1.2, vec(0.01, -0.02), 16)).toBe(1.2);
  });
});
