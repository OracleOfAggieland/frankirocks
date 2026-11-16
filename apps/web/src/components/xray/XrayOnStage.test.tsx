import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY } from "../../ui/copy";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import type { XrayPropView, XraySignal } from "../../ui/xray/types";
import { Stage } from "../avatar/Stage";
import { XRAY_PLACE, XrayOnStage, XrayProp, xrayLabel } from "./XrayOnStage";

const OFF: XrayPropView = { power: "off", signal: "dark" };
const on = (signal: XraySignal): XrayPropView => ({ power: "on", signal });
const noop = () => {};
const draw = (v: XrayPropView, reduced = false) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced={reduced}>
      <XrayOnStage view={v} onPress={noop} />
    </ReducedMotionOverride>,
  );
const drawFailed = (v: XrayPropView) => renderToStaticMarkup(<XrayProp view={v} onPress={noop} reduced={false} failed hover={false} onHover={noop} onFail={noop} />);

const ON_SIGNALS: XraySignal[] = ["asking", "warming", "searching", "seeing", "filmOnly", "blocked", "noCamera", "paused"];
const ALL: XrayPropView[] = [OFF, ...ON_SIGNALS.map(on)];

/** This part's own files: the machine on the stage and its three.js modules. */
const OWN = ["XrayOnStage.tsx", "ThreeXray.tsx", "three/model.ts", "three/motion.ts", "three/engine.ts"];

describe("xrayLabel", () => {
  it("names what a press would do: turn it on while off, and off while on", () => {
    expect(xrayLabel(OFF)).toBe(COPY.xray.prop.turnOn);
    for (const s of ON_SIGNALS) {
      expect(xrayLabel({ power: "off", signal: s })).toBe(COPY.xray.prop.turnOn);
      expect(xrayLabel(on(s))).toBe(COPY.xray.prop.turnOff);
    }
  });
});

describe("XrayOnStage", () => {
  it("is always there: one canvas under one real button, in every state", () => {
    for (const v of ALL) {
      const html = draw(v);
      expect(html.match(/<canvas /g)).toHaveLength(1);
      expect(html.match(/<button /g)).toHaveLength(1);
      expect(html).toContain('type="button"');
      expect(html).toContain('data-xray-button=""');
      expect(html).toContain('data-xray-canvas=""');
      expect(html).toContain('data-xray-still="false"');
      expect(html).toContain(`data-xray-signal="${v.signal}"`);
      expect(html).toMatch(/<canvas [^>]*aria-hidden="true"/);
      expect(html).not.toContain("<svg");
    }
  });

  it("labels the button by what a press would do, and says whether the X-ray screen is open", () => {
    for (const v of ALL) {
      const html = draw(v);
      expect(html).toContain(`aria-label="${xrayLabel(v)}"`);
      expect(html).toContain(`aria-expanded="${v.power === "on" ? "true" : "false"}"`);
      expect(html).toContain('aria-haspopup="dialog"');
    }
  });

  it("gives the button a 44 px target and the house focus ring", () => {
    const cls = draw(OFF).match(/<button [^>]*class="([^"]*)"/)![1]!.split(" ");
    for (const c of ["min-h-11", "min-w-11", "focus-visible:outline-2", "focus-visible:outline-brass-hi", "absolute", "inset-0"]) expect(cls).toContain(c);
  });

  it("is the same three.js machine under Reduced_Motion, held still", () => {
    const html = draw(on("seeing"), true);
    expect(html.match(/<canvas /g)).toHaveLength(1);
    expect(html).toContain('data-xray-still="true"');
  });

  it("shows a word in the chip style when it can't be drawn, with the same label", () => {
    for (const v of ALL) {
      const html = drawFailed(v);
      expect(html).not.toContain("<canvas");
      expect(html).toContain(`>${COPY.xray.prop.fallback}</button>`);
      expect(html).toContain(`aria-label="${xrayLabel(v)}"`);
      const cls = html.match(/<button [^>]*class="([^"]*)"/)![1]!.split(" ");
      for (const c of ["rounded-chip", "border-brass/70", "text-brass", "min-h-11", "min-w-11"]) expect(cls).toContain(c);
    }
  });

  it("stands on the stage without taking room, on the side away from the radio", () => {
    const html = renderToStaticMarkup(
      <Stage reduced={false} aside={<XrayOnStage view={OFF} onPress={noop} />}>
        <div />
      </Stage>,
    );
    expect(html).toMatch(/data-xray=""[^>]*class="absolute /);
    for (const c of XRAY_PLACE.split(" ")) expect(html).toContain(c);
    // The radio stands from the right (at Franki's lower left); the machine stands from the left, its mirror image.
    expect(XRAY_PLACE).toMatch(/(^| )left-\[/);
    expect(XRAY_PLACE).not.toMatch(/(^| )right-\[/);
  });
});

describe("the machine's files", () => {
  it("keep three.js out of the page's first load: only the engine's import() reaches xray/three/", () => {
    for (const file of ["XrayOnStage.tsx", "ThreeXray.tsx"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src).not.toMatch(/from "three/);
      for (const line of src.split(/\r?\n/).filter((l) => /from "\.\/three\//.test(l))) expect(line).toMatch(/^import type /);
    }
    expect(readFileSync(join(__dirname, "ThreeXray.tsx"), "utf8").match(/import\("\.\/three\/engine"\)/g)).toHaveLength(1);
    expect(readFileSync(join(__dirname, "XrayOnStage.tsx"), "utf8")).not.toMatch(/import\(/);
  });

  it("hold no drawn machine: no SVG, no stylesheet, no model or picture files", () => {
    for (const file of OWN) {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src, file).not.toMatch(/<svg|<path|<circle|\.svg"|\.png"|\.jpe?g"|\.glb"|\.gltf"|\.obj"|\.css"|Loader\b/);
    }
  });
});
