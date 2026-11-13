import { type VoiceItem, type VoiceState, type VoiceTurn, initialVoiceState } from "@franki/core";
import { describe, expect, it } from "vitest";
import { RADIO_CALL_GAIN, RADIO_SPEECH_GAIN } from "../ui/radio/gain";
import { RADIO_START_LIMIT_MS } from "../ui/radio/radio-machine";
import { RADIO_OFF_VIEW, type Station } from "../ui/radio/types";
import type { RadioPlayerPort, RadioPlayerReport } from "./radio-player";
import { RADIO_FIRED_LIMIT, RadioWatch, ownerSpokenItems } from "./radio-watch";

const st = (id: string, lon: number, rock: boolean): Station => ({ id, name: `Name ${id}`, city: `City ${id}`, country: "Land", lat: 0, lon, url: `https://radio.test/${id}`, rock });
const LIST: readonly Station[] = [st("a", -100, false), st("b", -50, true), st("c", 0, false), st("d", 50, true)];

const BASE = initialVoiceState({ transcribeModel: "test" });
const item = (itemId: string, transcript: string | null): VoiceItem => ({ itemId, commitSeq: 1, committedAt: 0, transcript, durationMs: 500 });
const turn = (items: VoiceItem[], source: VoiceTurn["source"] = "asr", text: string | null = null): VoiceTurn => ({
  turnId: "t1",
  source,
  text,
  items,
  tEnd: 0,
  posted: null,
  staleRetried: false,
});
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const listening = (patch: Partial<VoiceState> = {}): VoiceState => ({ ...BASE, phase: "LISTENING", ...patch });

