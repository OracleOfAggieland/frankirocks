import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING } from "../../ui/copy-landing";
import { Hero } from "./Hero";

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

describe("the hero block", () => {
  it("is the top section and the hero step", () => {
    const html = renderToStaticMarkup(<Hero />);
    expect(html).toMatch(/^<section id="top" data-step-block="hero" aria-labelledby="hero-title"/);
  });

  it("holds the page's only h1 in display type, reading the headline in order", () => {
    const html = renderToStaticMarkup(<Hero />);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    const h1 = /<h1 id="hero-title" class="font-display text-hero text-ink">([\s\S]*)<\/h1>/.exec(html)![1]!;
    const { before, stitched, after } = LANDING.hero.headline;
    expect(text(h1)).toBe(`${before} ${stitched} ${after}`);
  });

  it("sets 'stitched' in italic with a decorative stitched underline", () => {
    const html = renderToStaticMarkup(<Hero />);
    expect(html).toMatch(/<em data-hero-stitched="" class="door-word relative inline-block italic"[^>]*>stitched<span aria-hidden="true" data-stitch-underline=""/);
  });

  it("staggers the words in reading order", () => {
    const html = renderToStaticMarkup(<Hero />);
    const order = [...html.matchAll(/class="door-word[^"]*" style="--i:(\d+)"/g)].map((m) => Number(m[1]));
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("offers the brass way into the lab and the quiet way down to the loop, then the scroll cue", () => {
    const html = renderToStaticMarkup(<Hero />);
    expect(html).toMatch(new RegExp(`<a href="/lab" class="[^"]*mat-brass[^"]*">.*?${LANDING.hero.wake}</a>`));
    expect(html).toMatch(new RegExp(`<a href="#loop" class="[^"]*text-ink-dim[^"]*">${LANDING.hero.tour}<svg`));
    expect(html).toContain(LANDING.hero.scroll);
    expect(html.indexOf(LANDING.hero.scroll)).toBeGreaterThan(html.indexOf(LANDING.hero.tour));
    expect(html).toContain(`>${LANDING.hero.eyebrow}</p>`);
    expect(html.indexOf(LANDING.hero.lede)).toBeGreaterThan(html.indexOf("</h1>"));
  });

  it("shows the scroll cue as a plain mono cue with a down arrow, not a figure", () => {
    const html = renderToStaticMarkup(<Hero />);
    const cue = /<p data-scroll-cue="" class="([^"]*)">([\s\S]*?)<\/p>/.exec(html)!;
    expect(cue[1]).toContain("font-mono");
    expect(cue[1]).toContain("text-ink-dim");
    expect(cue[2]).toMatch(new RegExp(`^${LANDING.hero.scroll}<svg aria-hidden="true"`));
    // The stage's caption is the page's FIG. 1; the hero carries no fig label.
    expect(html).not.toContain("FIG.");
    expect(html).not.toContain("data-fig=");
  });

  it("below 1024 px sits under the stage with tight gaps and no min-height; from 1024 px fills the viewport", () => {
    const cls = /<section id="top"[^>]*class="([^"]*)"/.exec(renderToStaticMarkup(<Hero />))![1]!.split(" ");
    for (const c of ["gap-3", "pt-4", "pb-12", "lg:gap-6", "lg:py-24", "lg:min-h-svh"]) expect(cls, c).toContain(c);
    expect(cls).not.toContain("pt-24");
    expect(cls).not.toContain("min-h-svh");
    // A jump to #top on one column lands at the top of the page, not under the pinned stage.
    expect(cls).toContain("max-lg:scroll-mt-[44svh]");
  });

  it("animates the words only in CSS, with a plain fade under reduced motion", () => {
    const css = readFileSync(join(import.meta.dirname, "landing.css"), "utf8");
    const noPref = css.indexOf("@media (prefers-reduced-motion: no-preference)");
    const reduce = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(noPref).toBeGreaterThan(0);
    expect(css.indexOf("animation: door-materialize")).toBeGreaterThan(noPref);
    expect(css.slice(reduce)).toMatch(/\.door-word \{\s*animation: door-fade/);
  });
});
