import { type VoiceState, initialVoiceState } from "@franki/core";
import { describe, expect, it } from "vitest";
import { RADIO_CALL_GAIN, RADIO_SPEECH_GAIN, radioDuck, radioGain } from "./gain";

const BASE = initialVoiceState({ transcribeModel: "test" });
const at = (patch: Partial<VoiceState>): VoiceState => ({ ...BASE, ...patch });
const OPEN_SPEECH = [{ itemId: "i1", startMs: 100, endMs: null }];
const DONE_SPEECH = [{ itemId: "i1", startMs: 100, endMs: 900 }];

describe("radioGain", () => {
  it.each([
    [0.8, "none", 0.8],
    [0.8, "call", 0.8 * RADIO_CALL_GAIN],
    [0.8, "speech", 0.8 * RADIO_SPEECH_GAIN],
    [1, "call", 0.4],
    [1, "speech", 0.12],
    [0, "none", 0],
    [2, "none", 1],
    [-1, "speech", 0],
    [Number.NaN, "none", 0],
  ] as const)("volume %s, duck %s -> %s", (volume, duck, want) => {
    expect(radioGain(volume, duck)).toBeCloseTo(want, 10);
  });
});

describe("radioDuck", () => {
  it.each([
    ["closed", at({ phase: "CLOSED" }), "none"],
    ["closed even with speech left over", at({ phase: "CLOSED", speech: OPEN_SPEECH }), "none"],
    ["connecting", at({ phase: "CONNECTING" }), "call"],
    ["configuring", at({ phase: "CONFIGURING" }), "call"],
    ["listening, quiet", at({ phase: "LISTENING" }), "call"],
    ["listening, speech ended", at({ phase: "LISTENING", speech: DONE_SPEECH }), "call"],
    ["listening, the owner speaking", at({ phase: "LISTENING", speech: OPEN_SPEECH }), "speech"],
    ["waiting for the item", at({ phase: "WAIT_ITEM" }), "speech"],
    ["judging", at({ phase: "JUDGING" }), "speech"],
    ["speculating", at({ phase: "SPECULATING" }), "speech"],
    ["held", at({ phase: "HELD" }), "speech"],
    ["tool wait", at({ phase: "TOOL_WAIT" }), "speech"],
    ["swapping", at({ phase: "SWAPPING" }), "speech"],
    ["Franki speaking", at({ phase: "SPEAKING" }), "speech"],
    ["Franki speaking, output muted", at({ phase: "SPEAKING", outputMuted: true }), "speech"],
    ["recovery", at({ phase: "RECOVERY" }), "call"],
  ] as const)("%s -> %s", (_why, v, want) => {
    expect(radioDuck(v)).toBe(want);
  });
});
