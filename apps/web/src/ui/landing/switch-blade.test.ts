import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SPRING, type Spring } from "../motion";
import {
  BLADE_SPRING,
  HALF_DEG,
  MAX_FRAME_MS,
  OPEN_DEG,
  alongBlade,
  angleFromPointer,
  clampAngle,
  dragAngle,
  grabOffset,
  isDrag,
  releaseTarget,
  stepBlade,
  toViewBox,
} from "./switch-blade";

const PIVOT = { x: 84, y: 206 };
const angle = fc.double({ min: 0, max: OPEN_DEG, noNaN: true });
const coord = fc.double({ min: -500, max: 500, noNaN: true });
const springs = fc.constantFrom<Spring>(SPRING.press, SPRING.settle, SPRING.float);

/** Runs the spring at `frameMs` per frame until it stops, or gives up after `limit` frames. */
function settle(from: number, target: number, spring: Spring = SPRING.settle, frameMs = 16, limit = 2000) {
  let s = { angle: from, velocity: 0 };
  const seen: number[] = [from];
  for (let i = 0; i < limit; i++) {
    const next = stepBlade(s, target, spring, frameMs);
    seen.push(next.angle);
    if (next.done) return { frames: i + 1, seen, last: next };
    s = next;
  }
  return { frames: limit, seen, last: { ...s, done: false } };
}

describe("switch blade: angles", () => {
  it("reads straight up as 0 and the open side as positive", () => {
    expect(angleFromPointer(PIVOT, { x: 84, y: 100 })).toBeCloseTo(0);
    expect(angleFromPointer(PIVOT, { x: 184, y: 106 })).toBeCloseTo(45);
    expect(angleFromPointer(PIVOT, { x: -16, y: 106 })).toBeCloseTo(-45);
    expect(angleFromPointer(PIVOT, PIVOT)).toBe(0);
  });

  it("puts the blade tip where the angle says", () => {
    const tip = alongBlade(PIVOT, OPEN_DEG, 100);
    expect(angleFromPointer(PIVOT, tip)).toBeCloseTo(OPEN_DEG);
    expect(Math.hypot(tip.x - PIVOT.x, tip.y - PIVOT.y)).toBeCloseTo(100);
  });

  it("holds every drag between closed and open", () => {
    fc.assert(
      fc.property(coord, coord, fc.double({ min: -60, max: 60, noNaN: true }), (x, y, grab) => {
        const a = dragAngle(PIVOT, { x, y }, grab);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(OPEN_DEG);
      }),
    );
  });

  it("does not jump when the handle is grabbed off its centre line", () => {
    fc.assert(
      fc.property(angle, fc.double({ min: -40, max: 40, noNaN: true }), fc.double({ min: 40, max: 180, noNaN: true }), (at, off, r) => {
        const p = alongBlade(PIVOT, clampAngle(at + off), r);
        const grab = grabOffset(PIVOT, p, at);
        expect(dragAngle(PIVOT, p, grab)).toBeCloseTo(at, 6);
      }),
    );
  });

  it("follows the pointer one for one inside the travel", () => {
    fc.assert(
      fc.property(angle, fc.double({ min: 40, max: 180, noNaN: true }), (at, r) => {
        expect(dragAngle(PIVOT, alongBlade(PIVOT, at, r), 0)).toBeCloseTo(at, 6);
      }),
    );
  });

  it("holds a pointer dragged below the pivot at the nearer end", () => {
    expect(dragAngle(PIVOT, { x: 200, y: 300 }, 0)).toBe(OPEN_DEG);
    expect(dragAngle(PIVOT, { x: -50, y: 300 }, 0)).toBe(0);
  });

  it("clamps, and treats not a number as open", () => {
    expect(clampAngle(-5)).toBe(0);
    expect(clampAngle(90)).toBe(OPEN_DEG);
    expect(clampAngle(Number.NaN)).toBe(OPEN_DEG);
  });
});

