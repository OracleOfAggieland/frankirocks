// Brief 047 part D: the seams the lab feeds the radio through. What a sent line lets the radio hear, and the voice
// feed, which must leave the radio at duck level "none" when it ends.
import { type VoiceState, initialVoiceState } from "@franki/core";
import { describe, expect, it } from "vitest";
import { radioDuck } from "../ui/radio/gain";
import { STATIONS } from "../ui/radio/stations";
import { RADIO_CLOSED_VOICE, createRadioHost, feedRadioVoice, radioHears } from "./radio-live";
import type { RadioPlayerPort } from "./radio-player";
import { RadioWatch } from "./radio-watch";

describe("radioHears", () => {
  it("passes the owner's typed words as they are", () => {
    expect(radioHears("Franki, you rock", false)).toBe("Franki, you rock");
  });
  it("never hears a pasted line", () => {
    expect(radioHears("Franki, you rock", true)).toBeNull();
  });
  it("hears nothing in an empty line", () => {
    expect(radioHears("   ", false)).toBeNull();
  });
});

function fakeVoice(initial: VoiceState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => state,
    set(next: VoiceState) {
      state = next;
      listeners.forEach((l) => l());
    },
    listeners,
  };
}

function rig() {
  const gains: number[] = [];
  const player: RadioPlayerPort = { load: () => {}, stop: () => {}, setGain: (g) => gains.push(g), onReport: () => () => {}, dispose: () => {} };
  const radio = new RadioWatch({ player, timers: { setTimeout: () => 0, clearTimeout: () => {} }, random: () => 0, stations: STATIONS });
  return { radio, gains };
}

describe("createRadioHost", () => {
  it("makes a watch on start, disposes it for good on stop, and makes a new one on the next start (StrictMode)", () => {
    const made: RadioWatch[] = [];
    const host = createRadioHost(() => {
      const w = rig().radio;
      made.push(w);
      return w;
    });
    let told = 0;
    host.subscribe(() => told++);
    expect(host.getSnapshot()).toBeNull();
    host.start();
    host.start();
    expect(made).toHaveLength(1);
    expect(host.getSnapshot()).toBe(made[0]);
    host.stop();
    expect(host.getSnapshot()).toBeNull();
    made[0]!.controls.press();
    expect(made[0]!.getSnapshot().power).toBe("off");
    host.start();
    expect(made).toHaveLength(2);
    expect(host.getSnapshot()).toBe(made[1]);
    expect(told).toBe(3);
  });
});

describe("feedRadioVoice", () => {
  const base = initialVoiceState({ transcribeModel: "m" });

  it("the closed call it feeds at the end ducks nothing", () => {
    expect(RADIO_CLOSED_VOICE.phase).toBe("CLOSED");
    expect(radioDuck(RADIO_CLOSED_VOICE)).toBe("none");
  });

  it("ducks the radio while a call is open, and gives the owner's volume back when the feed ends", () => {
    const { radio, gains } = rig();
    radio.controls.press();
    const volume = radio.getSnapshot().volume;
    const voice = fakeVoice(base);
    const stop = feedRadioVoice(radio, voice);
    voice.set({ ...base, phase: "LISTENING" });
    expect(gains.at(-1)).toBeCloseTo(volume * 0.4);
    stop();
    expect(voice.listeners.size).toBe(0);
    expect(gains.at(-1)).toBeCloseTo(volume);
  });

  it("stops reading the voice client once ended", () => {
    const seen: VoiceState[] = [];
    const voice = fakeVoice(base);
    const stop = feedRadioVoice({ onVoice: (v) => seen.push(v) }, voice);
    voice.set({ ...base, phase: "LISTENING" });
    stop();
    voice.set({ ...base, phase: "LISTENING" });
    expect(seen.map((v) => v.phase)).toEqual(["LISTENING", "CLOSED"]);
  });
});
