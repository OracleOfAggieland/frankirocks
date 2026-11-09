import { describe, expect, it } from "vitest";
import type { LookName } from "../avatar/types";
import { type SoundGate, type SoundTrack, initialSoundTrack, scheduleCues } from "./schedule";

const open: SoundGate = { gestured: true, soundOn: true, outputMuted: true };
const none = { cardArrived: false, receiptShown: false };
const step = (prev: SoundTrack, name: LookName, at: number, gate = open, extra = none) => scheduleCues(prev, { name, at }, extra, gate);

describe("scheduleCues", () => {
  it("plays wake when the look becomes Waking, once", () => {
    const a = step(initialSoundTrack, "Waking", 0);
    expect(a.cues).toEqual(["wake"]);
    expect(step(a.track, "Waking", 16).cues).toEqual([]);
  });

  it("plays thinking once after 1 s of Thinking", () => {
    let t = step(initialSoundTrack, "Thinking", 0);
    expect(t.cues).toEqual([]);
    t = step(t.track, "Thinking", 1000);
    expect(t.cues).toEqual([]);
    t = step(t.track, "Thinking", 1001);
    expect(t.cues).toEqual(["thinking"]);
    expect(step(t.track, "Thinking", 3000).cues).toEqual([]);
  });

  it("plays celebrate, card and receipt", () => {
    expect(step(initialSoundTrack, "Celebrate", 0).cues).toEqual(["celebrate"]);
    expect(step(initialSoundTrack, "Listening", 0, open, { cardArrived: true, receiptShown: true }).cues).toEqual(["card", "receipt"]);
  });

  it.each([
    ["before the first gesture", { ...open, gestured: false }],
    ["with sound off", { ...open, soundOn: false }],
    ["while the voice is audible", { ...open, outputMuted: false }],
  ])("plays nothing %s, and a blocked cue does not play later", (_name, closed) => {
    const blocked = step(initialSoundTrack, "Waking", 0, closed);
    expect(blocked.cues).toEqual([]);
    expect(blocked.track.name).toBe("Waking");
    expect(step(blocked.track, "Waking", 16).cues).toEqual([]);
    const thinking = step(step(initialSoundTrack, "Thinking", 0).track, "Thinking", 1500, closed);
    expect(thinking.cues).toEqual([]);
    expect(step(thinking.track, "Thinking", 1600).cues).toEqual([]);
  });
});
