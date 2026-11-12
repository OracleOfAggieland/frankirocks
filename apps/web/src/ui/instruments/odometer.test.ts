import { describe, expect, it } from "vitest";
import {
  FACE_DEG,
  advanceRoll,
  digitsIn,
  drumAngle,
  formatCount,
  layoutOdometer,
  normalizeCount,
  placesFor,
  rollSteps,
  startRoll,
  templateFor,
} from "./odometer";

const kinds = (value: number | null, places: number) =>
  layoutOdometer(value, places).map((c) => (c.kind === "drum" ? String(c.digit) : c.kind === "still" ? c.char : c.kind === "dash" ? "—" : c.slot === "drum" ? "_" : " "));

describe("odometer digit maths", () => {
  it("formats counts in en-US and a missing value as a dash, never zero", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(NaN)).toBe("—");
    expect(formatCount(Infinity)).toBe("—");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(-0.2)).toBe("0");
    expect(formatCount(1284.4)).toBe("1,284");
    expect(normalizeCount(-0.4)).toBe(0);
    expect(Object.is(normalizeCount(-0.4), -0)).toBe(false);
  });

  it("lays out a bank of drums with empty leading places", () => {
    expect(templateFor(4)).toBe("0,000");
    expect(templateFor(1)).toBe("0");
    expect(kinds(128, 4)).toEqual(["_", " ", "1", "2", "8"]);
    expect(kinds(1284, 4)).toEqual(["1", ",", "2", "8", "4"]);
    expect(kinds(0, 3)).toEqual(["_", "_", "0"]);
  });

  it("shows a missing value as one blank drum with a dash, and no digit anywhere", () => {
    expect(kinds(null, 3)).toEqual(["_", "_", "—"]);
    expect(layoutOdometer(null, 3).some((c) => c.kind === "drum")).toBe(false);
  });

  it("keys cells by place from the right", () => {
    expect(layoutOdometer(12, 3).map((c) => c.key)).toEqual(["p2", "p1", "p0"]);
    expect(layoutOdometer(12345, 3).map((c) => c.key)).toEqual(["p5", "p4", "p3", "p2", "p1", "p0"]);
  });

  it("picks one place count for a bank", () => {
    expect(placesFor([12, null, 3])).toBe(3);
    expect(placesFor([1284, 7])).toBe(4);
    expect(placesFor([])).toBe(3);
    expect(digitsIn(null)).toBe(1);
    expect(digitsIn(-45)).toBe(2);
  });

  it("rolls forward on a rising count and back on a falling one, the short way round a face at a time", () => {
    expect(rollSteps(9, 0, 1)).toBe(1);
    expect(rollSteps(3, 7, 1)).toBe(4);
    expect(rollSteps(7, 3, -1)).toBe(-4);
    expect(rollSteps(0, 9, -1)).toBe(-1);
    expect(rollSteps(5, 5, 1)).toBe(0);
    expect(rollSteps(-3, 8, 1)).toBe(1);
  });

  it("carries like a counter: 129 to 131, then back to 99", () => {
    let s = startRoll(129, 3);
    expect(s.turns).toEqual({ p0: 9, p1: 2, p2: 1 });
    s = advanceRoll(s, 131, 3);
    expect(s.turns).toEqual({ p0: 11, p1: 3, p2: 1 });
    expect(s.fresh).toEqual([]);
    s = advanceRoll(s, 99, 3);
    expect(s.turns).toEqual({ p0: 9, p1: -1 });
    expect(s.value).toBe(99);
  });

  it("brings a new drum in at its digit, and none from a missing value", () => {
    const s = advanceRoll(startRoll(99, 3), 100, 3);
    expect(s.turns).toEqual({ p0: 10, p1: 10, p2: 1 });
    expect(s.fresh).toEqual(["p2"]);
    const fromNull = advanceRoll(startRoll(null, 3), 12, 3);
    expect(fromNull.turns).toEqual({ p0: 2, p1: 1 });
    expect(fromNull.fresh).toEqual(["p1", "p0"]);
    expect(advanceRoll(fromNull, null, 3).turns).toEqual({});
  });

  it("turns face d to the front at turn d", () => {
    expect(FACE_DEG * 10).toBe(360);
    expect(drumAngle(3)).toBe(108);
  });
});
