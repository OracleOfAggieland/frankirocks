import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { advanceRoll, formatCount, layoutOdometer, MAX_PLACES, rollSteps, startRoll } from "./odometer";

const count = fc.integer({ min: 0, max: 999_999_999 });
const maybeCount = fc.option(count, { nil: null });
const places = fc.integer({ min: 1, max: 9 });

/** The text a layout reads as, empty places left out. */
const read = (value: number | null, p: number) =>
  layoutOdometer(value, p)
    .map((c) => (c.kind === "drum" ? String(c.digit) : c.kind === "still" ? c.char : c.kind === "dash" ? "—" : ""))
    .join("");

const slots = (value: number | null, p: number) =>
  layoutOdometer(value, p).map((c) => (c.kind === "drum" || c.kind === "dash" || (c.kind === "empty" && c.slot === "drum") ? "d" : "s")).join("");

describe("odometer properties", () => {
  it("reads back exactly what formatCount says, for every value", () => {
    fc.assert(
      fc.property(fc.oneof(maybeCount, fc.double()), places, (v, p) => {
        expect(read(v, p)).toBe(formatCount(v));
      }),
    );
  });

  it("never shows a digit for a missing value", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(null), fc.constant(NaN), fc.constant(Infinity)), fc.integer({ min: 1, max: MAX_PLACES }), (v, p) => {
        const cells = layoutOdometer(v, p);
        expect(cells.some((c) => c.kind === "drum")).toBe(false);
        expect(cells.filter((c) => c.kind === "dash")).toHaveLength(1);
      }),
    );
  });

  it("keeps the same width and slot kinds for every value that fits the bank", () => {
    fc.assert(
      fc.property(places, maybeCount, maybeCount, (p, a, b) => {
        const cap = 10 ** p;
        const fit = (v: number | null) => (v === null ? null : v % cap);
        expect(slots(fit(a), p)).toBe(slots(fit(b), p));
      }),
    );
  });

  it("rolls each drum at most nine faces, in the direction of the change, and lands on its digit", () => {
    fc.assert(
      fc.property(fc.integer({ min: -500, max: 500 }), fc.integer({ min: 0, max: 9 }), fc.integer({ min: -1, max: 1 }), (turn, digit, dir) => {
        const s = rollSteps(turn, digit, dir);
        expect(Math.abs(s)).toBeLessThanOrEqual(9);
        if (dir >= 0) expect(s).toBeGreaterThanOrEqual(0);
        else expect(s).toBeLessThanOrEqual(0);
        expect((((turn + s) % 10) + 10) % 10).toBe(digit);
      }),
    );
  });

  it("after any run of values, each drum's front face is the digit on show, and the same run gives the same turns", () => {
    fc.assert(
      fc.property(fc.array(maybeCount, { minLength: 1, maxLength: 12 }), places, (values, p) => {
        const run = () => values.reduce((s, v) => advanceRoll(s, v, p), startRoll(values[0], p));
        const end = run();
        for (const cell of layoutOdometer(values.at(-1)!, p)) {
          if (cell.kind !== "drum") continue;
          expect((((end.turns[cell.key] % 10) + 10) % 10)).toBe(cell.digit);
        }
        expect(run()).toEqual(end);
      }),
    );
  });

  it("never turns a drum against the change", () => {
    fc.assert(
      fc.property(count, count, places, (a, b, p) => {
        const before = startRoll(a, p);
        const after = advanceRoll(before, b, p);
        for (const [key, turn] of Object.entries(after.turns)) {
          const was = before.turns[key];
          if (was === undefined) continue;
          if (b >= a) expect(turn).toBeGreaterThanOrEqual(was);
          else expect(turn).toBeLessThanOrEqual(was);
        }
      }),
    );
  });
});
