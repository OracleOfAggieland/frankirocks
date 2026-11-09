import { describe, expect, it } from "vitest";
import { AVATAR_LABELS } from "../copy";
import { isAvatarLook, lookFor } from "./look";
import type { AvatarEvent, AvatarInput, LookName } from "./types";

const base: AvatarInput = {
  state: "listening",
  micMuted: false,
  outputMuted: false,
  inputLevel: 0,
  outputLevel: 0,
  event: null,
  eventElapsedMs: 0,
  firstConnecting: false,
  reducedMotion: false,
};
const input = (patch: Partial<AvatarInput>): AvatarInput => ({ ...base, ...patch });

/** One hand-built input per Look_Name. */
const LOOK_INPUTS: Record<LookName, Partial<AvatarInput>> = {
  Dormant: { state: "closed" },
  Waking: { state: "connecting", firstConnecting: true, event: "wake" },
  Connecting: { state: "connecting" },
  Listening: { state: "listening" },
  Thinking: { state: "thinking" },
  Speaking: { state: "speaking" },
  Recovery: { state: "recovery" },
  Presenting: { state: "listening", event: "present-card" },
  Awaiting_Approval: { state: "listening", event: "await-approval" },
  Celebrate: { state: "listening", event: "celebrate" },
};

type Row = [LookName, string, string, string, string, string, boolean, string];
// name, eyes, glow, posture, bolts, body, electric, animations
const FULL: Row[] = [
  ["Dormant", "closed", "dim", "sunk", "off", "breathe", false, "float:infinite breathe:infinite"],
  ["Waking", "wide", "flare", "rising", "strike", "rise", true, "float:infinite strike:1 rise:1"],
  ["Connecting", "half", "flicker", "neutral", "flicker", "still", true, "float:infinite flicker:infinite"],
  ["Listening", "open", "level", "lean", "idle", "still", false, "float:infinite blink:infinite"],
  ["Thinking", "glance-up", "steady", "neutral", "arc", "still", true, "float:infinite arc:infinite glance:1"],
  ["Speaking", "open", "steady", "neutral", "idle", "squish", false, "float:infinite"],
  ["Recovery", "squint", "low", "wobble", "fizzle", "wobble", true, "float:infinite wobble:2 fizzle:1"],
  ["Presenting", "glance-card", "steady", "turn", "idle", "still", false, "float:infinite glance:1"],
  ["Awaiting_Approval", "expectant", "steady", "nod", "idle", "nod", false, "float:infinite nod:infinite"],
  ["Celebrate", "happy", "gold", "rising", "sparks", "rise", true, "float:infinite rise:1 sparks:1"],
];
const REDUCED: Row[] = [
  ["Dormant", "closed", "dim", "sunk", "off", "still", false, ""],
  ["Waking", "wide", "flare", "rising", "glow", "still", false, "fade:1"],
  ["Connecting", "half", "low", "neutral", "glow", "still", false, ""],
  ["Listening", "open", "level", "lean", "idle", "still", false, ""],
  ["Thinking", "glance-up", "steady", "neutral", "glow", "still", false, ""],
  ["Speaking", "open", "steady", "neutral", "idle", "still", false, ""],
  ["Recovery", "squint", "low", "wobble", "one-dark", "still", false, ""],
  ["Presenting", "glance-card", "steady", "turn", "idle", "still", false, "fade:1"],
  ["Awaiting_Approval", "expectant", "steady", "nod", "idle", "still", false, ""],
  ["Celebrate", "happy", "gold", "rising", "gold-glow", "still", false, "fade:1"],
];

describe("Look_Mapper look table", () => {
  it.each([
    ...FULL.map((r) => [false, ...r] as const),
    ...REDUCED.map((r) => [true, ...r] as const),
  ])("reduced=%s %s", (reducedMotion, name, eyes, glow, posture, bolts, body, electric, animations) => {
    const look = lookFor(input({ ...LOOK_INPUTS[name], reducedMotion }));
    expect(isAvatarLook(look)).toBe(true);
    expect(look).toMatchObject({ name, eyes, glow, posture, bolts, body, electric, blur: !reducedMotion, ghost: false, bodyOpacity: 1 });
    expect(look.animations.map((a) => `${a.id}:${a.iterations}`).join(" ")).toBe(animations);
  });
});

describe("Look_Mapper rules", () => {
  it("labels come from the state", () => {
    for (const state of ["closed", "connecting", "listening", "thinking", "speaking", "recovery"] as const) {
      expect(lookFor(input({ state })).label).toBe(AVATAR_LABELS[state]);
    }
    expect(lookFor(input({ state: "listening", event: "celebrate" })).label).toBe("Franki is listening");
  });

  it("speaking with output muted gives Thinking and 'Franki is thinking'", () => {
    const look = lookFor(input({ state: "speaking", outputMuted: true, outputLevel: 0.9 }));
    expect(look.name).toBe("Thinking");
    expect(look.label).toBe("Franki is thinking");
    expect(look.follows).toBe("none");
    expect(look.body).not.toBe("squish");
  });

  it("wake shows over connecting, continues into listening, and hang-up or recovery end it", () => {
    expect(lookFor(input({ state: "connecting", event: "wake", firstConnecting: true })).name).toBe("Waking");
    expect(lookFor(input({ state: "connecting", firstConnecting: false })).name).toBe("Connecting");
    expect(lookFor(input({ state: "listening", event: "wake", eventElapsedMs: 600, firstConnecting: true })).name).toBe("Waking");
    expect(lookFor(input({ state: "thinking", event: "wake", eventElapsedMs: 1199 })).name).toBe("Waking");
    expect(lookFor(input({ state: "listening", event: "wake", eventElapsedMs: 1200 })).name).toBe("Listening");
    expect(lookFor(input({ state: "closed", event: "wake", firstConnecting: true })).name).toBe("Dormant");
    expect(lookFor(input({ state: "recovery", event: "wake", firstConnecting: true })).name).toBe("Recovery");
  });

  it("events end after their durations", () => {
    const at = (event: AvatarEvent, eventElapsedMs: number) => lookFor(input({ event, eventElapsedMs })).name;
    expect(at("present-card", 799)).toBe("Presenting");
    expect(at("present-card", 800)).toBe("Listening");
    expect(at("celebrate", 1599)).toBe("Celebrate");
    expect(at("celebrate", 1600)).toBe("Listening");
    expect(at("await-approval", 100000)).toBe("Awaiting_Approval");
  });

  it("Listening and Speaking differ in posture and follows", () => {
    const listening = lookFor(input({ state: "listening" }));
    const speaking = lookFor(input({ state: "speaking" }));
    expect(listening.eyes).toBe(speaking.eyes);
    expect(listening.posture).not.toBe(speaking.posture);
    expect(listening.follows).toBe("input");
    expect(speaking.follows).toBe("output");
  });

  it("an event over speaking still follows the voice", () => {
    const look = lookFor(input({ state: "speaking", event: "present-card", outputLevel: 0.5 }));
    expect(look.name).toBe("Presenting");
    expect(look).toMatchObject({ follows: "output", drive: 0.5, body: "squish" });
  });

  it("ghost mode keeps name and label", () => {
    const look = lookFor(input({ micMuted: true }));
    expect(look).toMatchObject({ name: "Listening", ghost: true, bodyOpacity: 0.35, eyeOpacity: 1, label: "Franki is listening" });
  });
});
