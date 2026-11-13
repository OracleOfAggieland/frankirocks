import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY } from "../../ui/copy";
import { RADIO_OFF_VIEW, type RadioControls, type RadioSignal, type RadioView, type Station } from "../../ui/radio/types";
import { RadioPanel, canRetry } from "./RadioPanel";
import { readPalette } from "./ThreeGlobe";

const STATIONS: readonly Station[] = [
  { id: "a1", name: "Rádio Rock & Roll Paulistano Clássico Todo Dia", city: "São Paulo", country: "Brazil", lat: -23.55, lon: -46.63, url: "https://example.test/a.mp3", rock: true },
  { id: "b2", name: "Paris Jazz", city: "Paris", country: "France", lat: 48.86, lon: 2.35, url: "https://example.test/b.mp3", rock: false },
];
const noop = () => {};
const CONTROLS: RadioControls = { press: noop, closePanel: noop, powerOff: noop, tune: noop, step: noop, spin: noop, setVolume: noop, retry: noop };
const open = (signal: RadioSignal, station: Station | null = STATIONS[0]!): RadioView => ({ power: "on", panel: "open", station, signal, volume: 0.8 });
const draw = (view: RadioView, reduced = false) => renderToStaticMarkup(<RadioPanel view={view} stations={STATIONS} controls={CONTROLS} reduced={reduced} />);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

