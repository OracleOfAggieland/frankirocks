import { describe, expect, it } from "vitest";
import {
  INITIAL_RADIO,
  RADIO_MAX_HOPS,
  type RadioEvent,
  type RadioState,
  hopTarget,
  pickIndex,
  radioEffects,
  radioStep,
  radioView,
} from "./radio-machine";
import { RADIO_OFF_VIEW, type Station } from "./types";

const st = (id: string, lon: number, rock: boolean): Station => ({ id, name: `Name ${id}`, city: `City ${id}`, country: "Land", lat: 0, lon, url: `https://radio.test/${id}`, rock });
// West to east: a b(rock) c d(rock) e.
const LIST: readonly Station[] = [st("a", -100, false), st("b", -50, true), st("c", 0, false), st("d", 50, true), st("e", 100, false)];

const step = (s: RadioState, e: RadioEvent, list = LIST) => radioStep(s, e, list);
const steps = (s: RadioState, es: RadioEvent[], list = LIST) => es.reduce((x, e) => radioStep(x, e, list), s);
const onAt = (id: string, signal: RadioState["signal"] = "playing", extra: Partial<RadioState> = {}): RadioState => ({
  ...INITIAL_RADIO,
  power: "on",
  panel: "open",
  stationId: id,
  signal,
  tune: 5,
  ...extra,
});

