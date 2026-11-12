import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DIAL_CYCLE,
  DIAL_LEAD,
  DIAL_TURNS,
  INITIAL_MOTION,
  MAX_FRAME,
  type PhoneMotion,
  RING_CYCLE,
  RING_ON,
  type ShownPhase,
  type ShownView,
  dingAt,
  liftedIn,
  ringAt,
  settledMotion,
  stepMotion,
  wheelAt,
} from "./motion";

const view = (phase: ShownPhase, reason: ShownView["reason"] = null): ShownView => ({ phase, reason });
/** Runs `seconds` of 60 Hz frames showing `v`. */
const run = (m: PhoneMotion, v: ShownView, seconds: number) => {
  let next = m;
  for (let i = 0; i < Math.round(seconds * 60); i++) next = stepMotion(next, v, 1 / 60);
  return next;
};

describe("the handset", () => {
  it("is held exactly while the line is open", () => {
    expect((["dialing", "ringing", "talking", "ended", "missed"] as const).filter(liftedIn)).toEqual(["dialing", "ringing", "talking"]);
  });

  it("settles at the ear while held and back on the hook when the call is over", () => {
    const held = run(INITIAL_MOTION, view("dialing"), 2);
    expect(held.lift).toBeCloseTo(1, 2);
    expect(Math.abs(held.liftV)).toBeLessThan(0.05);
    expect(run(held, view("ringing"), 1).lift).toBeCloseTo(1, 2);
    expect(run(held, view("ended"), 2).lift).toBeCloseTo(0, 2);
    expect(run(held, view("missed", "busy"), 2).lift).toBeCloseTo(0, 2);
  });

  it("never swings far past either rest", () => {
    let m = INITIAL_MOTION;
    for (const v of [view("dialing"), view("ended"), view("talking"), view("missed", "failed")]) {
      for (let i = 0; i < 120; i++) {
        m = stepMotion(m, v, 1 / 60);
        expect(m.lift).toBeGreaterThan(-0.08);
        expect(m.lift).toBeLessThan(1.08);
      }
    }
  });
});

describe("the finger wheel", () => {
  it("rests until the handset is up, then winds each digit and comes home", () => {
    expect(wheelAt(0)).toBe(0);
    expect(wheelAt(DIAL_LEAD)).toBe(0);
    for (let digit = 0; digit < DIAL_TURNS.length + 2; digit++) {
      const t0 = DIAL_LEAD + digit * DIAL_CYCLE;
      const turn = DIAL_TURNS[digit % DIAL_TURNS.length]!;
      let deepest = 0;
      for (let k = 0; k <= 1000; k++) deepest = Math.min(deepest, wheelAt(t0 + (k / 1000) * DIAL_CYCLE));
      expect(deepest).toBeCloseTo(-turn, 2);
      expect(wheelAt(t0 + DIAL_CYCLE - 0.01)).toBeCloseTo(0, 6);
    }
  });

  it("turns only while dialing, and runs home without a jump when dialing ends mid-turn", () => {
    const mid = run(INITIAL_MOTION, view("dialing"), DIAL_LEAD + 0.4);
    expect(mid.wheel).toBeLessThan(-0.5);
    const first = stepMotion(mid, view("ringing"), 1 / 60);
    expect(Math.abs(first.wheel - mid.wheel)).toBeLessThan(0.3);
    expect(Math.abs(run(mid, view("ringing"), 1).wheel)).toBeLessThan(0.01);
    expect(run(INITIAL_MOTION, view("talking"), 3).wheel).toBeCloseTo(0, 9);
  });
});

describe("the bells", () => {
  it("ring in bursts with rests between", () => {
    expect(ringAt(0)).toBe(0);
    expect(ringAt(RING_ON / 2)).toBe(1);
    expect(ringAt(RING_ON + 0.01)).toBe(0);
    expect(ringAt(RING_CYCLE - 0.01)).toBe(0);
    expect(ringAt(RING_CYCLE + RING_ON / 2)).toBe(1);
  });

  it("shake only while ringing, and give one fading tap when the call ends", () => {
    for (const phase of ["dialing", "talking", "missed"] as const) {
      let m = INITIAL_MOTION;
      for (let i = 0; i < 180; i++) {
        m = stepMotion(m, view(phase, phase === "missed" ? "noAnswer" : null), 1 / 60);
        expect(m.ring).toBe(0);
        expect(Math.abs(m.bell)).toBe(0);
      }
    }
    let loudest = 0;
    let m = INITIAL_MOTION;
    for (let i = 0; i < 120; i++) {
      m = stepMotion(m, view("ringing"), 1 / 60);
      loudest = Math.max(loudest, Math.abs(m.bell));
    }
    expect(loudest).toBeGreaterThan(0.8);
    expect(dingAt(0)).toBe(0);
    expect(dingAt(0.5)).toBe(1);
    expect(dingAt(3)).toBeLessThan(0.001);
    expect(run(INITIAL_MOTION, view("ended"), 4).ring).toBeLessThan(0.001);
  });
});

