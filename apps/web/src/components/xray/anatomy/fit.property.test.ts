// The screen correction's invariants (brief 051 part C), written and run red first against a least-squares fit with
// no clamp and no guard against too few or bad points.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FIT_SCALE_LIMIT, FIT_SHIFT_LIMIT, type FitCorrection, IDENTITY_FIT, type Pair, correctPoint, correctionNdc, fitCorrection } from "./fit";

const finite = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const aspect = finite(0.3, 3);
const pt = fc.record({ x: finite(0, 1), y: finite(0, 1) });
/** Points spread over the picture, as a face's are. */
const spread = fc.array(pt, { minLength: 3, maxLength: 12 }).filter((ps) => {
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  return Math.max(...xs) - Math.min(...xs) > 0.05 && Math.max(...ys) - Math.min(...ys) > 0.05;
});
const correction: fc.Arbitrary<FitCorrection> = fc.record({ s: finite(1 / FIT_SCALE_LIMIT, FIT_SCALE_LIMIT), tx: finite(-0.5, 0.5), ty: finite(-0.5, 0.5) });

const middle = (ps: readonly { x: number; y: number }[]) => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length });
const wild = fc.oneof(fc.double(), fc.constant(Number.NaN), fc.constant(Number.POSITIVE_INFINITY), finite(-5, 5));
const anyPairs: fc.Arbitrary<Pair[]> = fc.array(fc.record({ from: fc.record({ x: wild, y: wild }), to: fc.record({ x: wild, y: wild }) }), { maxLength: 10 });

const error = (c: FitCorrection, pairs: readonly Pair[], a: number) =>
  pairs.reduce((sum, { from, to }) => {
    const p = correctPoint(c, a, from);
    return sum + ((p.x - to.x) * a) ** 2 + (p.y - to.y) ** 2;
  }, 0);

describe("screen correction properties", () => {
  it("finds the scale and shift that took the projected points onto the landmarks", () => {
    fc.assert(
      fc.property(spread, correction, aspect, (from, c, a) => {
        const pairs = from.map((p) => ({ from: p, to: correctPoint(c, a, p) }));
        // Only a correction inside the clamp can be found again: its slip of the points' middle is in bounds.
        const m = middle(from);
        const moved = correctPoint(c, a, m);
        fc.pre(Math.abs((moved.x - m.x) * a) <= FIT_SHIFT_LIMIT && Math.abs(moved.y - m.y) <= FIT_SHIFT_LIMIT);
        const got = fitCorrection(pairs, a);
        expect(Math.abs(got.s - c.s)).toBeLessThan(1e-6);
        expect(Math.abs(got.tx - c.tx)).toBeLessThan(1e-6);
        expect(Math.abs(got.ty - c.ty)).toBeLessThan(1e-6);
      }),
    );
  });

  it("changes nothing when the points already line up", () => {
    fc.assert(
      fc.property(spread, aspect, (from, a) => {
        const got = fitCorrection(
          from.map((p) => ({ from: p, to: p })),
          a,
        );
        expect(Math.abs(got.s - 1)).toBeLessThan(1e-9);
        expect(Math.abs(got.tx)).toBeLessThan(1e-9);
        expect(Math.abs(got.ty)).toBeLessThan(1e-9);
      }),
    );
  });

  it("fits at least as well as no correction, inside its clamp", () => {
    fc.assert(
      fc.property(spread, fc.array(pt, { minLength: 12, maxLength: 12 }), aspect, (from, noise, a) => {
        const pairs = from.map((p, i) => ({ from: p, to: { x: p.x + (noise[i]!.x - 0.5) * 0.02, y: p.y + (noise[i]!.y - 0.5) * 0.02 } }));
        expect(error(fitCorrection(pairs, a), pairs, a)).toBeLessThanOrEqual(error(IDENTITY_FIT, pairs, a) + 1e-12);
      }),
    );
  });

  it("stays inside its clamp and finite, whatever it is given", () => {
    fc.assert(
      fc.property(anyPairs, fc.oneof(aspect, wild), (pairs, a) => {
        const got = fitCorrection(pairs, a);
        for (const v of [got.s, got.tx, got.ty]) expect(Number.isFinite(v)).toBe(true);
        expect(got.s).toBeGreaterThanOrEqual(1 / FIT_SCALE_LIMIT);
        expect(got.s).toBeLessThanOrEqual(FIT_SCALE_LIMIT);
        // The middle of the good points moves by at most the shift limit.
        const ok = (v: number) => Number.isFinite(v) && Math.abs(v) < 1e3;
        const good = pairs.filter((p) => [p.from.x, p.from.y, p.to.x, p.to.y].every(ok)).map((p) => p.from);
        if (good.length > 0 && Number.isFinite(a) && a > 0) {
          const m = middle(good);
          const moved = correctPoint(got, a, m);
          expect(Math.abs((moved.x - m.x) * a)).toBeLessThanOrEqual(FIT_SHIFT_LIMIT + 1e-9);
          expect(Math.abs(moved.y - m.y)).toBeLessThanOrEqual(FIT_SHIFT_LIMIT + 1e-9);
        }
      }),
    );
  });

  it("does the same on device coordinates as on the picture", () => {
    fc.assert(
      fc.property(correction, aspect, pt, (c, a, p) => {
        const q = correctPoint(c, a, p);
        const n = correctionNdc(c, a);
        expect(Math.abs(n.sx * (p.x * 2 - 1) + n.ox - (q.x * 2 - 1))).toBeLessThan(1e-9);
        expect(Math.abs(n.sy * (1 - p.y * 2) + n.oy - (1 - q.y * 2))).toBeLessThan(1e-9);
      }),
    );
  });
});
