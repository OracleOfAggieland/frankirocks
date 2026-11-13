import { describe, expect, it } from "vitest";
import type { RadioPropView, RadioSignal } from "../../../ui/radio/types";
import {
  BEAT_HZ,
  BLINK_SECONDS,
  EASED_CHANNELS,
  HOVER_WARM,
  INITIAL_RADIO_MOTION,
  LOOP_SECONDS,
  MAX_FRAME,
  NEEDLE_LOST,
  NEEDLE_PARK,
  NEEDLE_PLAY,
  NOTE_SECONDS,
  type RadioMotion,
  SWEEP_SECONDS,
  radioTargets,
  settledRadioMotion,
  stepRadioMotion,
} from "./motion";

const OFF: RadioPropView = { power: "off", signal: "silent", open: false };
const on = (signal: RadioSignal, open = false): RadioPropView => ({ power: "on", signal, open });

/** Runs `seconds` of 60 Hz frames showing `v`, and returns every frame. */
const frames = (m: RadioMotion, v: RadioPropView, seconds: number, hover = false): RadioMotion[] => {
  const out: RadioMotion[] = [];
  let next = m;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    next = stepRadioMotion(next, v, hover, 1 / 60);
    out.push(next);
  }
  return out;
};
const run = (m: RadioMotion, v: RadioPropView, seconds: number, hover = false) => frames(m, v, seconds, hover).at(-1)!;
const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

describe("off", () => {
  it("is dark and still, with the needle parked at the left", () => {
    const m = run(INITIAL_RADIO_MOTION, OFF, 3);
    expect(m.dial).toBe(0);
    expect(m.needle).toBe(NEEDLE_PARK);
    const after = frames(m, OFF, 2);
    for (const k of ["dial", "needle", "pulse", "bob", "arc", "drift", "knob"] as const) expect(spread(after.map((f) => f[k])), k).toBe(0);
  });

  it("warms the dial to a dim glow under a hover, and cools again without one", () => {
    const warm = run(INITIAL_RADIO_MOTION, OFF, 2, true);
    expect(warm.dial).toBeCloseTo(HOVER_WARM, 3);
    expect(warm.dial).toBeLessThan(0.5);
    expect(warm.green).toBe(0);
    expect(warm.needle).toBe(NEEDLE_PARK);
    expect(run(warm, OFF, 2).dial).toBeCloseTo(0, 3);
  });

  it("wins over whatever the signal says", () => {
    expect(radioTargets({ power: "off", signal: "playing", open: false }, false)).toEqual(radioTargets(OFF, false));
  });
});

describe("tuning", () => {
  it("lights the dial, sweeps the needle across it, and crackles at the antenna", () => {
    const warm = run(INITIAL_RADIO_MOTION, on("tuning"), 2);
    expect(warm.dial).toBeGreaterThan(0.7);
    const sweep = frames(warm, on("tuning"), SWEEP_SECONDS);
    expect(spread(sweep.map((f) => f.needle))).toBeGreaterThan(0.7);
    expect(Math.max(...sweep.map((f) => f.arc))).toBeGreaterThan(0.5);
    // The crackle takes many shapes, not one.
    expect(new Set(sweep.map((f) => f.arcSeed)).size).toBeGreaterThan(20);
    expect(Math.max(...sweep.map((f) => f.drift))).toBeLessThan(0.01);
  });
});

describe("playing", () => {
  const settle = () => run(INITIAL_RADIO_MOTION, on("playing"), 3);

  it("glows ghost green, rests the needle on its mark and turns the knobs", () => {
    const m = settle();
    expect(m.green).toBeCloseTo(1, 3);
    expect(m.ember).toBeCloseTo(0, 3);
    expect(m.needle).toBeCloseTo(NEEDLE_PLAY, 3);
    expect(m.knob).toBeGreaterThan(0.95);
    expect(spread(frames(m, on("playing"), 1).map((f) => f.needle))).toBeLessThan(1e-3);
  });

  it("pulses the speaker about twice a second and bobs the cabinet with it", () => {
    const f = frames(settle(), on("playing"), 2);
    const pulses = f.map((x) => x.pulse);
    let crossings = 0;
    for (let i = 1; i < pulses.length; i++) if (pulses[i - 1]! < 0 && pulses[i]! >= 0) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(BEAT_HZ * 2 - 1);
    expect(crossings).toBeLessThanOrEqual(BEAT_HZ * 2 + 1);
    expect(spread(f.map((x) => x.bob))).toBeGreaterThan(0.9);
  });

  it("sends rings up from the speaker, round and round", () => {
    const f = frames(settle(), on("playing"), NOTE_SECONDS);
    expect(f.at(-1)!.drift).toBeGreaterThan(0.99);
    expect(spread(f.map((x) => x.notes))).toBeGreaterThan(0.9);
  });

  it("goes dark again when turned off", () => {
    const m = run(settle(), OFF, 3);
    expect(m.dial).toBeCloseTo(0, 3);
    expect(m.drift).toBeCloseTo(0, 3);
    expect(m.needle).toBeCloseTo(NEEDLE_PARK, 2);
  });
});