describe("the lamp and the waves", () => {
  it("light the lamp while talking and when missed, and put it out otherwise", () => {
    expect(run(INITIAL_MOTION, view("talking"), 1)).toMatchObject({ lamp: "live" });
    expect(run(INITIAL_MOTION, view("talking"), 1).lampLevel).toBeGreaterThan(0.4);
    expect(run(INITIAL_MOTION, view("missed", "busy"), 1)).toMatchObject({ lamp: "missed" });
    expect(run(INITIAL_MOTION, view("missed", "busy"), 1).lampLevel).toBeGreaterThan(0.15);
    for (const phase of ["dialing", "ringing", "ended"] as const) {
      const m = run(run(INITIAL_MOTION, view("talking"), 1), view(phase), 1.5);
      expect(m.lamp).toBe("off");
      expect(m.lampLevel).toBeLessThan(0.01);
    }
  });

  it("show waves only while talking, fading in and out", () => {
    const talking = run(INITIAL_MOTION, view("talking"), 1.5);
    expect(talking.waves).toBeGreaterThan(0.99);
    expect(run(talking, view("ended"), 1.5).waves).toBeLessThan(0.01);
    expect(run(INITIAL_MOTION, view("ringing"), 2).waves).toBe(0);
  });
});

describe("settledMotion: the still pose under Reduced_Motion", () => {
  it("has the handset where the moving phone comes to rest, and nothing mid-travel", () => {
    for (const phase of ["dialing", "ringing", "talking", "ended", "missed"] as const) {
      const v = view(phase, phase === "missed" ? "busy" : null);
      const still = settledMotion(v);
      const moved = run(INITIAL_MOTION, v, 4);
      expect(still.lift).toBe(liftedIn(phase) ? 1 : 0);
      expect(still.lift).toBeCloseTo(moved.lift, 2);
      expect(still.appear).toBe(1);
      expect(still.lamp).toBe(moved.lamp);
      expect(still.wheel).toBe(0);
      expect(still.bell).toBe(0);
      expect(still.clapper).toBe(0);
      expect(still.sway).toBe(0);
    }
  });

  it("still shows which phase it is: strokes for a ring, waves and a lit lamp for talk, a lit lamp for a miss", () => {
    expect(settledMotion(view("ringing")).ring).toBe(1);
    expect(settledMotion(view("talking"))).toMatchObject({ waves: 1, lamp: "live" });
    expect(settledMotion(view("talking")).lampLevel).toBeGreaterThan(0.5);
    expect(settledMotion(view("missed", "noAnswer"))).toMatchObject({ lamp: "missed", waves: 0, ring: 0 });
    expect(settledMotion(view("missed", "noAnswer")).lampLevel).toBeGreaterThan(0.5);
    expect(settledMotion(view("ended"))).toMatchObject({ lamp: "off", lampLevel: 0, waves: 0, ring: 0 });
    expect(settledMotion(view("dialing"))).toMatchObject({ lamp: "off", waves: 0, ring: 0 });
  });

  it("is the same every time it is asked", () => {
    expect(settledMotion(view("talking"))).toEqual(settledMotion(view("talking")));
  });
});

describe("stepMotion on any frames", () => {
  const arbPhase = fc.constantFrom<ShownPhase>("dialing", "ringing", "talking", "ended", "missed");
  const arbDt = fc.oneof(fc.double({ min: 0, max: 0.05, noNaN: true }), fc.constantFrom(0, -1, 5, 1000, Number.NaN, Number.POSITIVE_INFINITY));

  it("stays finite and in range whatever the phases and frame times", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(arbPhase, arbDt), { maxLength: 200 }), (frames) => {
        let m = INITIAL_MOTION;
        for (const [phase, dt] of frames) {
          m = stepMotion(m, view(phase, phase === "missed" ? "failed" : null), dt);
          for (const v of [m.t, m.appear, m.lift, m.wheel, m.ring, m.bell, m.clapper, m.waves, m.wavePhase, m.sway, m.lampLevel]) expect(Number.isFinite(v)).toBe(true);
          expect(m.phase).toBe(phase);
          expect(m.lift).toBeGreaterThan(-0.2);
          expect(m.lift).toBeLessThan(1.2);
          expect(m.appear).toBeGreaterThanOrEqual(0);
          expect(m.appear).toBeLessThan(1.2);
          expect(m.ring).toBeGreaterThanOrEqual(0);
          expect(m.ring).toBeLessThanOrEqual(1);
          expect(Math.abs(m.bell)).toBeLessThanOrEqual(1);
          expect(m.waves).toBeGreaterThanOrEqual(0);
          expect(m.waves).toBeLessThanOrEqual(1);
          expect(m.wavePhase).toBeGreaterThanOrEqual(0);
          expect(m.wavePhase).toBeLessThan(1);
          expect(m.wheel).toBeLessThanOrEqual(0);
          expect(m.lampLevel).toBeGreaterThanOrEqual(0);
          expect(m.lampLevel).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("counts a long frame as a short one, so a tab coming back never throws the handset", () => {
    const a = stepMotion(INITIAL_MOTION, view("dialing"), 60);
    const b = stepMotion(INITIAL_MOTION, view("dialing"), MAX_FRAME);
    expect(a).toEqual(b);
  });

  it("starts the phase clock again when the phase changes", () => {
    const m = run(INITIAL_MOTION, view("dialing"), 2);
    expect(m.t).toBeCloseTo(2, 5);
    expect(stepMotion(m, view("ringing"), 1 / 60).t).toBeCloseTo(1 / 60, 9);
  });
});