function harness(randoms: number[] = [0]) {
  const calls: string[] = [];
  let listener: ((tune: number, report: RadioPlayerReport) => void) | null = null;
  const player: RadioPlayerPort = {
    load: (url, tune) => calls.push(`load ${url} ${tune}`),
    stop: () => calls.push("stop"),
    setGain: (g) => calls.push(`gain ${Math.round(g * 1000) / 1000}`),
    onReport: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    dispose: () => calls.push("dispose"),
  };
  let now = 0;
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let nextId = 1;
  let rocks = 0;
  const watch = new RadioWatch({
    player,
    stations: LIST,
    random: () => randoms.shift() ?? 0,
    onRock: () => rocks++,
    timers: {
      setTimeout: (fn, ms) => {
        const id = nextId++;
        timers.push({ fn, at: now + ms, id });
        return id;
      },
      clearTimeout: (h) => {
        const i = timers.findIndex((t) => t.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
    },
  });
  let published = 0;
  watch.subscribe(() => published++);
  const advance = () => {
    timers.sort((a, b) => a.at - b.at);
    const t = timers.shift();
    if (t === undefined) return false;
    now = t.at;
    t.fn();
    return true;
  };
  return {
    watch,
    calls,
    timers,
    advance,
    report: (tune: number, r: RadioPlayerReport) => listener?.(tune, r),
    rocks: () => rocks,
    published: () => published,
    clock: () => now,
  };
}

describe("ownerSpokenItems", () => {
  it("reads completed spoken items of ASR Turns only", () => {
    expect(ownerSpokenItems(BASE)).toEqual([]);
    const v = listening({
      turn: turn([item("i1", "hello"), item("i2", null), item("i3", "  ")]),
      heldBack: turn([item("h1", "held")]),
      missing: [{ turnId: "t0", clientSeq: 1, body: {} as never, items: [item("m1", "late")], until: 0 }],
    });
    expect(ownerSpokenItems(v).map((i) => i.itemId)).toEqual(["i1", "h1", "m1"]);
    expect(ownerSpokenItems(listening({ turn: turn([item("p1", "Franki you rock")], "pasted", "Franki you rock") }))).toEqual([]);
    expect(ownerSpokenItems(listening({ turn: turn([], "typed", "Franki you rock") }))).toEqual([]);
  });
});

describe("RadioWatch", () => {
  it("starts off, with RADIO_OFF_VIEW, and a stable snapshot", () => {
    const h = harness();
    expect(h.watch.getSnapshot()).toBe(RADIO_OFF_VIEW);
    h.watch.controls.closePanel();
    h.watch.onVoice(BASE);
    expect(h.watch.getSnapshot()).toBe(RADIO_OFF_VIEW);
    expect(h.published()).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it("press: on, panel open, a rock station loaded inside the call, the start limit armed", () => {
    const h = harness([0.9]);
    h.watch.controls.press();
    expect(h.calls).toEqual(["gain 0.8", "load https://radio.test/d 1"]);
    expect(h.watch.getSnapshot()).toMatchObject({ power: "on", panel: "open", signal: "tuning", station: LIST[3] });
    expect(h.timers.map((t) => t.at)).toEqual([RADIO_START_LIMIT_MS]);
    const snap = h.watch.getSnapshot();
    h.report(1, "playing");
    expect(h.watch.getSnapshot()).not.toBe(snap);
    expect(h.watch.getSnapshot().signal).toBe("playing");
    expect(h.timers).toHaveLength(0);
  });

  it("a stream that never starts hops after the start limit, at most three times", () => {
    const h = harness([0]);
    h.watch.controls.press();
    for (let i = 0; i < 3; i++) expect(h.advance()).toBe(true);
    expect(h.watch.getSnapshot().signal).toBe("tuning");
    expect(h.advance()).toBe(true);
    expect(h.watch.getSnapshot().signal).toBe("noSignal");
    expect(h.timers).toHaveLength(0);
    expect(h.calls.filter((c) => c.startsWith("load"))).toEqual([
      "load https://radio.test/b 1",
      "load https://radio.test/d 2",
      "load https://radio.test/b 3",
      "load https://radio.test/d 4",
    ]);
  });

  it("drops a report for an older tune", () => {
    const h = harness();
    h.watch.controls.press();
    h.watch.controls.step(1);
    const snap = h.watch.getSnapshot();
    h.report(1, "playing");
    h.report(1, "failed");
    expect(h.watch.getSnapshot()).toBe(snap);
  });

  it("off stops the player and clears the timer; a report after it changes nothing", () => {
    const h = harness();
    h.watch.controls.press();
    h.watch.controls.powerOff();
    expect(h.calls.at(-1)).toBe("stop");
    expect(h.timers).toHaveLength(0);
    expect(h.watch.getSnapshot()).toBe(RADIO_OFF_VIEW);
    h.report(1, "playing");
    expect(h.watch.getSnapshot()).toBe(RADIO_OFF_VIEW);
  });

  it("blocked shows tap to play; retry loads again inside the press", () => {
    const h = harness();
    h.watch.controls.press();
    h.report(1, "blocked");
    expect(h.watch.getSnapshot().signal).toBe("tapToPlay");
    h.watch.controls.retry();
    expect(h.calls.at(-1)).toBe("load https://radio.test/b 2");
  });

  it("a player that reports during load is handled after the step that loaded it", () => {
    const h = harness();
    const watch = h.watch as unknown as { deps: { player: RadioPlayerPort } };
    const load = watch.deps.player.load;
    watch.deps.player.load = (url, tune) => {
      load(url, tune);
      if (tune === 1) h.report(1, "failed");
    };
    h.watch.controls.press();
    expect(h.watch.getSnapshot()).toMatchObject({ signal: "tuning", station: LIST[3] });
    expect(h.timers).toHaveLength(1);
    h.advance();
    expect(h.watch.getSnapshot().station).toBe(LIST[1]);
  });

  it("the spoken rock phrase turns it on and celebrates, once per item", () => {
    const h = harness();
    const v = listening({ turn: turn([item("i1", "Frankie, you rock!")]) });
    h.watch.onVoice(v);
    expect(h.rocks()).toBe(1);
    expect(h.watch.getSnapshot()).toMatchObject({ power: "on", panel: "open" });
    h.watch.onVoice(v);
    h.watch.onVoice(listening({ heldBack: turn([item("i1", "Frankie, you rock!")]) }));
    expect(h.rocks()).toBe(1);
  });

  it("an item fires when its transcript arrives, not before", () => {
    const h = harness();
    h.watch.onVoice(listening({ turn: turn([item("i1", null)]) }));
    expect(h.rocks()).toBe(0);
    h.watch.onVoice(listening({ turn: turn([item("i1", "franky you rock")]) }));
    expect(h.rocks()).toBe(1);
  });

  it("the spoken off phrase turns it off, only while on", () => {
    const h = harness();
    h.watch.onVoice(listening({ turn: turn([item("i1", "radio off")]) }));
    expect(h.calls).toEqual([]);
    h.watch.controls.press();
    h.watch.onVoice(listening({ turn: turn([item("i2", "turn the music off")]) }));
    expect(h.watch.getSnapshot()).toBe(RADIO_OFF_VIEW);
  });

  it("a typed line fires each time it is sent", () => {
    const h = harness();
    h.watch.onTypedLine("Franki rocks");
    h.watch.onTypedLine("Franki rocks");
    expect(h.rocks()).toBe(2);
    h.watch.onTypedLine("stop the radio");
    expect(h.watch.getSnapshot().power).toBe("off");
    h.watch.onTypedLine("you rock");
    expect(h.rocks()).toBe(2);
  });

  it("pasted and typed Turns in the voice state never reach the phrase", () => {
    const h = harness();
    h.watch.onVoice(listening({ turn: turn([item("p1", "Franki you rock")], "pasted", "Franki you rock") }));
    h.watch.onVoice(listening({ turn: turn([], "typed", "Franki you rock") }));
    expect(h.rocks()).toBe(0);
  });

  it(`remembers at most ${RADIO_FIRED_LIMIT} fired items`, () => {
    const h = harness();
    for (let i = 0; i < RADIO_FIRED_LIMIT + 10; i++) h.watch.onVoice(listening({ turn: turn([item(`i${i}`, "hello")]) }));
    const fired = (h.watch as unknown as { fired: string[] }).fired;
    expect(fired).toHaveLength(RADIO_FIRED_LIMIT);
    expect(fired[0]).toBe("i10");
  });

  it("ducks by the voice state: none, call, speech", () => {
    const h = harness();
    h.watch.controls.press();
    h.calls.length = 0;
    h.watch.onVoice(listening());
    h.watch.onVoice(listening({ speech: [{ itemId: "i1", startMs: 1, endMs: null }] }));
    h.watch.onVoice(listening({ phase: "SPEAKING" }));
    h.watch.onVoice(BASE);
    expect(h.calls).toEqual([`gain ${r3(0.8 * RADIO_CALL_GAIN)}`, `gain ${r3(0.8 * RADIO_SPEECH_GAIN)}`, "gain 0.8"]);
  });

  it("the volume reaches the player, ducked", () => {
    const h = harness();
    h.watch.onVoice(listening());
    h.watch.controls.press();
    expect(h.calls[0]).toBe(`gain ${r3(0.8 * RADIO_CALL_GAIN)}`);
    h.watch.controls.setVolume(0.5);
    expect(h.calls.at(-1)).toBe(`gain ${r3(0.5 * RADIO_CALL_GAIN)}`);
    expect(h.watch.getSnapshot().volume).toBe(0.5);
  });

  it("dispose stops sound, clears the timer and ignores everything after", () => {
    const h = harness();
    h.watch.controls.press();
    h.watch.dispose();
    expect(h.calls.slice(-2)).toEqual(["stop", "dispose"]);
    expect(h.timers).toHaveLength(0);
    h.watch.controls.press();
    h.watch.onTypedLine("Franki you rock");
    expect(h.calls.at(-1)).toBe("dispose");
    expect(h.rocks()).toBe(0);
  });
});
