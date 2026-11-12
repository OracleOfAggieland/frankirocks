import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY } from "../../ui/copy";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import type { PhoneView } from "../../ui/phone/phone-call";
import { Stage } from "../avatar/Stage";
import { PHONE_PLACE, PhoneOnStage, phoneCaption } from "./PhoneOnStage";

const view = (phase: PhoneView["phase"], reason: PhoneView["reason"] = null): PhoneView => ({ phase, reason });
const draw = (v: PhoneView, reduced = false) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced={reduced}>
      <PhoneOnStage view={v} />
    </ReducedMotionOverride>,
  );

describe("PhoneOnStage", () => {
  it("draws nothing when there is no call", () => {
    expect(draw(view("absent"))).toBe("");
    expect(draw(view("absent"), true)).toBe("");
  });

  it("is one three.js canvas in every phase, with nothing drawn until its engine runs", () => {
    for (const phase of ["dialing", "ringing", "talking", "ended", "missed"] as const) {
      const html = draw(view(phase, phase === "missed" ? "busy" : null));
      expect(html.match(/<canvas /g)).toHaveLength(1);
      expect(html).toContain('data-phone-canvas=""');
      expect(html).toContain('data-phone-still="false"');
      expect(html).not.toContain("<svg");
    }
  });

  it("is the same three.js phone under Reduced_Motion, held still", () => {
    const html = draw(view("ringing"), true);
    expect(html.match(/<canvas /g)).toHaveLength(1);
    expect(html).toContain('data-phone-still="true"');
    expect(html).not.toContain("<svg");
  });

  it("says what the phone shows, in words under it and to a screen reader", () => {
    const cases: [PhoneView, string, string][] = [
      [view("dialing"), COPY.phone.dialing, COPY.phone.label.dialing],
      [view("ringing"), COPY.phone.ringing, COPY.phone.label.ringing],
      [view("talking"), COPY.phone.talking, COPY.phone.label.talking],
      [view("ended"), COPY.phone.ended, COPY.phone.label.ended],
      [view("missed", "busy"), COPY.phone.missed.busy, COPY.phone.label.missed],
      [view("missed", "noAnswer"), COPY.phone.missed.noAnswer, COPY.phone.label.missed],
      [view("missed", "failed"), COPY.phone.missed.failed, COPY.phone.label.missed],
      [view("missed", "unconfirmed"), COPY.phone.missed.unconfirmed, COPY.phone.label.missed],
    ];
    for (const [v, caption, label] of cases) {
      for (const reduced of [false, true]) {
        const html = draw(v, reduced);
        expect(html).toContain('role="img"');
        expect(html).toContain(`aria-label="${label}"`);
        expect(html).toContain(`>${caption}</span>`);
      }
      expect(phoneCaption(v.phase as Exclude<PhoneView["phase"], "absent">, v.reason)).toBe(caption);
    }
  });

  it("hangs on the stage without taking room or the pointer", () => {
    const html = renderToStaticMarkup(
      <Stage reduced={false} aside={<PhoneOnStage view={view("ringing")} />}>
        <div />
      </Stage>,
    );
    expect(html).toMatch(/data-phone=""[^>]*class="pointer-events-none absolute /);
    for (const c of PHONE_PLACE.split(" ")) expect(html).toContain(c);
    // The stage itself is unchanged by an empty wall.
    const bare = renderToStaticMarkup(<Stage reduced={false}><div /></Stage>);
    const empty = renderToStaticMarkup(<Stage reduced={false} aside={<PhoneOnStage view={view("absent")} />}><div /></Stage>);
    expect(empty).toBe(bare);
  });
});

describe("the phone's files", () => {
  it("keep three.js out of the page until a call is shown: only the engine's import() reaches phone/three/", () => {
    for (const file of ["PhoneOnStage.tsx", "ThreePhone.tsx"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src).not.toMatch(/from "three/);
      for (const line of src.split(/\r?\n/).filter((l) => /from "\.\/three\//.test(l))) expect(line).toMatch(/^import type /);
    }
    expect(readFileSync(join(__dirname, "ThreePhone.tsx"), "utf8").match(/import\("\.\/three\/engine"\)/g)).toHaveLength(1);
  });

  it("hold no drawn phone: no SVG and no stylesheet beside the three.js one", () => {
    const files = readdirSync(__dirname);
    expect(files.filter((f) => f.endsWith(".css"))).toEqual([]);
    for (const file of files.filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))) {
      expect(readFileSync(join(__dirname, file), "utf8")).not.toMatch(/<svg|<path|<circle/);
    }
  });
});
