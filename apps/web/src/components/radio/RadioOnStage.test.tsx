import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY } from "../../ui/copy";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import type { RadioPropView, RadioSignal } from "../../ui/radio/types";
import { Stage } from "../avatar/Stage";
import { RADIO_PLACE, RadioOnStage, RadioProp, radioLabel } from "./RadioOnStage";

const OFF: RadioPropView = { power: "off", signal: "silent", open: false };
const on = (signal: RadioSignal, open = false): RadioPropView => ({ power: "on", signal, open });
const noop = () => {};
const draw = (v: RadioPropView, reduced = false) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced={reduced}>
      <RadioOnStage view={v} onPress={noop} />
    </ReducedMotionOverride>,
  );
const drawFailed = (v: RadioPropView) =>
  renderToStaticMarkup(<RadioProp view={v} onPress={noop} reduced={false} failed hover={false} onHover={noop} onFail={noop} />);

const ALL: RadioPropView[] = [OFF, on("tuning"), on("playing"), on("playing", true), on("noSignal", true), on("tapToPlay")];

describe("radioLabel", () => {
  it("names what a press would do", () => {
    expect(radioLabel(OFF)).toBe(COPY.radio.prop.turnOn);
    expect(radioLabel({ ...OFF, open: true })).toBe(COPY.radio.prop.turnOn);
    for (const s of ["silent", "tuning", "playing", "noSignal", "tapToPlay"] as const) {
      expect(radioLabel(on(s))).toBe(COPY.radio.prop.openGlobe);
      expect(radioLabel(on(s, true))).toBe(COPY.radio.prop.closeGlobe);
    }
  });
});

describe("RadioOnStage", () => {
  it("is always there: one canvas under one real button, in every state", () => {
    for (const v of ALL) {
      const html = draw(v);
      expect(html.match(/<canvas /g)).toHaveLength(1);
      expect(html.match(/<button /g)).toHaveLength(1);
      expect(html).toContain('type="button"');
      expect(html).toContain('data-radio-canvas=""');
      expect(html).toContain('data-radio-still="false"');
      expect(html).toMatch(/<canvas [^>]*aria-hidden="true"/);
      expect(html).not.toContain("<svg");
    }
  });

  it("labels the button by what a press would do, and says whether the globe is open", () => {
    for (const v of ALL) {
      const html = draw(v);
      expect(html).toContain(`aria-label="${radioLabel(v)}"`);
      expect(html).toContain(`aria-expanded="${v.open ? "true" : "false"}"`);
      expect(html).toContain('aria-haspopup="dialog"');
    }
  });

  it("gives the button a 44 px target and the house focus ring", () => {
    const html = draw(OFF);
    const cls = html.match(/<button [^>]*class="([^"]*)"/)![1]!;
    for (const c of ["min-h-11", "min-w-11", "focus-visible:outline-2", "focus-visible:outline-brass-hi", "absolute", "inset-0"]) expect(cls.split(" ")).toContain(c);
  });

  it("is the same three.js radio under Reduced_Motion, held still", () => {
    const html = draw(on("playing"), true);
    expect(html.match(/<canvas /g)).toHaveLength(1);
    expect(html).toContain('data-radio-still="true"');
  });

  it("shows a word in the chip style when it can't be drawn, with the same label", () => {
    for (const v of ALL) {
      const html = drawFailed(v);
      expect(html).not.toContain("<canvas");
      expect(html).toContain(`>${COPY.radio.prop.fallback}</button>`);
      expect(html).toContain(`aria-label="${radioLabel(v)}"`);
      const cls = html.match(/<button [^>]*class="([^"]*)"/)![1]!.split(" ");
      for (const c of ["rounded-chip", "border-brass/70", "text-brass", "min-h-11", "min-w-11"]) expect(cls).toContain(c);
    }
  });

  it("stands on the stage without taking room", () => {
    const html = renderToStaticMarkup(
      <Stage reduced={false} aside={<RadioOnStage view={OFF} onPress={noop} />}>
        <div />
      </Stage>,
    );
    expect(html).toMatch(/data-radio=""[^>]*class="absolute /);
    for (const c of RADIO_PLACE.split(" ")) expect(html).toContain(c);
  });
});

describe("the radio's files", () => {
  it("keep three.js out of the page's first load: only the engine's import() reaches radio/three/", () => {
    for (const file of ["RadioOnStage.tsx", "ThreeRadio.tsx"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src).not.toMatch(/from "three/);
      for (const line of src.split(/\r?\n/).filter((l) => /from "\.\/three\//.test(l))) expect(line).toMatch(/^import type /);
    }
    expect(readFileSync(join(__dirname, "ThreeRadio.tsx"), "utf8").match(/import\("\.\/three\/engine"\)/g)).toHaveLength(1);
    expect(readFileSync(join(__dirname, "RadioOnStage.tsx"), "utf8")).not.toMatch(/import\(/);
  });

  it("hold no drawn radio: no SVG and no stylesheet", () => {
    for (const dir of [__dirname, join(__dirname, "three")]) {
      const files = readdirSync(dir);
      expect(files.filter((f) => f.endsWith(".css"))).toEqual([]);
      for (const file of files.filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && /^(RadioOnStage|ThreeRadio|model|motion|engine)\./.test(f))) {
        expect(readFileSync(join(dir, file), "utf8")).not.toMatch(/<svg|<path|<circle|\.svg"|\.png"|\.glb"|\.gltf"/);
      }
    }
  });
});
