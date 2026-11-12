import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING } from "../../ui/copy-landing";
import { SECTION_IDS } from "../../ui/landing/steps";
import { Rail } from "./Rail";

const terminals = (html: string) => [...html.matchAll(/<a ([^>]*data-terminal="[^"]*"[^>]*)>/g)].map((m) => m[1]!);
const states = (html: string) => terminals(html).map((a) => /data-state="([^"]*)"/.exec(a)![1]);

describe("the rail", () => {
  it("is a labelled nav, fixed at the left from 1024 px, 56vh tall", () => {
    const html = renderToStaticMarkup(<Rail won={false} />);
    expect(html).toMatch(new RegExp(`<nav aria-label="${LANDING.rail.label}" data-rail="" data-won="false" class="fixed left-6 top-1/2 z-20 hidden h-\\[56vh\\] [^"]*lg:block"`));
  });

  it("has six terminals, one per section in order, each a link with a 44 px target and its label", () => {
    const html = renderToStaticMarkup(<Rail won={false} />);
    const links = terminals(html);
    expect(links.map((a) => /href="([^"]*)"/.exec(a)![1])).toEqual(SECTION_IDS.map((id) => `#${id}`));
    for (const a of links) {
      expect(a).toContain("size-11");
      expect(a).toContain("focus-visible:outline-2");
    }
    for (const t of LANDING.rail.terminals) expect(html).toContain(`>${t.label}</span>`);
  });

  it("lights every terminal up to the reached one, and marks the reached one current", () => {
    const html = renderToStaticMarkup(<Rail won={false} reached={2} />);
    expect(states(html)).toEqual(["lit", "lit", "lit", "dark", "dark", "dark"]);
    expect(html.match(/aria-current="location"/g)).toHaveLength(1);
    expect(html).toMatch(/data-terminal="memory" data-state="lit" aria-current="location"/);
  });

  it("turns the last terminal gold once the switch is thrown", () => {
    const html = renderToStaticMarkup(<Rail won reached={1} />);
    expect(states(html).at(-1)).toBe("gold");
    expect(html).toMatch(/data-post="gold" class="door-post pointer-events-none mat-gold/);
    expect(html).toContain('data-won="true"');
    expect(renderToStaticMarkup(<Rail won={false} reached={5} />)).not.toContain("mat-gold");
  });

  it("shows a label always for the current terminal only where there is room, and on hover or focus", () => {
    const html = renderToStaticMarkup(<Rail won={false} reached={3} />);
    expect(html.match(/min-\[1400px\]:opacity-100/g)).toHaveLength(1);
    expect(html.match(/group-hover:opacity-100 group-focus-visible:opacity-100/g)).toHaveLength(6);
  });

  it("becomes a 2 px progress line under the bar below 1024 px, hidden from assistive tech", () => {
    const html = renderToStaticMarkup(<Rail won={false} />);
    expect(html).toMatch(/<div aria-hidden="true" data-rail-line="" class="pointer-events-none fixed inset-x-0 top-14 z-30 h-0.5 md:top-16 lg:hidden">/);
  });

  it("fills with a glow only when motion is allowed", () => {
    expect(renderToStaticMarkup(<Rail won={false} reduced />)).not.toContain("shadow-ecto-glow");
    expect(renderToStaticMarkup(<Rail won={false} reduced={false} />)).toMatch(/data-rail-fill="" class="[^"]*shadow-ecto-glow/);
  });

  it("starts empty on the server", () => {
    const html = renderToStaticMarkup(<Rail won={false} />);
    expect(html).toMatch(/data-rail-fill="[^"]*" class="[^"]*" style="transform:scaleY\(0\)"/);
  });
});
