import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING } from "../../ui/copy-landing";
import { STEP_IDS } from "../../ui/landing/steps";
import { Story } from "./Story";

const blocks = (html: string) => [...html.matchAll(/<article ([^>]*)>/g)].map((m) => m[1]!);

describe("the story", () => {
  it("has one block per step after the hero, in scroll order", () => {
    const html = renderToStaticMarkup(<Story step="hero" />);
    expect(blocks(html).map((a) => /data-step-block="([^"]*)"/.exec(a)![1])).toEqual(STEP_IDS.filter((id) => id !== "hero"));
  });

  it("puts a section intro before the first loop step and the first memory step", () => {
    const html = renderToStaticMarkup(<Story step="hero" />);
    for (const [section, first] of [
      ["loop", "noticed"],
      ["memory", "jar"],
    ] as const) {
      const intro = html.indexOf(`id="${section}-title"`);
      expect(intro, section).toBeGreaterThan(html.indexOf(`<section id="${section}"`));
      expect(intro, section).toBeLessThan(html.indexOf(`data-step-block="${first}"`));
      expect(html).toContain(`>${LANDING.sections[section].title}</h2>`);
    }
  });

  it("is a viewport per block from 1024 px and 70svh below", () => {
    for (const a of blocks(renderToStaticMarkup(<Story step="hero" />))) {
      expect(a).toContain("min-h-[70svh]");
      expect(a).toContain("lg:min-h-[85svh]");
    }
  });

  it("is full strength everywhere until the page has measured itself", () => {
    const html = renderToStaticMarkup(<Story step="approve" />);
    expect(html).not.toContain("opacity-35");
  });

  it("then holds the active block at full strength and the rest at 35%", () => {
    const list = blocks(renderToStaticMarkup(<Story step="approve" dim />));
    for (const a of list) {
      const active = a.includes('data-step-block="approve"');
      expect(a).toContain(`data-active="${active}"`);
      expect(a).toContain(active ? "opacity-100" : "opacity-35");
    }
  });

  it("sets the kicker in brass mono, the title in display type at 44, the body in ink-dim at 20", () => {
    const html = renderToStaticMarkup(<Story step="hero" />);
    const copy = LANDING.steps.noticed;
    expect(html).toContain(`<p class="font-mono text-xs tracking-[0.08em] text-brass">${copy.kicker}</p>`);
    expect(html).toMatch(new RegExp(`<h3 id="step-noticed-title" class="font-display text-display [^"]*">${copy.title}</h3>`));
    expect(html).toContain(`<p class="max-w-[30rem] text-lg text-ink-dim">${copy.body}</p>`);
  });

  it("quotes what Franki says with a stitched edge, and shows hints in mono", () => {
    const html = renderToStaticMarkup(<Story step="hero" />);
    expect(html).toContain(`<blockquote data-says="" class="door-says max-w-[30rem] text-lg text-ink"><p>${LANDING.steps.suggested.says}</p></blockquote>`);
    expect(html.match(/<blockquote/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`font-mono text-xs text-ink-dim"><svg[^>]*aria-hidden="true"[\\s\\S]*?</svg>${LANDING.steps.approve.hint}</p>`));
  });

  it("keeps headings in order: the first step under the hero is an h2, the rest sit under their section's h2", () => {
    const html = renderToStaticMarkup(<Story step="hero" />);
    expect(html).toMatch(/<h2 id="step-talk-title"/);
    expect(html.match(/<h3 /g)).toHaveLength(STEP_IDS.length - 2);
    expect(html).not.toContain("<h1");
  });

  it("lands anchor jumps under the pinned stage below 1024 px", () => {
    const html = renderToStaticMarkup(<Story step="hero" />);
    expect(html).toMatch(/<section id="loop" aria-labelledby="loop-title" class="flex flex-col max-lg:scroll-mt-\[44svh\]">/);
  });
});
