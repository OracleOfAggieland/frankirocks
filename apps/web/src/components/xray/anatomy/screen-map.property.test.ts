// The picture-to-screen mapping's invariants (brief 051 part C), written and run red first against a fit that
// contained the picture instead of covering the screen and took any size as given.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { coverFit, ndcScale, pictureToScreen, screenToPicture } from "./screen-map";

const finite = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const aspect = finite(0.2, 5);
const side = finite(1, 4000);
const unit = finite(0, 1);
const anyNumber = fc.oneof(fc.double(), fc.constant(0), fc.constant(-1), fc.constant(Number.NaN), fc.constant(Number.POSITIVE_INFINITY));

const close = (a: number, b: number, scale = 1) => Math.abs(a - b) <= 1e-9 * Math.max(1, scale, Math.abs(a), Math.abs(b));

describe("picture to screen properties", () => {
  it("covers the screen: the drawn picture reaches every edge, and is tight on one axis", () => {
    fc.assert(
      fc.property(aspect, side, side, fc.boolean(), (a, w, h, m) => {
        const fit = coverFit(a, w, h, m);
        const eps = 1e-9 * Math.max(w, h);
        expect(fit.left).toBeLessThanOrEqual(eps);
        expect(fit.top).toBeLessThanOrEqual(eps);
        expect(fit.left + fit.drawnW).toBeGreaterThanOrEqual(w - eps);
        expect(fit.top + fit.drawnH).toBeGreaterThanOrEqual(h - eps);
        expect(close(fit.drawnW, w, w) || close(fit.drawnH, h, h)).toBe(true);
      }),
    );
  });

  it("never stretches the picture, and keeps its centre on the screen's centre", () => {
    fc.assert(
      fc.property(aspect, side, side, fc.boolean(), (a, w, h, m) => {
        const fit = coverFit(a, w, h, m);
        expect(close(fit.drawnW / a, fit.drawnH, fit.drawnH)).toBe(true);
        const c = pictureToScreen(fit, 0.5, 0.5);
        expect(close(c.x, w / 2, w)).toBe(true);
        expect(close(c.y, h / 2, h)).toBe(true);
      }),
    );
  });

  it("mirrors the selfie picture about its middle, and only across", () => {
    fc.assert(
      fc.property(aspect, side, side, unit, unit, (a, w, h, x, y) => {
        const plain = coverFit(a, w, h, false);
        const mirror = coverFit(a, w, h, true);
        const p = pictureToScreen(mirror, x, y);
        const q = pictureToScreen(plain, 1 - x, y);
        expect(close(p.x, q.x, w)).toBe(true);
        expect(close(p.y, q.y, h)).toBe(true);
      }),
    );
  });

  it("goes back the way it came", () => {
    fc.assert(
      fc.property(aspect, side, side, fc.boolean(), unit, unit, (a, w, h, m, x, y) => {
        const fit = coverFit(a, w, h, m);
        const s = pictureToScreen(fit, x, y);
        const back = screenToPicture(fit, s.x, s.y);
        expect(Math.abs(back.x - x)).toBeLessThan(1e-9);
        expect(Math.abs(back.y - y)).toBeLessThan(1e-9);
      }),
    );
  });

  it("agrees with its scale on device coordinates, which the bones' cameras use", () => {
    fc.assert(
      fc.property(aspect, side, side, fc.boolean(), unit, unit, (a, w, h, m, x, y) => {
        const fit = coverFit(a, w, h, m);
        const s = pictureToScreen(fit, x, y);
        const k = ndcScale(fit);
        const ndcX = (s.x / w) * 2 - 1;
        const ndcY = 1 - (s.y / h) * 2;
        expect(Math.abs(ndcX - k.x * (x * 2 - 1))).toBeLessThan(1e-9);
        expect(Math.abs(ndcY - k.y * (1 - y * 2))).toBeLessThan(1e-9);
      }),
    );
  });

  it("gives finite numbers for any sizes at all", () => {
    fc.assert(
      fc.property(anyNumber, anyNumber, anyNumber, fc.boolean(), unit, unit, (a, w, h, m, x, y) => {
        const fit = coverFit(a, w, h, m);
        const s = pictureToScreen(fit, x, y);
        const k = ndcScale(fit);
        for (const v of [fit.drawnW, fit.drawnH, fit.left, fit.top, s.x, s.y, k.x, k.y]) expect(Number.isFinite(v)).toBe(true);
      }),
    );
  });
});
