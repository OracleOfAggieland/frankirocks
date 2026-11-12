import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING } from "../../ui/copy-landing";
import { BODY, HAIR } from "../avatar/SvgGhost";
import { Anatomy, FIGURE, type PartId, TARGETS, VIEW, leaderTop } from "./Anatomy";

const CSS = readFileSync(join(__dirname, "lower.css"), "utf8");
const html = () => renderToStaticMarkup(<Anatomy />);
const IDS = LANDING.build.parts.map((p) => p.id) as PartId[];

describe("Anatomy", () => {
  it("names each part, its feature and its line, under a fig label", () => {
    const out = html();
    const parts = [...out.matchAll(/<li data-part="([a-z]+)"/g)].map((m) => m[1]);
    expect(parts).toEqual(IDS);
    for (const p of LANDING.build.parts) {
      expect(out).toContain(`<h3 class="font-display text-2xl text-ink">${p.part}</h3>`);
      expect(out).toContain(`<p class="font-mono text-xs text-brass">${p.feature}</p>`);
      expect(out).toContain(p.body);
    }
    expect([...out.matchAll(/data-fig="([A-D])"/g)].map((m) => m[1])).toEqual(["A", "B", "C", "D"]);
    expect(out).toContain(`<figcaption class="font-mono text-xs text-ink-dim">${LANDING.build.figure}</figcaption>`);
  });

  it("draws Franki from the SVG ghost's own outlines, as decoration", () => {
    const out = html();
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-anatomy-drawing=""/);
    expect(out).toContain(`d="${BODY}"`);
    expect(out).toContain(`d="${HAIR}"`);
    for (const id of IDS) {
      expect(out).toContain(`data-part-base="${id}"`);
      expect(out).toContain(`data-part-lit="${id}"`);
      expect(out).toContain(`data-leader-for="${id}"`);
    }
  });

  it("lights nothing on the server: every part stays stitch until its callout is seen", () => {
    expect(html()).not.toContain("data-on");
    expect(html()).not.toContain("data-drawing-seen");
  });

  it("in the stacked layout, lights every part from the drawing, in copy order", () => {
    const out = html();
    expect(out).toMatch(/<div data-seen-key="drawing"/);
    IDS.forEach((id, n) => {
      expect(out).toContain(`data-part-lit="${id}" class="anatomy-lit" stroke="var(--color-ecto)" style="--n:${n}"`);
      expect(out).toContain(`data-leader-for="${id}" style="--n:${n}"`);
    });
    const stacked = CSS.split("@container (width < 58rem) {")[1] ?? "";
    expect(stacked).toMatch(/\[data-drawing-seen\] \[data-part-lit\],\s*\[data-drawing-seen\] \[data-leader-for\] \{\s*--lit-step: var\(--n, 0\)/);
    expect(stacked).toMatch(/\[data-drawing-seen\] \.anatomy-lit \{\s*opacity: 0\.9/);
    expect(stacked).toMatch(/\[data-anatomy\] \[data-drawing-seen\] \.anatomy-leader \{\s*transform: none;\s*opacity: 1/);
    expect(CSS).toMatch(/\.anatomy-lit \{\s*opacity: 0;\s*transition: opacity var\(--dur-ritual\) var\(--ease-ecto\) calc\(var\(--stagger\) \* 3 \* var\(--lit-step, 0\)\)/);
  });

  it("points Skeleton and Brain from the left, Reflexes and Immune system from the right", () => {
    expect(TARGETS.skeleton.side).toBe("left");
    expect(TARGETS.brain.side).toBe("left");
    expect(TARGETS.reflexes.side).toBe("right");
    expect(TARGETS.immune.side).toBe("right");
    expect(TARGETS.skeleton.at.x).toBe(100);
  });

  it("keeps every target inside the drawing, and every leader inside the figure", () => {
    for (const id of IDS) {
      const { x, y } = TARGETS[id].at;
      expect(x).toBeGreaterThan(VIEW.x);
      expect(x).toBeLessThan(VIEW.x + VIEW.width);
      expect(y).toBeGreaterThan(VIEW.y);
      expect(y).toBeLessThan(VIEW.y + VIEW.height);
      expect(leaderTop(id)).toBeGreaterThan(0);
      expect(leaderTop(id)).toBeLessThan(100);
    }
  });

  it("spaces the callouts on each side far enough apart not to collide at the narrowest wide layout", () => {
    // The wide layout starts at a 58rem (928 px) container; a callout is at most about 160 px tall there.
    const height = (928 * FIGURE.height) / FIGURE.width;
    const gap = (a: PartId, b: PartId) => (Math.abs(leaderTop(a) - leaderTop(b)) / 100) * height;
    expect(gap("brain", "skeleton")).toBeGreaterThan(160);
    expect(gap("reflexes", "immune")).toBeGreaterThan(140);
    // And the lowest callout still ends inside the figure.
    expect(((100 - Math.max(...IDS.map(leaderTop))) / 100) * height).toBeGreaterThan(150);
  });

  it("draws each leader in only with scripting on, and fades it under reduced motion", () => {
    expect(CSS).toMatch(/@media \(scripting: enabled\) \{\s*\.anatomy-leader:not\(\[data-on\]\) \{\s*transform: scaleX\(0\)/);
    expect(CSS).toMatch(/@media \(scripting: enabled\) and \(prefers-reduced-motion: reduce\) \{\s*\.anatomy-leader:not\(\[data-on\]\) \{\s*transform: none;\s*opacity: 0/);
    expect(CSS).toMatch(/\.anatomy-lit \{\s*opacity: 0;/);
  });
});
