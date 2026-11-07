import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createElectricityBudget } from "../../ui/electricity-budget";
import { bolt, boltPath } from "../../ui/electricity";
import { BOLT_GLOW_FILTER, Electricity, ElectricityView, boltSeed } from "./Electricity";
import { ARC_WAYPOINTS, HAIR, STRIKE_WAYPOINTS } from "./SvgGhost";

const a = { x: 10, y: 50 };
const b = { x: 90, y: 50 };

describe("Electricity", () => {
  it("renders nothing with Reduced_Motion on", () => {
    expect(renderToStaticMarkup(<Electricity a={a} b={b} frameTime={0} reduced />)).toBe("");
  });

  it("draws a steady glow along the waypoints without a grant, such as when the budget is full", () => {
    const budget = createElectricityBudget();
    budget.request();
    budget.request();
    expect(budget.request()).toBeNull();
    const html = renderToStaticMarkup(<Electricity a={a} b={b} via={[{ x: 50, y: 10 }]} frameTime={0} reduced={false} budget={budget} />);
    expect(html).toContain('data-electricity="steady"');
    expect(html).toContain('points="10.00,50.00 50.00,10.00 90.00,50.00"');
    expect(html).not.toContain("data-bolt-core");
  });

  it("draws a spark core over a wider, blurred gold glow, branches included, using token colours only", () => {
    const shape = bolt([a, b], 3, 4);
    const html = renderToStaticMarkup(<ElectricityView waypoints={[a, b]} shape={shape} granted flashKey={3} />);
    expect(html).toContain('data-electricity="bolt"');
    expect(html).toMatch(new RegExp(`<filter id="${BOLT_GLOW_FILTER}"[^>]*><feGaussianBlur`));
    const glow = /<g data-bolt-glow=""[^>]*>/.exec(html)![0];
    expect(glow).toContain(`filter="url(#${BOLT_GLOW_FILTER})"`);
    expect(glow).toContain("franki-bolt-flash");
    // The glow sits under the core, and is wider.
    expect(html.indexOf("data-bolt-glow")).toBeLessThan(html.indexOf("data-bolt-core"));
    const width = (re: RegExp) => Number(re.exec(html)![1]);
    expect(width(/data-bolt-glow[\s\S]*?stroke="var\(--color-gold\)" stroke-width="([\d.]+)"/)).toBeGreaterThan(width(/data-bolt-core="" points="[^"]*" fill="none" stroke="var\(--color-spark\)" stroke-width="([\d.]+)"/));
    expect(html.match(/data-branch="/g)?.length).toBe(shape.branches.length);
    expect(html.match(/data-branch-glow="/g)?.length).toBe(shape.branches.length);
    expect(shape.branches.length).toBeGreaterThanOrEqual(1);
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

  it("keeps boltPath's shape for a plain two-point bolt", () => {
    expect(bolt([a, b], 9, 3).trunk).toEqual(boltPath(a, b, (9 + 101) >>> 0, 3));
  });
});

describe("where the avatar's bolts run (Brief 004 item 5)", () => {
  const hairTop = Math.min(...HAIR.match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 1));

  it("the thinking arc runs bolt to bolt over the top of the head, clear of the hair", () => {
    expect(ARC_WAYPOINTS[0].x).toBeLessThan(40);
    expect(ARC_WAYPOINTS.at(-1)!.x).toBeGreaterThan(160);
    for (let s = 0; s < 400; s++) {
      const { trunk } = bolt(ARC_WAYPOINTS, s, 4);
      const top = trunk.filter((p) => p.x >= 60 && p.x <= 140);
      expect(top.length).toBeGreaterThan(0);
      for (const p of top) expect(p.y, `seed ${s}`).toBeLessThan(hairTop);
    }
  });

  it("the wake strikes come down from above onto both neck bolts at once", () => {
    expect(STRIKE_WAYPOINTS).toHaveLength(2);
    const ends = STRIKE_WAYPOINTS.map((w) => w.at(-1)!);
    expect(ends).toEqual([ARC_WAYPOINTS[0], ARC_WAYPOINTS.at(-1)]);
    for (const w of STRIKE_WAYPOINTS) expect(w[0].y).toBeLessThan(0);
  });
});