describe("switch blade: letting go", () => {
  it("throws past halfway and settles back otherwise", () => {
    expect(releaseTarget(0)).toBe(0);
    expect(releaseTarget(HALF_DEG - 0.01)).toBe(0);
    expect(releaseTarget(HALF_DEG)).toBe(OPEN_DEG);
    expect(releaseTarget(OPEN_DEG)).toBe(OPEN_DEG);
  });

  it("decides for every angle by which side of halfway it is on", () => {
    fc.assert(
      fc.property(angle, (a) => {
        expect(releaseTarget(a) === 0).toBe(a < HALF_DEG);
      }),
    );
  });

  it("counts a press as a drag only past the slop", () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
  });
});

describe("switch blade: the spring", () => {
  it("throws shut on press and stops in the clips", () => {
    const run = settle(OPEN_DEG, 0, BLADE_SPRING.throw);
    expect(run.last.done).toBe(true);
    expect(run.last.angle).toBe(0);
    // A quick snap: well under half a second of 16 ms frames.
    expect(run.frames).toBeLessThan(30);
  });

  it("never passes its target, never leaves the travel, and always comes to rest", () => {
    fc.assert(
      fc.property(angle, fc.constantFrom(0, OPEN_DEG, OPEN_DEG - 4), springs, fc.integer({ min: 4, max: 40 }), (from, target, spring, frameMs) => {
        const run = settle(from, target, spring, frameMs);
        expect(run.last.done).toBe(true);
        expect(run.last.angle).toBe(target);
        const up = target >= from;
        for (const a of run.seen) {
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(OPEN_DEG);
          if (up) expect(a).toBeLessThanOrEqual(target + 1e-9);
          else expect(a).toBeGreaterThanOrEqual(target - 1e-9);
        }
      }),
    );
  });

  it("moves monotonically toward the target from rest", () => {
    fc.assert(
      fc.property(angle, fc.constantFrom(0, OPEN_DEG), springs, (from, target, spring) => {
        const run = settle(from, target, spring);
        for (let i = 1; i < run.seen.length; i++) {
          if (target > from) expect(run.seen[i]).toBeGreaterThanOrEqual(run.seen[i - 1] - 1e-9);
          else expect(run.seen[i]).toBeLessThanOrEqual(run.seen[i - 1] + 1e-9);
        }
      }),
    );
  });

  it("caps a long frame, so a stalled tab does not fling the blade", () => {
    const a = stepBlade({ angle: OPEN_DEG, velocity: 0 }, 0, SPRING.settle, 10_000);
    const b = stepBlade({ angle: OPEN_DEG, velocity: 0 }, 0, SPRING.settle, MAX_FRAME_MS);
    expect(a).toEqual(b);
  });

  it("is at rest on its target already", () => {
    expect(stepBlade({ angle: OPEN_DEG, velocity: 0 }, OPEN_DEG, SPRING.settle, 16)).toEqual({ angle: OPEN_DEG, velocity: 0, done: true });
  });

  it("survives bad input", () => {
    const s = stepBlade({ angle: Number.NaN, velocity: Number.NaN }, 0, SPRING.settle, Number.NaN);
    expect(Number.isFinite(s.angle)).toBe(true);
    expect(Number.isFinite(s.velocity)).toBe(true);
  });
});

describe("switch blade: viewBox mapping", () => {
  const view = { x: 0, y: 0, width: 240, height: 240 };

  it("maps corners of a square box exactly", () => {
    const rect = { left: 10, top: 20, width: 220, height: 220 };
    expect(toViewBox(rect, view, { x: 10, y: 20 })).toEqual({ x: 0, y: 0 });
    const far = toViewBox(rect, view, { x: 230, y: 240 });
    expect(far.x).toBeCloseTo(240);
    expect(far.y).toBeCloseTo(240);
  });

  it("letterboxes a box wider than the viewBox", () => {
    const rect = { left: 0, top: 0, width: 440, height: 220 };
    const mid = toViewBox(rect, view, { x: 220, y: 110 });
    expect(mid.x).toBeCloseTo(120);
    expect(mid.y).toBeCloseTo(120);
    expect(toViewBox(rect, view, { x: 110, y: 0 }).x).toBeCloseTo(0);
  });

  it("maps a zero box to the origin", () => {
    expect(toViewBox({ left: 0, top: 0, width: 0, height: 0 }, view, { x: 5, y: 5 })).toEqual({ x: 0, y: 0 });
  });
});
