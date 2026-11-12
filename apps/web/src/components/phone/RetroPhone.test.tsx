import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY } from "../../ui/copy";
import type { PhoneView } from "../../ui/phone/phone-call";
import { Stage } from "../avatar/Stage";
import { CORD_PATH, PhoneOnStage, RetroPhone, fingerHole, handsetLifted, phoneCaption } from "./RetroPhone";

const CSS = readFileSync(join(__dirname, "phone.css"), "utf8");
const view = (phase: PhoneView["phase"], reason: PhoneView["reason"] = null): PhoneView => ({ phase, reason });
const draw = (v: PhoneView) => renderToStaticMarkup(<RetroPhone view={v} />);
const part = (html: string, name: string) => new RegExp(`data-phone-part="${name}"[^>]*class="([^"]*)"`).exec(html)?.[1] ?? "";

describe("RetroPhone", () => {
  it("draws nothing when there is no call", () => {
    expect(draw(view("absent"))).toBe("");
    expect(renderToStaticMarkup(<PhoneOnStage view={view("absent")} />)).toBe("");
  });

  it("draws the whole phone in every phase: two bells, the wheel with ten holes, the cord and the handset", () => {
    for (const phase of ["dialing", "ringing", "talking", "ended", "missed"] as const) {
      const html = draw(view(phase, phase === "missed" ? "busy" : null));
      expect(html).toContain(`data-phone-phase="${phase}"`);
      expect(html.match(/data-phone-part="bell"/g)).toHaveLength(2);
      expect(html.match(/class="phone-hole"/g)).toHaveLength(10);
      for (const name of ["clapper", "wheel", "cord", "handset", "lamp"]) expect(html).toContain(`data-phone-part="${name}"`);
    }
  });

  it("lifts the handset exactly while Franki holds the line", () => {
    expect(["dialing", "ringing", "talking", "ended", "missed", "absent"].filter((p) => handsetLifted(p as PhoneView["phase"]))).toEqual(["dialing", "ringing", "talking"]);
    expect(draw(view("talking"))).toContain('data-lifted="true"');
    expect(draw(view("ended"))).toContain('data-lifted="false"');
  });

  it("acts each phase with its own part and nothing else", () => {
    const dialing = draw(view("dialing"));
    expect(part(dialing, "wheel")).toContain("phone-dial-spin");
    expect(part(dialing, "bell")).not.toContain("phone-bell-ring");
    const ringing = draw(view("ringing"));
    expect(part(ringing, "bell")).toContain("phone-bell-ring");
    expect(part(ringing, "clapper")).toContain("phone-clapper");
    expect(ringing).toContain('data-phone-part="ring-marks"');
    expect(part(ringing, "wheel")).not.toContain("phone-dial-spin");
    const talking = draw(view("talking"));
    expect(talking).toContain('data-phone-part="waves"');
    expect(talking.match(/phone-wave franki-anim/g)).toHaveLength(3);
    expect(part(talking, "bell")).not.toContain("phone-bell");
    expect(talking).not.toContain('data-phone-part="ring-marks"');
    const ended = draw(view("ended"));
    expect(part(ended, "bell")).toContain("phone-bell-ding");
    expect(ended).not.toContain('data-phone-part="waves"');
    expect(part(draw(view("missed", "busy")), "lamp")).toBe("phone-lamp-missed");
    expect(part(talking, "lamp")).toBe("phone-lamp-live");
    expect(part(ended, "lamp")).toBe("phone-lamp");
  });

  it("gives every looping part franki-anim, so Reduced_Motion and a hidden tab stop it", () => {
    for (const html of [draw(view("dialing")), draw(view("ringing")), draw(view("talking")), draw(view("ended"))]) {
      for (const cls of html.match(/class="[^"]*"/g) ?? []) {
        if (/phone-(dial-spin|bell-ring|bell-ding|clapper(?!-)|ring-marks|wave-\d)/.test(cls)) expect(cls).toContain("franki-anim");
      }
    }
  });

  it("gives each drawing its own gradient ids, so two phones never share one", () => {
    const html = renderToStaticMarkup(
      <>
        <RetroPhone view={view("dialing")} />
        <RetroPhone view={view("ringing")} />
      </>,
    );
    const ids = [...html.matchAll(/ id="(phone-[^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it("keeps the wheel's holes on one circle, clear of the finger stop", () => {
    for (let i = 0; i < 10; i++) {
      const { cx, cy } = fingerHole(i);
      expect(Math.hypot(cx - 94, cy - 88)).toBeCloseTo(14.5, 6);
    }
    // The stop sits at about four o'clock; no hole lies between there and six o'clock.
    const angles = Array.from({ length: 10 }, (_, i) => (-60 + i * 30 + 360) % 360);
    expect(angles.filter((a) => a > 30 && a < 120 && a !== 60 && a !== 90)).toEqual([]);
  });

  it("draws the cord with the same commands in both poses, so it can be tweened", () => {
    const shape = (d: string) => d.replace(/-?\d+(\.\d+)?/g, "n");
    expect(shape(CORD_PATH.hook)).toBe(shape(CORD_PATH.lifted));
  });
});

describe("PhoneOnStage", () => {
  it("says what the drawing shows, in words under it and to a screen reader", () => {
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
      const html = renderToStaticMarkup(<PhoneOnStage view={v} />);
      expect(html).toContain('role="img"');
      expect(html).toContain(`aria-label="${label.replace(/’/g, "’")}"`);
      expect(html).toContain(`>${caption}</span>`);
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
    // The stage itself is unchanged by an empty wall.
    const bare = renderToStaticMarkup(<Stage reduced={false}><div /></Stage>);
    const empty = renderToStaticMarkup(<Stage reduced={false} aside={<PhoneOnStage view={view("absent")} />}><div /></Stage>);
    expect(empty).toBe(bare);
  });
});

describe("phone.css", () => {
  it("runs its loops only when motion is allowed, on token durations", () => {
    const [paint, motion] = CSS.split("@media (prefers-reduced-motion: no-preference)");
    expect(motion).toBeDefined();
    expect(paint).not.toMatch(/animation\s*:/);
    for (const rule of motion!.match(/animation(-delay)?\s*:[^;]+;/g) ?? []) expect(rule).toMatch(/var\(--dur-/);
  });

  it("paints with the palette's tokens only", () => {
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS).not.toMatch(/rgb\(|hsl\(/);
  });

  it("moves only transform and opacity", () => {
    const frames = CSS.match(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})+\s*\}/g) ?? [];
    expect(frames.length).toBeGreaterThanOrEqual(6);
    for (const f of frames) {
      for (const decl of f.match(/[a-z-]+\s*:/g) ?? []) expect(decl.replace(/\s*:/, "")).toMatch(/^(transform|opacity)$/);
    }
  });
});