describe("RadioPanel", () => {
  it("renders nothing while the panel is closed", () => {
    expect(draw(RADIO_OFF_VIEW)).toBe("");
    expect(draw({ ...open("playing"), panel: "closed" })).toBe("");
  });

  it("is a dialog with the panel's title, not modal", () => {
    const html = draw(open("playing"));
    expect(html).toContain('role="dialog"');
    expect(html).toContain(`aria-label="${esc(COPY.radio.panel.title)}"`);
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain("data-sheet-scrim");
    expect(html).toMatch(/class="[^"]*\bfixed\b[^"]*\bz-40\b/);
    // Narrow until the radio on the stage stands clear of the full width, and never taller than the screen.
    expect(html).toContain("sm:w-[16rem]");
    expect(html).toContain("min-[1800px]:w-[22rem]");
    expect(html).toContain("sm:max-h-[calc(100dvh-1.5rem)]");
    expect(html).toContain('data-wordmark="header"');
  });

  it("shows each signal's word, with retry only when a press can mend it", () => {
    for (const signal of ["silent", "tuning", "playing", "noSignal", "tapToPlay"] as const) {
      const html = draw(open(signal));
      expect(html).toContain(`>${COPY.radio.signal[signal]}</span>`);
      expect(html).toContain(`data-radio-lamp="${signal}"`);
      expect(html.includes(`>${COPY.radio.panel.retry}</button>`)).toBe(signal === "noSignal" || signal === "tapToPlay");
      expect(canRetry(signal)).toBe(signal === "noSignal" || signal === "tapToPlay");
    }
  });

  it("names the station in a polite live region, truncated with its full name as a title", () => {
    const s = STATIONS[0]!;
    const html = draw(open("playing"));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(`title="${esc(s.name)}"`);
    expect(html).toContain(esc(COPY.radio.panel.place(s.city, s.country)));
  });

  it("shows only the lamp and the signal word with nothing tuned", () => {
    const html = draw(open("silent", null));
    expect(html).not.toContain("data-radio-station");
    expect(html).not.toContain(esc(COPY.radio.panel.place(STATIONS[0]!.city, STATIONS[0]!.country)));
    expect(html).toContain(`>${COPY.radio.signal.silent}</span>`);
  });

  it("labels every control", () => {
    const html = draw(open("playing"));
    for (const label of [COPY.radio.panel.close, COPY.radio.panel.previous, COPY.radio.panel.spin, COPY.radio.panel.next, COPY.radio.panel.volume, COPY.radio.panel.off]) {
      expect(html).toContain(`aria-label="${esc(label)}"`);
    }
    expect(html).toMatch(/<input[^>]*type="range"[^>]*min="0"[^>]*max="1"[^>]*step="0.01"/);
    expect(html).toContain('value="0.8"');
  });

  it("holds the globe as a focusable image over one hidden canvas, still under reduced motion", () => {
    const html = draw(open("playing"));
    expect(html).toContain('role="img"');
    expect(html).toContain(`aria-label="${esc(COPY.radio.panel.globe)}"`);
    expect(html).toMatch(/role="img"[^>]*tabindex="0"|tabindex="0"[^>]*role="img"/);
    expect(html.match(/<canvas /g)).toHaveLength(1);
    expect(html).toMatch(/<canvas aria-hidden="true"/);
    expect(html).toContain("touch-none");
    expect(html).toContain('data-globe-still="false"');
    expect(draw(open("playing"), true)).toContain('data-globe-still="true"');
  });

  it("floats by default, and sits in the page flow when inline", () => {
    expect(draw(open("playing"))).toContain('data-radio-presentation="floating"');
    const inline = renderToStaticMarkup(<RadioPanel view={open("playing")} stations={STATIONS} controls={CONTROLS} reduced={false} presentation="inline" />);
    expect(inline).toContain('data-radio-presentation="inline"');
    expect(inline).not.toMatch(/class="[^"]*\bfixed\b/);
    expect(inline).toContain("w-[22rem]");
    expect(inline).toContain('role="dialog"');
  });

  it("draws the globe by default, and the station list in its place when asked for the list", () => {
    expect(draw(open("playing"))).not.toContain("data-radio-list");
    const list = renderToStaticMarkup(<RadioPanel view={open("playing")} stations={STATIONS} controls={CONTROLS} reduced={false} globe="list" />);
    expect(list).toContain("data-radio-list");
    expect(list).not.toContain("<canvas");
    expect(list).toContain(`aria-label="${esc(COPY.radio.panel.tuneTo(STATIONS[1]!.name, STATIONS[1]!.city))}"`);
    expect(list).toContain(`data-station="${STATIONS[0]!.id}" aria-label="${esc(COPY.radio.panel.tuneTo(STATIONS[0]!.name, STATIONS[0]!.city))}" aria-current="true"`);
  });

  it("reads the map's colours from the CSS tokens, and falls back to the mirror", () => {
    expect(readPalette((n) => (n === "--color-ecto" ? " lime " : ""))).toMatchObject({ coast: "lime" });
    const fallback = readPalette(() => "");
    expect(Object.values(fallback).every((v) => /^#[0-9A-F]{6}$/i.test(v))).toBe(true);
  });
});

describe("the radio panel's files", () => {
  it("keep three.js out of the page: only the engine's one import() reaches radio/globe/", () => {
    for (const file of ["RadioPanel.tsx", "ThreeGlobe.tsx"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src).not.toMatch(/from "three/);
      for (const line of src.split(/\r?\n/).filter((l) => /from "\.\/globe\//.test(l))) expect(line).toMatch(/^import type /);
      expect(src).not.toMatch(/import\s+["'][^"']+\.css["']/);
    }
    // Real import() calls only: a comment may name import() in words.
    expect(readFileSync(join(__dirname, "ThreeGlobe.tsx"), "utf8").match(/import\(\s*["'`]/g)).toHaveLength(1);
    expect(readFileSync(join(__dirname, "ThreeGlobe.tsx"), "utf8").match(/import\("\.\/globe\/engine"\)/g)).toHaveLength(1);
    expect(readFileSync(join(__dirname, "RadioPanel.tsx"), "utf8")).not.toMatch(/import\(\s*["'`]/);
  });

  it("draw no radio or globe in SVG: the only SVG is the control glyphs", () => {
    expect(readFileSync(join(__dirname, "ThreeGlobe.tsx"), "utf8")).not.toMatch(/<svg|<path|<circle/);
    const panel = readFileSync(join(__dirname, "RadioPanel.tsx"), "utf8");
    // One <svg> in the Icon helper, which every control glyph goes through; no circles, no other drawings.
    expect(panel.match(/<svg/g)).toHaveLength(1);
    expect(panel).not.toMatch(/<circle|<ellipse|<rect|<image/);
    expect(readdirSync(__dirname).filter((f) => f.endsWith(".css"))).toEqual([]);
  });
});
