import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createElectricityBudget } from "../../ui/electricity-budget";
import { bolt, boltPath, crackle, toPolyline } from "../../ui/electricity";
import { BOLT_BLOOM_FILTER, BOLT_GLOW_FILTER, Electricity, ElectricityView, boltSeed, steadySeed, stillBolt } from "./Electricity";
import { ARC_WAYPOINTS, HAIR, STRIKE_WAYPOINTS } from "./SvgGhost";

/** The core trunk's full width at its widest: twice the ribbon's peak half width. */
const CORE_PEAK = 2.1;
const a = { x: 10, y: 50 };
const b = { x: 90, y: 50 };

/** A budget with no grants left. */
function fullBudget() {
  const budget = createElectricityBudget();
  budget.request();
  budget.request();
  expect(budget.request()).toBeNull();
  return budget;
}

describe("Electricity", () => {
  it("renders nothing with Reduced_Motion on", () => {
    expect(renderToStaticMarkup(<Electricity a={a} b={b} frameTime={0} reduced />)).toBe("");
  });

  it("without a grant draws a still, jagged crackle at both ends, fixed by its seed: no blur, no motion, not a wire", () => {
    const budget = fullBudget();
    const via = [{ x: 50, y: 10 }];
    const at = (frameTime: number, seed = 5) => renderToStaticMarkup(<Electricity a={a} b={b} via={via} frameTime={frameTime} reduced={false} seed={seed} budget={budget} />);
    const html = at(0);
    expect(html).toContain('data-electricity="steady"');
    // The same crackle whatever the Frame_Time, and a different one for another seed.
    expect(at(37)).toBe(html);
    expect(at(5000)).toBe(html);
    expect(at(0, 6)).not.toBe(html);
    const still = stillBolt([a, ...via, b], 5, 4);
    expect(still).toEqual(bolt([a, ...via, b], steadySeed(5), 3));
    // Two jagged arms, one from each end, and not the whole bolt or the straight waypoint line.
    const { arms, branches } = crackle(still, 2);
    expect(arms).toHaveLength(2);
    expect(arms[0][0]).toEqual(a);
    expect(arms[1][0]).toEqual(b);
    for (const arm of arms) {
      expect(arm.length).toBeGreaterThan(3);
      expect(html).toContain(`points="${toPolyline(arm)}"`);
    }
    expect(html).not.toContain(`points="${toPolyline(still.trunk)}"`);
    expect(html).not.toContain('points="10.00,50.00 50.00,10.00 90.00,50.00"');
    expect(html.match(/data-bolt-core="/g)).toHaveLength(2);
    expect((html.match(/data-branch="/g) ?? []).length).toBe(branches.length);
    // Cheap and calm: no filter, no animation class, and faint.
    expect(html).not.toContain("<filter");
    expect(html).not.toContain("filter=");
    expect(html).not.toContain("franki-anim");
    for (const o of html.match(/opacity="([\d.]+)"/g)!.map((s) => Number(/[\d.]+/.exec(s)![0]))) expect(o).toBeLessThanOrEqual(0.7);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("without a grant, a one-leg spark keeps its whole trunk as one arm from its start", () => {
    const html = renderToStaticMarkup(<Electricity a={a} b={b} frameTime={0} reduced={false} seed={2} depth={3} budget={fullBudget()} />);
    const still = stillBolt([a, b], 2, 3);
    expect(html).toContain(`points="${toPolyline(still.trunk)}"`);
    expect(html.match(/data-bolt-core="/g)).toHaveLength(1);
  });

  it("draws a tapered spark core inside a tight and a wide blurred gold bloom, branches and twigs included, using token colours only", () => {
    let shape = bolt([a, b], 3, 4);
    for (let s = 4; shape.twigs.length === 0; s++) shape = bolt([a, b], s, 4);
    const html = renderToStaticMarkup(<ElectricityView waypoints={[a, b]} shape={shape} granted flashKey={3} />);
    expect(html).toContain('data-electricity="bolt"');
    for (const id of [BOLT_GLOW_FILTER, BOLT_BLOOM_FILTER]) {
      expect(html).toMatch(new RegExp(`<filter id="${id}" filterUnits="userSpaceOnUse"[^>]*><feGaussianBlur`));
      expect(html).toContain(`filter="url(#${id})"`);
    }
    const blur = (id: string) => Number(new RegExp(`<filter id="${id}"[^>]*><feGaussianBlur stdDeviation="([\\d.]+)"`).exec(html)![1]);
    expect(blur(BOLT_BLOOM_FILTER)).toBeGreaterThan(blur(BOLT_GLOW_FILTER));
    const glow = /<g data-bolt-glow=""[^>]*>/.exec(html)![0];
    expect(glow).toContain("franki-bolt-flash");
    // The blooms sit under the core.
    expect(html.indexOf("data-bolt-glow")).toBeLessThan(html.indexOf("data-bolt-core"));
    // The core is a filled spark ribbon, at most CORE_PEAK across, narrower than either bloom's gold trunk.
    expect(html).toMatch(/<g fill="var\(--color-spark\)"><path data-bolt-core="" d="M[^"]+Z"/);
    const trunkGlows = [...html.matchAll(/filter="url\(#[\w-]+\)"[^>]*><polyline points="[^"]*" stroke-width="([\d.]+)" fill="none" stroke="var\(--color-gold\)"/g)].map((m) => Number(m[1]));
    expect(trunkGlows).toHaveLength(2);
    for (const w of trunkGlows) expect(w).toBeGreaterThan(CORE_PEAK);
    expect(html.match(/data-branch="/g)?.length).toBe(shape.branches.length);
    expect(html.match(/data-branch-glow="/g)?.length).toBe(2 * shape.branches.length);
    expect(html.match(/data-twig="/g)?.length).toBe(shape.twigs.length);
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

  it("the thinking arc runs bolt to bolt over the top of the head, clear of the hair, branches and twigs included", () => {
    expect(ARC_WAYPOINTS[0].x).toBeLessThan(40);
    expect(ARC_WAYPOINTS.at(-1)!.x).toBeGreaterThan(160);
    for (let s = 0; s < 400; s++) {
      const { trunk, branches, twigs } = bolt(ARC_WAYPOINTS, s, 4);
      const top = trunk.filter((p) => p.x >= 60 && p.x <= 140);
      expect(top.length).toBeGreaterThan(0);
      const overHead = [...top, ...branches.flat(), ...twigs.flat()].filter((q) => q.x >= 60 && q.x <= 140);
      expect(Math.max(...overHead.map((p) => p.y)), `seed ${s}`).toBeLessThan(hairTop);
    }
  });

  it("the wake strikes come down from above onto both neck bolts at once", () => {
    expect(STRIKE_WAYPOINTS).toHaveLength(2);
    const ends = STRIKE_WAYPOINTS.map((w) => w.at(-1)!);
    expect(ends).toEqual([ARC_WAYPOINTS[0], ARC_WAYPOINTS.at(-1)]);
    for (const w of STRIKE_WAYPOINTS) expect(w[0].y).toBeLessThan(0);
  });
});
