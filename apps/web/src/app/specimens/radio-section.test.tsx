// The radio's specimens (brief 047 part D): the short form on the main Specimens_Page, and every tile on
// /specimens/radio. Rendered without a browser, so no WebGL context, audio or timer runs.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY } from "../../ui/copy";
import { RadioSection } from "./_sections/RadioSection";
import SpecimensPage from "./page.dev";
import RadioSpecimensPage from "./radio/page.dev";

const tileIds = (html: string) => [...html.matchAll(/data-radio-tile="([a-z-]+)"/g)].map((m) => m[1]);
/** The markup of one tile, from its figure to the figure's end. */
const tile = (html: string, id: string) => {
  const at = html.indexOf(`data-radio-tile="${id}"`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf("</figure>", at));
};

describe("Specimens_Page: the radio, short form", () => {
  const main = renderToStaticMarkup(<SpecimensPage />);

  it("sits after the phone and before the bank", () => {
    const at = (id: string) => main.indexOf(`data-section-id="${id}"`);
    expect(at("phone")).toBeGreaterThan(-1);
    expect(at("radio")).toBeGreaterThan(at("phone"));
    expect(at("bank")).toBeGreaterThan(at("radio"));
  });

  it("holds the walk only, with a link to the full page", () => {
    expect(tileIds(main)).toEqual(["walk"]);
    expect(main).toMatch(/<a [^>]*href="\/specimens\/radio"/);
    expect(main).not.toContain("data-radio-say");
    expect(main).not.toContain("data-radio-panel");
  });

  it("matches RadioSection's own short form", () => {
    expect(tileIds(renderToStaticMarkup(<RadioSection full={false} />))).toEqual(["walk"]);
  });
});

describe("/specimens/radio, full form", () => {
  const html = renderToStaticMarkup(<RadioSpecimensPage />);

  it("shows every tile, each a radio specimen", () => {
    expect(tileIds(html)).toEqual(["walk", "live", "off-reduced", "playing-reduced", "no-signal-reduced", "panel-tuning", "panel-no-signal", "panel-tap-to-play", "panel-reduced"]);
    const figures = [...html.matchAll(/<figure ([^>]*)>/g)].map((m) => m[1]!);
    for (const f of figures) expect(f).toContain('data-specimen="radio"');
  });

  it("gives the live tile a line to say the phrase, and the switch to real stations", () => {
    const live = tile(html, "live");
    expect(live).toMatch(/<input[^>]*data-radio-say=""[^>]*placeholder="Franki, you rock"/);
    expect(live).toMatch(/<button type="submit" data-action="radio-say"/);
    expect(live).toContain("Say it to Franki");
    expect(html).toContain("data-radio-sound");
  });

  it("shows each inline panel's signal word, with Try again only where a press can mend it", () => {
    const expected = { "panel-tuning": ["tuning", false], "panel-no-signal": ["noSignal", true], "panel-tap-to-play": ["tapToPlay", true], "panel-reduced": ["playing", false] } as const;
    for (const [id, [signal, retry]] of Object.entries(expected)) {
      const t = tile(html, id);
      expect(t).toContain('data-radio-presentation="inline"');
      expect(t).toContain(`data-radio-signal="${signal}"`);
      expect(t).toContain(`>${COPY.radio.signal[signal]}</span>`);
      expect(t.includes(`>${COPY.radio.panel.retry}</button>`)).toBe(retry);
    }
  });

  it("puts the list in the globe's place in the signal panels, and the still globe under Reduced_Motion", () => {
    for (const id of ["panel-tuning", "panel-no-signal", "panel-tap-to-play"]) {
      expect(tile(html, id)).toContain("data-radio-list");
      expect(tile(html, id)).not.toContain("<canvas");
    }
    const reduced = tile(html, "panel-reduced");
    expect(reduced).not.toContain("data-radio-list");
    expect(reduced).toContain('data-globe-still="true"');
  });
});
