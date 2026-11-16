import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY } from "../../ui/copy";
import { createScriptedFeed } from "../../ui/xray/testing/scripted-frames";
import { XRAY_OFF_VIEW, type XrayControls, type XraySignal, type XrayView } from "../../ui/xray/types";
import { HELP, XrayPanel } from "./XrayPanel";

const noop = () => {};
const CONTROLS: XrayControls = { press: noop, close: noop, flip: noop, retry: noop };
const FEED = createScriptedFeed(() => 1000);
const on = (signal: XraySignal, more: Partial<XrayView> = {}): XrayView => ({ power: "on", signal, facing: "user", canFlip: false, cameraOn: true, ...more });
const draw = (view: XrayView, extra: { presentation?: "modal" | "inline"; bones?: "auto" | "none"; reduced?: boolean } = {}) =>
  renderToStaticMarkup(<XrayPanel view={view} feed={FEED} controls={CONTROLS} reduced={extra.reduced ?? false} presentation={extra.presentation} bones={extra.bones} />);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const SIGNALS: XraySignal[] = ["asking", "warming", "searching", "seeing", "filmOnly", "blocked", "noCamera", "paused"];

describe("XrayPanel", () => {
  it("renders nothing while the machine is off", () => {
    expect(draw(XRAY_OFF_VIEW)).toBe("");
  });

  it("is a modal dialog labelled by the screen's title, over a scrim, with the title as its heading", () => {
    const html = draw(on("seeing"));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("data-sheet-scrim");
    const id = /aria-labelledby="([^"]+)"/.exec(html)![1]!;
    expect(html).toMatch(new RegExp(`<h2[^>]*id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    expect(html).toContain(`<span class="sr-only">${esc(COPY.xray.panel.title)}</span>`);
    // The whole screen below 640 px; a centred 4 by 3 frame from 640 px.
    expect(html).toContain("fixed inset-0 flex flex-col sm:inset-auto");
    expect(html).toContain("sm:aspect-[4/3]");
    expect(html).toContain('data-wordmark="header"');
  });

  it("names each signal in a polite live region, with its lamp", () => {
    for (const signal of SIGNALS) {
      const html = draw(on(signal));
      expect(html).toMatch(new RegExp(`aria-live="polite"[^>]*>.*?${esc(COPY.xray.signal[signal]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</p>`));
      expect(html).toContain(`data-xray-lamp="${signal}"`);
    }
  });

  it("always says it is a toy and where the picture stays; hints only while searching", () => {
    for (const signal of SIGNALS) {
      const html = draw(on(signal));
      expect(html).toContain(esc(COPY.xray.panel.note));
      expect(html.includes(esc(COPY.xray.panel.hint))).toBe(signal === "searching");
    }
  });

  it("gives blocked, noCamera, paused and filmOnly their help line and the press that mends it", () => {
    for (const signal of SIGNALS) {
      const html = draw(on(signal));
      const help = HELP[signal];
      if (help === undefined) {
        expect(html).not.toContain("data-xray-help");
        expect(html).not.toContain('data-action="xray-retry"');
        continue;
      }
      expect(html).toContain(esc(help.line));
      expect(html).toContain(`>${esc(signal === "paused" ? COPY.xray.panel.resume : COPY.xray.panel.retry)}</button>`);
    }
  });

  it("offers the flip only when there is another camera, and always a labelled close", () => {
    expect(draw(on("seeing"))).not.toContain('data-action="xray-flip"');
    expect(draw(on("seeing", { canFlip: true }))).toContain(`aria-label="${esc(COPY.xray.panel.flip)}"`);
    expect(draw(on("seeing"))).toContain(`aria-label="${esc(COPY.xray.panel.close)}"`);
  });

  it("plays the picture inline and muted, mirrored for the selfie camera only, under the bones' one hidden canvas", () => {
    const selfie = draw(on("seeing"));
    expect(selfie).toMatch(/<video[^>]*playsInline=""|<video[^>]*playsinline=""/i);
    expect(selfie).toMatch(/<video[^>]*muted=""/);
    expect(selfie).toContain('data-mirrored="true"');
    expect(selfie).toContain("-scale-x-100");
    expect(selfie).toContain(`aria-label="${esc(COPY.xray.panel.picture)}"`);
    expect(selfie.match(/<canvas /g)).toHaveLength(1);
    expect(selfie).toMatch(/<canvas aria-hidden="true"/);
    const back = draw(on("seeing", { facing: "environment" }));
    expect(back).toContain('data-mirrored="false"');
    expect(back).not.toContain("-scale-x-100");
    expect(draw(on("seeing"), { reduced: true })).toContain('data-bones-still="true"');
  });

  it("shows the film alone, with the film-only line, when the bones can't be drawn", () => {
    const html = draw(on("seeing"), { bones: "none" });
    expect(html).not.toContain("<canvas");
    expect(html).toContain(esc(COPY.xray.help.filmOnly));
    expect(html).not.toContain('data-action="xray-retry"');
  });

  it("keeps the film-only line off the glass until a picture is on it", () => {
    expect(draw(on("asking"), { bones: "none" })).not.toContain(esc(COPY.xray.help.filmOnly));
    expect(draw(on("warming"), { bones: "none" })).toContain(esc(COPY.xray.help.filmOnly));
  });

  it("sits in the page flow, not modal, as a specimen tile", () => {
    const html = draw(on("seeing"), { presentation: "inline" });
    expect(html).toContain('data-xray-presentation="inline"');
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain("data-sheet-scrim");
    expect(html).not.toMatch(/class="fixed/);
  });
});

describe("the X-ray screen's files", () => {
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

  it("keep three.js out of the page: only the bones' one import() reaches xray/anatomy/", () => {
    for (const file of ["XrayPanel.tsx", "ThreeBones.tsx"]) {
      const src = read(file);
      expect(src).not.toMatch(/from "three/);
      for (const line of src.split(/\r?\n/).filter((l) => /from "\.\/anatomy\//.test(l))) expect(line).toMatch(/^import type /);
      expect(src).not.toMatch(/import\s+["'][^"']+\.css["']/);
    }
    expect(read("ThreeBones.tsx").match(/import\(\s*["'`]/g)).toHaveLength(1);
    expect(read("ThreeBones.tsx").match(/import\("\.\/anatomy\/engine"\)/g)).toHaveLength(1);
    expect(read("XrayPanel.tsx")).not.toMatch(/import\(\s*["'`]/);
  });

  it("draw no bones in SVG and load no model or picture files: the only SVG is the control glyphs", () => {
    expect(read("ThreeBones.tsx")).not.toMatch(/<svg|<path|<circle/);
    const panel = read("XrayPanel.tsx");
    expect(panel.match(/<svg/g)).toHaveLength(1);
    expect(panel).not.toMatch(/<circle|<ellipse|<rect|<image|<img/);
    const anatomy = readdirSync(join(__dirname, "anatomy")).filter((f) => f.endsWith(".ts"));
    for (const f of anatomy) expect(read(join("anatomy", f))).not.toMatch(/\.(glb|gltf|obj|fbx|png|jpe?g|svg)["']|Loader\(/);
  });

  it("never send, save or record the picture", () => {
    const files = ["XrayPanel.tsx", "ThreeBones.tsx", ...readdirSync(join(__dirname, "anatomy")).filter((f) => f.endsWith(".ts") && !f.includes(".test.")).map((f) => join("anatomy", f))];
    for (const f of files) {
      expect(read(f)).not.toMatch(/MediaRecorder|RTCPeerConnection|toDataURL|toBlob|sendBeacon|localStorage|sessionStorage|indexedDB|\bfetch\(/);
    }
  });
});
