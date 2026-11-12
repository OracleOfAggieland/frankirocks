import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING } from "../../ui/copy-landing";
import { TopBar } from "./TopBar";

const anchors = (html: string) => [...html.matchAll(/<a ([^>]*)>/g)].map((m) => m[1]!);

describe("the front door's top bar", () => {
  it("is fixed, 64 px tall and 56 px below 768 px", () => {
    const html = renderToStaticMarkup(<TopBar />);
    expect(html).toMatch(/<header data-landing-bar="" data-scrolled="false" class="fixed inset-x-0 top-0 z-30 h-14 md:h-16"/);
  });

  it("puts the skip link first, then the wordmark to the top, the four links, and Wake Franki to the lab", () => {
    const html = renderToStaticMarkup(<TopBar />);
    const links = anchors(html);
    expect(links[0]).toContain('href="#story"');
    expect(html).toContain(`>${LANDING.bar.skip}</a>`);
    expect(links[1]).toContain('href="#top"');
    expect(links[1]).toContain(`aria-label="${LANDING.bar.home}"`);
    expect(links.slice(2, 6).map((a) => /href="([^"]*)"/.exec(a)![1])).toEqual(LANDING.bar.links.map((l) => `#${l.id}`));
    expect(links[6]).toContain('href="/lab"');
    expect(links[6]).toContain("mat-brass");
    expect(html).toContain(`${LANDING.bar.wake}</a>`);
    expect(links).toHaveLength(7);
  });

  it("shows the section links only from 768 px", () => {
    const html = renderToStaticMarkup(<TopBar />);
    expect(html).toMatch(/<nav aria-label="[^"]+" class="ml-auto hidden items-center md:flex lg:gap-1">/);
  });

  it("gives every link a 44 px target and a focus ring", () => {
    for (const a of anchors(renderToStaticMarkup(<TopBar />))) {
      expect(a).toMatch(/min-h-11/);
      expect(a).toContain("focus-visible:outline-2");
    }
  });

  it("is clear at the top and glass with a seam once scrolled", () => {
    const top = renderToStaticMarkup(<TopBar scrolled={false} />);
    expect(top).toMatch(/data-bar-glass="" class="mat-glass [^"]*opacity-0"/);
    expect(top).toMatch(/data-bar-seam="" class="door-seam [^"]*opacity-0"/);
    const down = renderToStaticMarkup(<TopBar scrolled />);
    expect(down).toContain('data-scrolled="true"');
    expect(down).toMatch(/data-bar-glass="" class="mat-glass [^"]*opacity-100"/);
    expect(down).toMatch(/data-bar-seam="" class="door-seam [^"]*opacity-100"/);
  });

  it("keeps the glass and seam on with scripting off", () => {
    const html = renderToStaticMarkup(<TopBar />);
    expect(html).toContain("<noscript><style>[data-bar-glass],[data-bar-seam]{opacity:1}</style></noscript>");
  });

  it("drops the underline's grow under reduced motion", () => {
    const html = renderToStaticMarkup(<TopBar section="loop" />);
    const links = [...html.matchAll(/<a href="#(?:loop|memory|rules|build)"[^>]*>/g)];
    expect(links.length).toBeGreaterThan(0);
    for (const m of links) expect(m[0]).toContain("motion-reduce:after:transition-none");
  });

  it("marks the reached section's link as the current location", () => {
    const html = renderToStaticMarkup(<TopBar section="memory" />);
    expect(html.match(/aria-current="location"/g)).toHaveLength(1);
    expect(html).toMatch(/href="#memory" aria-current="location"/);
    expect(renderToStaticMarkup(<TopBar section="top" />)).not.toContain("aria-current");
  });

  it("keeps its decoration hidden from assistive tech", () => {
    const html = renderToStaticMarkup(<TopBar />);
    for (const m of html.matchAll(/<svg [^>]*>/g)) expect(m[0]).toContain('aria-hidden="true"');
  });
});