describe("ui.radio transitions", () => {
  it("silent + press -> tuning (on, panel open, a rock station)", () => {
    const s = step(INITIAL_RADIO, { kind: "press", pick: 0 });
    expect(s).toMatchObject({ power: "on", panel: "open", stationId: "b", signal: "tuning", tune: 1, hops: 0 });
    expect(step(INITIAL_RADIO, { kind: "press", pick: 0.99 }).stationId).toBe("d");
  });

  it("silent + press -> silent (no stations: nothing to play)", () => {
    expect(step(INITIAL_RADIO, { kind: "press", pick: 0 }, [])).toBe(INITIAL_RADIO);
  });

  it("silent + press -> tuning (no rock station: any station)", () => {
    const plain = [st("x", 0, false), st("y", 10, false)];
    expect(step(INITIAL_RADIO, { kind: "press", pick: 0.6 }, plain).stationId).toBe("y");
  });

  it("playing + press -> playing (the panel toggles, the station keeps playing)", () => {
    const closed = step(onAt("c"), { kind: "press", pick: 0 });
    expect(closed).toMatchObject({ panel: "closed", stationId: "c", signal: "playing", tune: 5 });
    expect(step(closed, { kind: "press", pick: 0 }).panel).toBe("open");
  });

  it("playing + closePanel -> playing (closing the panel leaves the station playing)", () => {
    const s = step(onAt("c"), { kind: "closePanel" });
    expect(s).toMatchObject({ power: "on", panel: "closed", signal: "playing" });
    expect(step(s, { kind: "closePanel" })).toBe(s);
  });

  it("playing + powerOff -> silent (keeps the volume and duck, raises the tune)", () => {
    const s = step(onAt("c", "playing", { volume: 0.3, duck: "call" }), { kind: "powerOff" });
    expect(s).toEqual({ ...INITIAL_RADIO, volume: 0.3, duck: "call", tune: 6 });
  });

  it("silent + powerOff -> silent (nothing changes)", () => {
    expect(step(INITIAL_RADIO, { kind: "powerOff" })).toBe(INITIAL_RADIO);
  });

  it("playing + offPhrase -> silent; silent + offPhrase -> silent (only while on)", () => {
    expect(step(onAt("c"), { kind: "offPhrase" }).power).toBe("off");
    expect(step(INITIAL_RADIO, { kind: "offPhrase" })).toBe(INITIAL_RADIO);
  });

  it("silent + rockPhrase -> tuning (on, panel open, rock)", () => {
    expect(step(INITIAL_RADIO, { kind: "rockPhrase", pick: 0 })).toMatchObject({ power: "on", panel: "open", stationId: "b", signal: "tuning" });
  });

  it("playing + rockPhrase -> playing (a rock station already live: only the panel opens)", () => {
    const s = onAt("d", "playing", { panel: "closed" });
    expect(step(s, { kind: "rockPhrase", pick: 0 })).toEqual({ ...s, panel: "open" });
    const open = onAt("d");
    expect(step(open, { kind: "rockPhrase", pick: 0 })).toBe(open);
  });

  it("playing + rockPhrase -> tuning (not a rock station: tunes to one)", () => {
    expect(step(onAt("c"), { kind: "rockPhrase", pick: 0 })).toMatchObject({ stationId: "b", signal: "tuning", tune: 6, panel: "open" });
  });

  it("noSignal + rockPhrase -> tuning (a dead rock station is tuned again)", () => {
    expect(step(onAt("d", "noSignal", { hops: 3 }), { kind: "rockPhrase", pick: 0.99 })).toMatchObject({ stationId: "d", signal: "tuning", hops: 0 });
  });

  it("playing + tune -> tuning (another station)", () => {
    expect(step(onAt("c"), { kind: "tune", stationId: "e" })).toMatchObject({ stationId: "e", signal: "tuning", tune: 6, hops: 0 });
  });

  it("playing + tune -> playing (the same station, or one not in the list, changes nothing)", () => {
    const s = onAt("c");
    expect(step(s, { kind: "tune", stationId: "c" })).toBe(s);
    expect(step(s, { kind: "tune", stationId: "zz" })).toBe(s);
  });

  it("noSignal + tune -> tuning (the same station tries again)", () => {
    expect(step(onAt("c", "noSignal", { hops: 3 }), { kind: "tune", stationId: "c" })).toMatchObject({ signal: "tuning", hops: 0 });
  });

  it("silent + tune, step, spin, retry -> silent (nothing tunes while off)", () => {
    for (const e of [{ kind: "tune", stationId: "a" }, { kind: "step", direction: 1 }, { kind: "spin", pick: 0.5 }, { kind: "retry" }] as RadioEvent[]) {
      expect(step(INITIAL_RADIO, e)).toBe(INITIAL_RADIO);
    }
  });

  it("playing + step -> tuning (east and west, wrapping round)", () => {
    expect(step(onAt("c"), { kind: "step", direction: 1 }).stationId).toBe("d");
    expect(step(onAt("c"), { kind: "step", direction: -1 }).stationId).toBe("b");
    expect(step(onAt("e"), { kind: "step", direction: 1 }).stationId).toBe("a");
    expect(step(onAt("a"), { kind: "step", direction: -1 }).stationId).toBe("e");
  });

  it("playing + spin -> tuning (always a different station)", () => {
    for (const pick of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const s = step(onAt("c"), { kind: "spin", pick });
      expect(s.stationId).not.toBe("c");
      expect(s.signal).toBe("tuning");
    }
    expect(step(onAt("c"), { kind: "spin", pick: 0 }).stationId).toBe("a");
    expect(step(onAt("c"), { kind: "spin", pick: 1 }).stationId).toBe("e");
  });

  it("playing + spin, step -> playing (one station: nothing to change to)", () => {
    const one = [st("x", 0, true)];
    const s = onAt("x");
    expect(radioStep(s, { kind: "spin", pick: 0.5 }, one)).toBe(s);
    expect(radioStep(s, { kind: "step", direction: 1 }, one)).toBe(s);
  });

  it("any + setVolume -> same signal (clamped to 0 to 1; not a number is ignored)", () => {
    const s = onAt("c");
    expect(step(s, { kind: "setVolume", volume: 0.25 }).volume).toBe(0.25);
    expect(step(s, { kind: "setVolume", volume: 7 }).volume).toBe(1);
    expect(step(s, { kind: "setVolume", volume: -1 }).volume).toBe(0);
    expect(step(s, { kind: "setVolume", volume: Number.NaN })).toBe(s);
    expect(step(s, { kind: "setVolume", volume: s.volume })).toBe(s);
    expect(step(INITIAL_RADIO, { kind: "setVolume", volume: 0.5 }).volume).toBe(0.5);
  });

  it("tuning + player playing -> playing (and the hop count resets)", () => {
    expect(step(onAt("c", "tuning", { hops: 2 }), { kind: "player", tune: 5, report: "playing" })).toMatchObject({ signal: "playing", hops: 0 });
  });

  it("tuning + a stale player report -> tuning (an older tune is dropped)", () => {
    const s = onAt("c", "tuning");
    for (const report of ["playing", "waiting", "failed", "blocked", "timedOut"] as const) {
      expect(step(s, { kind: "player", tune: 4, report })).toBe(s);
    }
  });

  it("silent + player -> silent (nothing plays while off)", () => {
    expect(step(INITIAL_RADIO, { kind: "player", tune: 0, report: "playing" })).toBe(INITIAL_RADIO);
  });

  it("playing + player waiting -> tuning (a stall)", () => {
    expect(step(onAt("c"), { kind: "player", tune: 5, report: "waiting" }).signal).toBe("tuning");
    const t = onAt("c", "tuning");
    expect(step(t, { kind: "player", tune: 5, report: "waiting" })).toBe(t);
  });

  it("tuning + player blocked -> tapToPlay; tapToPlay + retry -> tuning", () => {
    const blocked = step(onAt("c", "tuning"), { kind: "player", tune: 5, report: "blocked" });
    expect(blocked.signal).toBe("tapToPlay");
    expect(step(blocked, { kind: "retry" })).toMatchObject({ signal: "tuning", stationId: "c", tune: 6 });
  });

  it("tuning + player failed -> tuning (hops east to the same kind)", () => {
    expect(step(onAt("b", "tuning"), { kind: "player", tune: 5, report: "failed" })).toMatchObject({ stationId: "d", hops: 1, tune: 6 });
    expect(step(onAt("c", "tuning"), { kind: "player", tune: 5, report: "failed" })).toMatchObject({ stationId: "d", hops: 1 });
  });

  it("tuning + player timedOut -> tuning (a stream that never starts hops)", () => {
    expect(step(onAt("e", "tuning"), { kind: "player", tune: 5, report: "timedOut" })).toMatchObject({ stationId: "a", hops: 1 });
  });

  it("playing + player timedOut -> playing (a late timer does nothing once it plays)", () => {
    const s = onAt("c");
    expect(step(s, { kind: "player", tune: 5, report: "timedOut" })).toBe(s);
  });

  it(`tuning + player failed -> noSignal (after ${RADIO_MAX_HOPS} hops)`, () => {
    let s = step(INITIAL_RADIO, { kind: "press", pick: 0 });
    for (let i = 0; i < RADIO_MAX_HOPS; i++) s = step(s, { kind: "player", tune: s.tune, report: "failed" });
    expect(s).toMatchObject({ signal: "tuning", hops: RADIO_MAX_HOPS });
    s = step(s, { kind: "player", tune: s.tune, report: "failed" });
    expect(s).toMatchObject({ signal: "noSignal", hops: RADIO_MAX_HOPS });
    expect(step(s, { kind: "player", tune: s.tune, report: "failed" })).toBe(s);
    expect(step(s, { kind: "retry" })).toMatchObject({ signal: "tuning", hops: 0 });
  });

  it("any + duck -> same signal (stored; the same level changes nothing)", () => {
    const s = step(onAt("c"), { kind: "duck", level: "speech" });
    expect(s.duck).toBe("speech");
    expect(step(s, { kind: "duck", level: "speech" })).toBe(s);
  });

  it("playing + any -> silent (a station that left the list switches the radio off)", () => {
    const s = onAt("gone");
    expect(step(s, { kind: "closePanel" })).toMatchObject({ power: "off", stationId: null, signal: "silent", tune: 6 });
  });
});

