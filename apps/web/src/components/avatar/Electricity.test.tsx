import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createElectricityBudget } from "../../ui/electricity-budget";
import { boltPath } from "../../ui/electricity";
import { Electricity, ElectricityView, boltSeed } from "./Electricity";

const a = { x: 10, y: 50 };
const b = { x: 90, y: 50 };

describe("Electricity", () => {
  it("renders nothing with Reduced_Motion on", () => {
    expect(renderToStaticMarkup(<Electricity a={a} b={b} frameTime={0} reduced />)).toBe("");
  });

  it("draws a steady glow without a grant, such as when the budget is full", () => {
    const budget = createElectricityBudget();
    budget.request();
    budget.request();
    expect(budget.request()).toBeNull();
    const html = renderToStaticMarkup(<Electricity a={a} b={b} frameTime={0} reduced={false} budget={budget} />);
    expect(html).toContain('data-electricity="steady"');
    expect(html).not.toContain("<polyline");
  });

  it("draws the bolt in spark with a gold glow when granted, using token colours only", () => {
    const html = renderToStaticMarkup(<ElectricityView a={a} b={b} points={boltPath(a, b, 3, 3)} granted />);
    expect(html).toContain('data-electricity="bolt"');
    expect(html).toContain('stroke="var(--color-spark)"');
    expect(html).toContain('stroke="var(--color-gold)"');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("changes the bolt after a 60 to 90 ms stretch of Frame_Time", () => {
    for (let t = 0; t < 3000; t += 7) {
      let end = t;
      while (boltSeed(end, 1) === boltSeed(t, 1)) end++;
      let start = t;
      while (start > 0 && boltSeed(start - 1, 1) === boltSeed(t, 1)) start--;
      if (start > 0) expect(end - start).toBeGreaterThanOrEqual(60);
      expect(end - start).toBeLessThanOrEqual(90);
    }
  });
});
