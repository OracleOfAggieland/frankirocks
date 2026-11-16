import { describe, expect, it } from "vitest";
import type { XrayPropView, XraySignal } from "../../../ui/xray/types";
import {
  BLINK_SECONDS,
  EASED_CHANNELS,
  HOVER_WARM,
  INITIAL_XRAY_MOTION,
  LOOP_SECONDS,
  MAX_FRAME,
  SCAN_FAST_SECONDS,
  SCAN_SLOW_SECONDS,
  STILL_SCAN,
  type XrayMotion,
  settledXrayMotion,
  stepXrayMotion,
  xrayTargets,
} from "./motion";

const OFF: XrayPropView = { power: "off", signal: "dark" };
const on = (signal: XraySignal): XrayPropView => ({ power: "on", signal });
const ON_SIGNALS: readonly XraySignal[] = ["asking", "warming", "searching", "seeing", "filmOnly", "blocked", "noCamera", "paused"];

/** Runs `seconds` of 60 Hz frames showing `v`, and returns every frame. */
const frames = (m: XrayMotion, v: XrayPropView, seconds: number, hover = false): XrayMotion[] => {
  const out: XrayMotion[] = [];
  let next = m;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    next = stepXrayMotion(next, v, hover, 1 / 60);
    out.push(next);
  }
  return out;
};
const run = (m: XrayMotion, v: XrayPropView, seconds: number, hover = false) => frames(m, v, seconds, hover).at(-1)!;
const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const settle = (v: XrayPropView) => run(INITIAL_XRAY_MOTION, v, 4);
/** How many times the scan line starts a new pass in these frames. */
const passes = (f: XrayMotion[]) => {
  let n = 0;
  for (let i = 1; i < f.length; i++) if (f[i]!.scanY < f[i - 1]!.scanY) n++;
  return n;
};

describe("off", () => {
  it("is dark and still, with the arm parked", () => {
    const m = settle(OFF);
    expect(m.screen).toBe(0);
    expect(m.aim).toBe(0);
    const after = frames(m, OFF, 2);
    for (const k of ["screen", "scanAlpha", "needle", "arc", "hum", "aperture", "aim", "bones"] as const) expect(spread(after.map((f) => f[k])), k).toBe(0);
  });

  it("warms the glass to a dim amber under a hover, and cools again without one", () => {
    const warm = run(INITIAL_XRAY_MOTION, OFF, 2, true);
    expect(warm.screen).toBeCloseTo(HOVER_WARM, 3);
    expect(warm.green).toBe(0);
    expect(warm.bones).toBe(0);
    expect(warm.aim).toBe(0);
    expect(run(warm, OFF, 2).screen).toBeCloseTo(0, 3);
  });

  it("wins over whatever the signal says", () => {
    for (const s of ON_SIGNALS) expect(xrayTargets({ power: "off", signal: s }, false)).toEqual(xrayTargets(OFF, false));
  });
});

describe("the arm", () => {
  it("swings down to the glass on a press, starting gently and settling with no bounce", () => {
    const f = frames(INITIAL_XRAY_MOTION, on("asking"), 2);
    const aims = f.map((x) => x.aim);
    // A gentle start: the first frame barely moves.
    expect(aims[0]!).toBeLessThan(0.01);
    // It gets there within about a second...
    expect(aims[59]!).toBeGreaterThan(0.95);
    // ...and never passes it or turns back.
    for (let i = 1; i < aims.length; i++) expect(aims[i]!).toBeGreaterThanOrEqual(aims[i - 1]! - 1e-12);
    expect(Math.max(...aims)).toBeLessThanOrEqual(1);
  });

  it("parks again when turned off", () => {
    expect(run(settle(on("seeing")), OFF, 3).aim).toBeLessThan(0.01);
  });
});

describe("asking and warming", () => {
  it("flickers the glass and crackles an arc at the tube head, amber while asking and greener once warming", () => {
    for (const s of ["asking", "warming"] as const) {
      const f = frames(settle(on(s)), on(s), 2);
      expect(spread(f.map((x) => x.screen)), s).toBeGreaterThan(0.15);
      expect(Math.max(...f.map((x) => x.arc)), s).toBeGreaterThan(0.5);
      // The arc takes many shapes, not one.
      expect(new Set(f.map((x) => x.arcSeed)).size, s).toBeGreaterThan(20);
    }
    expect(settle(on("asking")).green).toBeLessThan(0.01);
    expect(settle(on("warming")).green).toBeGreaterThan(0.5);
    expect(settle(on("warming")).bones).toBeGreaterThan(settle(on("asking")).bones);
  });
});

describe("searching, seeing and film only", () => {
  it("glows ghost green with the hand's bones and a scan line passing over the glass", () => {
    for (const s of ["searching", "seeing", "filmOnly"] as const) {
      const m = settle(on(s));
      expect(m.green, s).toBeCloseTo(1, 3);
      expect(m.bones, s).toBeGreaterThan(0.25);
      expect(m.screen, s).toBeGreaterThan(0.5);
      const f = frames(m, on(s), SCAN_SLOW_SECONDS * 2);
      expect(spread(f.map((x) => x.scanY)), s).toBeGreaterThan(0.9);
      expect(Math.max(...f.map((x) => x.scanAlpha)), s).toBeGreaterThan(0.6);
      expect(Math.max(...f.map((x) => x.arc)), s).toBeLessThan(0.01);
    }
  });

  it("hunts quickly while searching, shows the bones brightest while seeing, and greys to bare film without a tracker", () => {
    const window = SCAN_SLOW_SECONDS * 3;
    const hunt = passes(frames(settle(on("searching")), on("searching"), window));
    const sure = passes(frames(settle(on("seeing")), on("seeing"), window));
    expect(hunt).toBeGreaterThanOrEqual(Math.floor(window / SCAN_FAST_SECONDS) - 1);
    expect(sure).toBeLessThanOrEqual(Math.ceil(window / SCAN_SLOW_SECONDS));
    expect(settle(on("seeing")).bones).toBeCloseTo(1, 3);
    expect(settle(on("seeing")).beam).toBeGreaterThan(settle(on("searching")).beam);
    expect(settle(on("filmOnly")).film).toBeCloseTo(1, 3);
    expect(settle(on("filmOnly")).beam).toBeLessThan(0.01);
  });

  it("breathes a little while lit, so the glass is never quite frozen", () => {
    const f = frames(settle(on("seeing")), on("seeing"), 3);
    const s = spread(f.map((x) => x.screen));
    expect(s).toBeGreaterThan(0.02);
    expect(s).toBeLessThan(0.12);
  });
});

