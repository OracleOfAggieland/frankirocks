import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import { Backdrop } from "./Backdrop";

const lab = renderToStaticMarkup(<Backdrop />);
const door = renderToStaticMarkup(<Backdrop variant="door" />);

/** The scenery group names, each once (the fig labels sit in one group per depth). */
const groups = (html: string) => [...new Set([...html.matchAll(/data-scenery="([a-z]+)"/g)].map((m) => m[1]))];
const layers = (html: string) => [...html.matchAll(/data-layer="([a-z]+)"/g)].map((m) => m[1]);
/** The opening tag of a scenery group. */
const groupTag = (html: string, name: string) => html.match(new RegExp(`<g[^>]*data-scenery="${name}"[^>]*>`))?.[0] ?? "";
/** The opening tags of every scenery group with this name. */
const groupTags = (html: string, name: string) => [...html.matchAll(new RegExp(`<g[^>]*data-scenery="${name}"[^>]*>`, "g"))].map((m) => m[0]);
const pathCommands = (html: string) =>
  [...html.matchAll(/ d="([^"]*)"/g)].reduce((n, m) => n + (m[1].match(/[MLHVQCAZ]/gi)?.length ?? 0), 0);

describe("Backdrop", () => {
  it("keeps the backdrop and its three textures, with the scenery above the grid and under the vignette", () => {
    for (const html of [lab, door]) {
      expect(html).toContain('data-backdrop=""');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("pointer-events-none");
      expect(layers(html)).toEqual(["grid", "scenery", "grain", "vignette"]);
    }
  });

  it("is the full room by default", () => {
    expect(lab).toContain('data-variant="lab"');
    expect(groups(lab).sort()).toEqual(["bench", "cables", "figs", "floor", "shelf", "slab", "web"]);
    expect(lab.match(/data-fig="/g)).toHaveLength(4);
  });

  it("keeps only the cables, the web and the floor line at the door, with no fig label", () => {
    expect(door).toContain('data-variant="door"');
    expect(groups(door).sort()).toEqual(["cables", "floor", "web"]);
    // The door's top bar, nav and hero sit where the mains label would hang, so the door draws none.
    expect(door).not.toMatch(/data-fig="/);
    expect(door).not.toContain("<text");
    expect(lab).toContain("FIG. 1 · the mains");
  });

  it("hangs the cables, the mains label and the web from the top of the screen, and keeps the slab movable", () => {
    const topOf = (html: string) => html.match(/<g[^>]*data-crop="top"[^>]*>[\s\S]*?<g[^>]*data-crop="corner"/)?.[0] ?? "";
    for (const html of [lab, door]) {
      expect(topOf(html)).toContain('data-scenery="cables"');
      expect(html).toMatch(/data-crop="corner"[^>]*><g[^>]*data-scenery="web"/);
    }
    expect(topOf(lab)).toContain('data-fig="1"');
    // The mains words hang below the header rail: 124 px down at 1440 by 900, where one unit is one px.
    expect(topOf(lab)).toMatch(/<text[^>]*y="124"/);
    // FIG. 3 and FIG. 4 are in the near depth with the slab and bench.
    const near = lab.slice(lab.indexOf('data-depth="near"'));
    for (const n of ["3", "4"]) expect(near).toContain(`data-fig="${n}"`);
    // On phones the slab's width dimension goes, so no stray rule is left across the screen.
    expect(lab.match(/<g[^>]*data-scenery="slab"[\s\S]*?<\/g>/)?.[0]).toMatch(/<path[^>]*class="max-sm:hidden"/);
  });

  it("is one 1440 by 900 drawing that covers the screen from the bottom up", () => {
    expect(lab.match(/<svg[^>]*data-layer="scenery"[^>]*>/)?.[0]).toMatch(/viewBox="0 0 1440 900"/);
    expect(lab).toContain('preserveAspectRatio="xMidYMax slice"');
    expect(lab).toContain("mat-blueprint");
  });

  it("drops the shelf and bench below 1024 px and keeps only the floor and slab below 640 px", () => {
    for (const g of ["shelf", "bench"]) expect(groupTag(lab, g)).toContain("max-lg:hidden");
    for (const g of ["cables", "web", "figs"]) for (const tag of groupTags(lab, g)) expect(tag).toContain("max-sm:hidden");
    for (const g of ["floor", "slab"]) expect(groupTag(lab, g)).not.toMatch(/max-(sm|lg):hidden/);
    // The shelf and bench labels go with the shelf and bench.
    for (const n of ["2", "4"]) expect(lab.match(new RegExp(`<g[^>]*data-fig="${n}"[^>]*>`))?.[0]).toContain("max-lg:hidden");
  });

  it("is linework only: no fill, near things at 55% or less, far things about 30%", () => {
    const opacity = (name: string) => Math.max(...groupTags(lab, name).map((t) => Number(t.match(/opacity="([\d.]+)"/)?.[1])));
    for (const g of ["shelf", "bench", "cables", "web", "floor", "slab", "figs"]) expect(opacity(g)).toBeLessThanOrEqual(0.55);
    for (const g of ["shelf", "cables", "web"]) expect(opacity(g)).toBeLessThanOrEqual(0.35);
    expect(lab).not.toMatch(/ fill="(?!none)/);
    expect(lab).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(lab).not.toMatch(/filter="url\(#(?!franki-grain)/);
  });

  it("stays small: well under 300 path commands", () => {
    expect(pathCommands(lab)).toBeLessThan(260);
    expect(lab.match(/<(ellipse|circle)\b/g)!.length).toBeLessThan(45);
    expect(pathCommands(door)).toBeLessThan(pathCommands(lab));
  });

  it("moves in two depths and sits still on the server and under reduced motion", () => {
    const calm = renderToStaticMarkup(
      <ReducedMotionOverride reduced>
        <Backdrop />
      </ReducedMotionOverride>,
    );
    for (const html of [lab, calm]) {
      expect(html).toContain('data-depth="far"');
      expect(html).toContain('data-depth="near"');
      expect(html).not.toMatch(/translate[XY]?\((?!0)/);
    }
  });

  it("labels its figures in mono with ink-dim words, never stitch text", () => {
    const texts = [...lab.matchAll(/<text[^>]*>/g)].map((m) => m[0]);
    expect(texts).toHaveLength(4);
    for (const t of texts) {
      expect(t).toContain("fill-ink-dim");
      expect(t).toContain("font-mono");
    }
  });
});
