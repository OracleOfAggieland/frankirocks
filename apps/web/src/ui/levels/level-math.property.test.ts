import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbLevel } from "../test-arbitraries";
import { levelFrom, rawLevel, smoothLevel } from "./level-math";

// Feature: lab-ui-foundation, Property 13: Levels stay in bounds
describe("Property 13: Levels stay in bounds", () => {
  const buffers = fc.oneof(
    fc.uint8Array({ minLength: 0, maxLength: 2048 }),
    fc.array(fc.double(), { maxLength: 64 }),
  );
  const inUnit = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;

  it("levelFrom is finite and in 0..1, silence from 0 stays 0, and smoothing never overshoots", () => {
    fc.assert(
      fc.property(buffers, arbLevel, fc.integer({ min: 1, max: 2048 }), (samples, prev, n) => {
        expect(inUnit(levelFrom(samples, prev))).toBe(true);
        expect(levelFrom(new Uint8Array(n).fill(128), 0)).toBe(0);
        const raw = rawLevel(samples);
        // A non-finite prior counts as 0; a finite one outside 0..1 is clamped.
        const p = Number.isFinite(prev) ? Math.min(1, Math.max(0, prev)) : 0;
        const next = smoothLevel(prev, raw);
        expect(next).toBeGreaterThanOrEqual(Math.min(p, raw));
        expect(next).toBeLessThanOrEqual(Math.max(p, raw));
      }),
      { numRuns: 300 },
    );
  });
});
