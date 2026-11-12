import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING } from "../../ui/copy-landing";
import { STAGGER } from "../../ui/motion";
import { GLYPHS, HouseRules, plaqueTransition, plaqueVariants } from "./HouseRules";

const CSS = readFileSync(join(__dirname, "lower.css"), "utf8");
const html = () => renderToStaticMarkup(<HouseRules />);
const esc = (t: string) => t.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("HouseRules", () => {
  it("is the #rules section, titled by its h2, with no h1", () => {
    const out = html();
    expect(out).toMatch(/<section id="rules" aria-labelledby="rules-title"/);
    expect(out).toContain(`id="rules-title"`);
    expect(out).toContain(LANDING.sections.rules.title);
    expect(out).not.toContain("<h1");
  });

  it("shows the six rules in order, each numbered on a brass plate", () => {
    const out = html();
    const ids = [...out.matchAll(/data-rule="([a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(LANDING.rules.map((r) => r.id));
    const plates = [...out.matchAll(/data-plate="brass"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(plates).toEqual(["01", "02", "03", "04", "05", "06"]);
    for (const r of LANDING.rules) {
      expect(out).toContain(`<h3 class="text-lg text-ink">${esc(r.title)}</h3>`);
      expect(out).toContain(esc(r.body));
    }
  });

  it("lays the plaques out one, two and three across", () => {
    expect(html()).toMatch(/<ol[^>]*class="[^"]*\bgrid-cols-1\b[^"]*\bsm:grid-cols-2\b[^"]*\blg:grid-cols-3\b/);
  });

  it("makes each plaque glass with four rivets and a decorative glyph of its own", () => {
    const out = html();
    const plaques = out.split('data-plaque=""').slice(1);
    expect(plaques).toHaveLength(6);
    for (const p of plaques) {
      const body = p.split("</li>")[0];
      expect(body.match(/data-rivet=""/g)).toHaveLength(4);
      expect(body).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-glyph=/);
    }
    expect(out).toMatch(/data-plaque=""[^>]*class="[^"]*\bmat-glass\b/);
    expect(Object.keys(GLYPHS).sort()).toEqual(LANDING.rules.map((r) => r.id).sort());
  });

  it("reads in full with scripting off: nothing starts hidden", () => {
    expect(html()).not.toMatch(/opacity:\s*0/);
  });

  it("materializes on STAGGER across a row, and hides at once while out of view", () => {
    expect(plaqueTransition(false, "waiting", 4)).toEqual({ type: false });
    expect(plaqueTransition(false, "seen", 0).delay).toBe(0);
    expect(plaqueTransition(false, "seen", 1).delay).toBeCloseTo(STAGGER / 1000);
    expect(plaqueTransition(false, "seen", 5).delay).toBeCloseTo((2 * STAGGER) / 1000);
    expect(plaqueTransition(false, "seen", 3).delay).toBe(0);
  });

  it("rises, fades in and unblurs, drops the filter once settled (the glass keeps its backdrop), and only fades under reduced motion", () => {
    const full = plaqueVariants(false);
    expect(full.hidden).toEqual({ opacity: 0, y: 12, filter: "blur(6px)" });
    expect(full.shown).toEqual({ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } });
    // Settled, as the server draws it, no blur is left on the plaque.
    expect(html()).not.toMatch(/filter:\s*blur/);
    const calm = plaqueVariants(true);
    expect(calm.hidden).toEqual({ opacity: 0 });
    expect(calm.shown).toEqual({ opacity: 1 });
  });

  it("lifts a plaque 2 px on hover only with motion allowed, and turns its glyph brass-hi", () => {
    expect(CSS).toMatch(/\.lower-glyph \{\s*color: var\(--color-stitch\)/);
    expect(CSS).toMatch(/\.lower-plaque:hover \.lower-glyph \{\s*color: var\(--color-brass-hi\)/);
    expect(CSS).toMatch(/@media \(hover: hover\) and \(prefers-reduced-motion: no-preference\) \{\s*\.lower-plaque:hover \{\s*transform: translateY\(-2px\)/);
    expect(CSS).toMatch(/\[data-reduced="true"\] \.lower-plaque:hover \{\s*transform: none/);
  });
});