describe("blocked and no camera", () => {
  it("shows the ember colour with no bones, steady when blocked and stuttering with no camera", () => {
    const blocked = settle(on("blocked"));
    const none = settle(on("noCamera"));
    for (const m of [blocked, none]) {
      expect(m.ember).toBeCloseTo(1, 3);
      expect(m.bones).toBeLessThan(0.01);
      expect(m.scanAlpha).toBeLessThan(0.01);
    }
    expect(spread(frames(blocked, on("blocked"), 2).map((x) => x.screen))).toBeLessThan(1e-3);
    const stutter = frames(none, on("noCamera"), 3).map((x) => x.screen);
    expect(Math.min(...stutter)).toBeLessThan(0.2);
    expect(Math.max(...stutter)).toBeGreaterThan(0.4);
    // The arm stays raised when refused, and droops when there is nothing to see.
    expect(blocked.aim).toBeGreaterThan(none.aim + 0.3);
  });
});

describe("paused", () => {
  it("blinks the glass slowly between dim and lit", () => {
    const m = settle(on("paused"));
    const screen = frames(m, on("paused"), BLINK_SECONDS).map((x) => x.screen);
    expect(Math.max(...screen)).toBeGreaterThan(0.55);
    expect(Math.min(...screen)).toBeLessThan(0.2);
  });
});

describe("every state looks different", () => {
  it("differs from every other state in the glass, the arm or the needle, both moving and still", () => {
    const keys = ["glow", "green", "ember", "film", "bones", "scanFast", "flicker", "spark", "blink", "stutter", "beam", "aim", "needleRest"] as const;
    const views: [string, XrayPropView, boolean][] = [["off", OFF, false], ["off, hover", OFF, true], ...ON_SIGNALS.map((s): [string, XrayPropView, boolean] => [s, on(s), false])];
    for (let i = 0; i < views.length; i++) {
      for (let j = i + 1; j < views.length; j++) {
        const a = settledXrayMotion(views[i]![1], views[i]![2]);
        const b = settledXrayMotion(views[j]![1], views[j]![2]);
        const most = Math.max(...keys.map((k) => Math.abs(a[k] - b[k])));
        expect(most, `${views[i]![0]} against ${views[j]![0]}`).toBeGreaterThan(0.2);
      }
    }
  });
});

describe("the settled pose (Reduced_Motion)", () => {
  it("is every eased channel at its target, with no hum and the needle on its rest", () => {
    for (const v of [OFF, ...ON_SIGNALS.map(on)]) {
      for (const hover of [false, true]) {
        const s = settledXrayMotion(v, hover);
        const target = xrayTargets(v, hover);
        for (const k of EASED_CHANNELS) expect(s[k], k).toBe(target[k]);
        expect(s.needle).toBe(target.needleRest);
        expect(s.hum).toBe(0);
      }
    }
  });

  it("holds the scan line still on a lit glass, and keeps a paused glass dimmer than a lit one", () => {
    const seeing = settledXrayMotion(on("seeing"), false);
    expect(seeing.scanY).toBe(STILL_SCAN);
    expect(seeing.scanAlpha).toBeGreaterThan(0.5);
    expect(settledXrayMotion(on("paused"), false).screen).toBeLessThan(settledXrayMotion(on("searching"), false).screen - 0.2);
    expect(settledXrayMotion(on("asking"), false).arc).toBeGreaterThan(0.5);
    expect(settledXrayMotion(OFF, false).screen).toBe(0);
  });

  it("does not depend on where the motion was", () => {
    expect(settledXrayMotion(on("warming"), false)).toEqual(settledXrayMotion(on("warming"), false));
  });
});

describe("time steps", () => {
  it("lands a change of view on a zero-length frame", () => {
    const m = stepXrayMotion(INITIAL_XRAY_MOTION, on("seeing"), false, 0);
    expect(m).not.toBe(INITIAL_XRAY_MOTION);
    expect(Number.isFinite(m.t)).toBe(true);
  });

  it("treats a negative or broken step as no time at all, and caps a long one", () => {
    const base = run(INITIAL_XRAY_MOTION, on("seeing"), 1);
    for (const dt of [-1, Number.NaN, Number.NEGATIVE_INFINITY]) expect(stepXrayMotion(base, on("seeing"), false, dt)).toEqual(stepXrayMotion(base, on("seeing"), false, 0));
    expect(stepXrayMotion(base, on("seeing"), false, 30)).toEqual(stepXrayMotion(base, on("seeing"), false, MAX_FRAME));
  });

  it("wraps its loop clock seamlessly", () => {
    const late = { ...run(INITIAL_XRAY_MOTION, on("seeing"), 3), t: LOOP_SECONDS - 0.001 };
    const next = stepXrayMotion(late, on("seeing"), false, 1 / 60);
    expect(next.t).toBeLessThan(0.02);
    expect(next.t).toBeGreaterThanOrEqual(0);
  });
});
