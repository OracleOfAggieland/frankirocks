import { describe, expect, it } from "vitest";
import { levelFrom, rawLevel, smoothLevel } from "./level-math";

describe("level math", () => {
  it("silence is 0", () => {
    expect(rawLevel(new Uint8Array(512).fill(128))).toBe(0);
    expect(levelFrom(new Uint8Array(512).fill(128), 0)).toBe(0);
  });

  it("full scale is 1", () => {
    const square = Uint8Array.from({ length: 512 }, (_, i) => (i % 2 === 0 ? 0 : 255));
    expect(rawLevel(square)).toBe(1);
  });

  it("empty and invalid buffers give 0", () => {
    expect(rawLevel(new Uint8Array(0))).toBe(0);
    expect(rawLevel([128, NaN, 128])).toBe(0);
    expect(rawLevel([128, 300])).toBe(0);
    expect(rawLevel([-1])).toBe(0);
  });

  it("rises fast and falls slowly", () => {
    expect(smoothLevel(0, 1)).toBe(0.5);
    expect(smoothLevel(1, 0)).toBeCloseTo(0.88, 10);
    expect(smoothLevel(NaN, 0.4)).toBeCloseTo(0.2, 10);
  });
});