describe("pickIndex and hopTarget", () => {
  it("maps 0 to 1 onto the indexes, ends included", () => {
    expect([0, 0.19, 0.2, 0.99, 1, -3, 9, Number.NaN].map((p) => pickIndex(p, 5))).toEqual([0, 0, 1, 4, 4, 0, 4, 0]);
  });

  it("hops east within the kind, then to any station", () => {
    expect(hopTarget("d", LIST)).toBe("b");
    expect(hopTarget("a", LIST)).toBe("b");
    expect(hopTarget("x", LIST)).toBeNull();
    expect(hopTarget("b", [st("b", 0, true), st("c", 1, false)])).toBe("c");
    expect(hopTarget("b", [st("b", 0, true)])).toBeNull();
  });
});

describe("radioView", () => {
  it("off with the default volume is RADIO_OFF_VIEW itself", () => {
    expect(radioView(INITIAL_RADIO, LIST)).toBe(RADIO_OFF_VIEW);
    expect(radioView({ ...INITIAL_RADIO, volume: 0.2 }, LIST)).toEqual({ ...RADIO_OFF_VIEW, volume: 0.2 });
  });

  it("on shows the station looked up", () => {
    expect(radioView(onAt("c"), LIST)).toEqual({ power: "on", panel: "open", station: LIST[2], signal: "playing", volume: 0.8 });
  });
});

describe("radioEffects", () => {
  it("a press from off loads the rock station, sets the gain and arms the start limit", () => {
    const after = step(INITIAL_RADIO, { kind: "press", pick: 0 });
    expect(radioEffects(INITIAL_RADIO, after, LIST)).toEqual([
      { kind: "gain", volume: 0.8, duck: "none" },
      { kind: "load", url: "https://radio.test/b", tune: 1 },
      { kind: "armStart", tune: 1 },
    ]);
  });

  it("playing clears the start limit; a stall arms it again", () => {
    const tuning = onAt("c", "tuning");
    const playing = step(tuning, { kind: "player", tune: 5, report: "playing" });
    expect(radioEffects(tuning, playing, LIST)).toEqual([{ kind: "clearStart" }]);
    const stalled = step(playing, { kind: "player", tune: 5, report: "waiting" });
    expect(radioEffects(playing, stalled, LIST)).toEqual([{ kind: "armStart", tune: 5 }]);
  });

  it("off stops the player", () => {
    const s = onAt("c");
    expect(radioEffects(s, step(s, { kind: "powerOff" }), LIST)).toEqual([{ kind: "clearStart" }, { kind: "stop" }]);
  });

  it("the duck and the volume reach the gain only while on", () => {
    const s = onAt("c");
    expect(radioEffects(s, step(s, { kind: "duck", level: "call" }), LIST)).toEqual([{ kind: "gain", volume: 0.8, duck: "call" }]);
    expect(radioEffects(INITIAL_RADIO, step(INITIAL_RADIO, { kind: "duck", level: "call" }), LIST)).toEqual([]);
  });

  it("nothing changed, nothing to do", () => {
    const s = onAt("c");
    expect(radioEffects(s, s, LIST)).toEqual([]);
    expect(radioEffects(s, steps(s, [{ kind: "closePanel" }]), LIST)).toEqual([]);
  });
});