describe("no signal", () => {
  it("glows ember, trembles the needle in place and lets nothing drift", () => {
    const m = run(INITIAL_RADIO_MOTION, on("noSignal"), 3);
    expect(m.ember).toBeCloseTo(1, 3);
    expect(m.dial).toBeGreaterThan(0.7);
    const f = frames(m, on("noSignal"), 1);
    const needles = f.map((x) => x.needle);
    expect(spread(needles)).toBeGreaterThan(0.02);
    expect(spread(needles)).toBeLessThan(0.08);
    for (const x of needles) expect(Math.abs(x - NEEDLE_LOST)).toBeLessThan(0.04);
    expect(Math.max(...f.map((x) => x.drift))).toBeLessThan(1e-3);
    expect(Math.max(...f.map((x) => Math.abs(x.pulse)))).toBeLessThan(1e-3);
  });
});

describe("tap to play", () => {
  it("blinks the dial slowly between dim and lit", () => {
    const m = run(INITIAL_RADIO_MOTION, on("tapToPlay"), 3);
    const dial = frames(m, on("tapToPlay"), BLINK_SECONDS).map((x) => x.dial);
    expect(Math.max(...dial)).toBeGreaterThan(0.8);
    expect(Math.min(...dial)).toBeLessThan(0.3);
  });
});

describe("the open globe", () => {
  it("lights the radio's source glow while open, in any state, and lets it go when closed", () => {
    for (const v of [on("playing", true), on("tuning", true), on("noSignal", true)]) {
      const m = run(INITIAL_RADIO_MOTION, v, 2);
      expect(m.source).toBeGreaterThan(0.99);
      expect(run(m, { ...v, open: false }, 2).source).toBeLessThan(0.01);
    }
  });
});

describe("the settled pose (Reduced_Motion)", () => {
  it("is every eased channel at its target, the dial lit and the needle on its mark", () => {
    for (const v of [OFF, on("tuning"), on("playing", true), on("noSignal"), on("tapToPlay")]) {
      for (const hover of [false, true]) {
        const s = settledRadioMotion(v, hover);
        const target = radioTargets(v, hover);
        for (const k of EASED_CHANNELS) expect(s[k], k).toBe(target[k]);
        expect(s.dial).toBe(target.warm);
        expect(s.needle).toBe(target.rest);
        expect(s.pulse).toBe(0);
        expect(s.bob).toBe(0);
      }
    }
  });

  it("holds one ring mid-air while playing, and none otherwise", () => {
    const s = settledRadioMotion(on("playing"), false);
    expect(s.drift).toBe(1);
    expect(s.notes).toBeGreaterThan(0.2);
    expect(s.notes).toBeLessThan(0.8);
    expect(settledRadioMotion(on("noSignal"), false).drift).toBe(0);
  });

  it("does not depend on where the motion was", () => {
    expect(settledRadioMotion(on("tuning"), false)).toEqual(settledRadioMotion(on("tuning"), false));
  });
});

describe("time steps", () => {
  it("lands a change of view on a zero-length frame", () => {
    const m = stepRadioMotion(INITIAL_RADIO_MOTION, on("playing"), false, 0);
    expect(m).not.toBe(INITIAL_RADIO_MOTION);
    expect(Number.isFinite(m.t)).toBe(true);
  });

  it("treats a negative or broken step as no time at all, and caps a long one", () => {
    const base = run(INITIAL_RADIO_MOTION, on("playing"), 1);
    for (const dt of [-1, Number.NaN, Number.NEGATIVE_INFINITY]) expect(stepRadioMotion(base, on("playing"), false, dt)).toEqual(stepRadioMotion(base, on("playing"), false, 0));
    expect(stepRadioMotion(base, on("playing"), false, 30)).toEqual(stepRadioMotion(base, on("playing"), false, MAX_FRAME));
  });

  it("wraps its loop clock seamlessly", () => {
    const late = { ...run(INITIAL_RADIO_MOTION, on("playing"), 3), t: LOOP_SECONDS - 0.001 };
    const next = stepRadioMotion(late, on("playing"), false, 1 / 60);
    expect(next.t).toBeLessThan(0.02);
    expect(next.t).toBeGreaterThanOrEqual(0);
  });
});
