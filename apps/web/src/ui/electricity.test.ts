import { describe, expect, it } from "vitest";
import { createElectricityBudget } from "./electricity-budget";
import { boltPath, regenGapMs, toPolyline } from "./electricity";

describe("Electricity budget", () => {
  it("grants two effects and refuses the third until one is released", () => {
    const budget = createElectricityBudget();
    const a = budget.request();
    const b = budget.request();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(budget.request()).toBeNull();
    budget.release(a!);
    expect(budget.active()).toBe(1);
    expect(budget.request()).not.toBeNull();
    expect(budget.request()).toBeNull();
  });
});

describe("boltPath", () => {
  it("joins the endpoints with 2^depth + 1 points", () => {
    const p = boltPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 7, 3);
    expect(p).toHaveLength(9);
    expect(p[0]).toEqual({ x: 0, y: 0 });
    expect(p[8]).toEqual({ x: 100, y: 0 });
    expect(toPolyline(p.slice(0, 1))).toBe("0.00,0.00");
  });

  it("gives gaps from 60 to 90 ms", () => {
    for (let s = 0; s < 50; s++) {
      expect(regenGapMs(s)).toBeGreaterThanOrEqual(60);
      expect(regenGapMs(s)).toBeLessThanOrEqual(90);
    }
  });
});
