// The X-ray's specimens (brief 051 part D): the link-only short form on the main Specimens_Page, every tile on
// /specimens/xray, and the machine's states on /specimens/xray/machine. Rendered without a browser, so no WebGL
// context, camera, tracker or timer runs.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY } from "../../ui/copy";
import { scriptedFrame } from "../../ui/xray/testing/scripted-frames";
import { XraySection, foundWords, pictureAddress } from "./_sections/XraySection";
import SpecimensPage from "./page.dev";
import XrayMachineSpecimensPage from "./xray/machine/page.dev";
import XraySpecimensPage from "./xray/page.dev";

const tileIds = (html: string) => [...html.matchAll(/data-xray-tile="([a-z-]+)"/g)].map((m) => m[1]);
/** The markup of one tile, from its figure to the figure's end. */
const tile = (html: string, id: string) => {
  const at = html.indexOf(`data-xray-tile="${id}"`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf("</figure>", at));
};

describe("Specimens_Page: the X-ray, short form", () => {
  const main = renderToStaticMarkup(<SpecimensPage />);

  it("sits after the radio and before the bank", () => {
    const at = (id: string) => main.indexOf(`data-section-id="${id}"`);
    expect(at("radio")).toBeGreaterThan(-1);
    expect(at("xray")).toBeGreaterThan(at("radio"));
    expect(at("bank")).toBeGreaterThan(at("xray"));
  });

  it("holds links only, so it adds no WebGL context to a page near the limit", () => {
    const section = main.slice(main.indexOf('data-section-id="xray"'), main.indexOf('data-section-id="bank"'));
    expect(section).not.toContain("<figure");
    expect(section).not.toContain("<canvas");
    for (const href of ["/specimens/xray", "/specimens/xray/machine", "/specimens/xray/view"]) expect(section).toContain(`href="${href}"`);
    expect(tileIds(renderToStaticMarkup(<XraySection full={false} />))).toEqual([]);
  });
});

describe("/specimens/xray, full form", () => {
  const html = renderToStaticMarkup(<XraySpecimensPage />);

  it("walks the whole thing, offers the live tile, and places part B's short section", () => {
    expect(tileIds(html)).toEqual(["walk", "live", "walk", "fallback-off", "fallback-on"]);
    expect(html).toContain('data-section-id="xray-prop"');
    expect(html).not.toContain('data-section-id="xray-prop-states"');
  });

  it("walks from off, with the machine's real button beside the ghost and the screen closed", () => {
    const walk = tile(html, "walk");
    expect(walk).toContain('data-xray-walk="dark"');
    expect(walk).toMatch(/<button[^>]*data-xray-button=""[^>]*aria-label="Turn on the X-ray machine"/);
    expect(walk).not.toContain("data-xray-panel");
  });

  it("gives the live tile the real machine, the still picture box, and the store's words, with no camera asked for", () => {
    const live = tile(html, "live");
    expect(live).toMatch(/<button[^>]*data-xray-button=""/);
    expect(live).toContain(`data-xray-live-signal="dark"`);
    expect(live).toContain(`dark (${COPY.xray.signal.dark})`);
    expect(live).not.toContain("data-xray-panel");
    expect(html).toMatch(/<input type="url" data-xray-picture=""/);
    expect(html).toMatch(/<button type="submit" data-action="xray-picture"/);
    expect(html).toContain("served with CORS");
  });

  it("links to the machine's states and the screen's signals", () => {
    expect(html).toContain('href="/specimens/xray/machine"');
    expect(html).toContain('href="/specimens/xray/view"');
  });
});

describe("/specimens/xray/machine", () => {
  const html = renderToStaticMarkup(<XrayMachineSpecimensPage />);

  it("shows the walk and five states at a time, so it keeps to seven contexts", () => {
    expect(tileIds(html)).toEqual(["walk", "fallback-off", "fallback-on", "off", "off-hover", "asking", "warming", "searching"]);
    expect(html).toContain("data-xray-later");
  });
});

describe("the live tile's helpers", () => {
  it("takes an http or https address, made whole against the page, and nothing else", () => {
    const base = "http://localhost:3200/specimens/xray";
    expect(pictureAddress(" https://example.com/a.jpg ", base)).toBe("https://example.com/a.jpg");
    expect(pictureAddress("/face.png", base)).toBe("http://localhost:3200/face.png");
    for (const bad of ["", "   ", "javascript:alert(1)", "data:image/png;base64,AA", "file:///c:/a.png"]) expect(pictureAddress(bad, base)).toBeNull();
  });

  it("says what the tracker found in words", () => {
    expect(foundWords(null)).toEqual({ face: "no frame yet", hands: "no frame yet" });
    const f = scriptedFrame(1000);
    const w = foundWords(f);
    expect(w.face).toMatch(/^found, \d+ points, jaw \d\.\d\d$/);
    expect(w.hands).toBe(f.hands.map((h) => h.side).join(" and "));
    expect(foundWords({ ...f, face: null, hands: [] })).toEqual({ face: "none", hands: "none" });
  });
});
