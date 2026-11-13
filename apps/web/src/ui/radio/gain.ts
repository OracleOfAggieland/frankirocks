// How loud the radio plays (brief 047, ruling 8). Pure: Franki's voice comes first, so the radio plays quieter in a
// call and quieter still while anyone is speaking or a reply is being prepared.
import { type VoiceState, avatarState } from "@franki/core";

/** How far the call ducks the radio. `none`: no call is open. */
export type RadioDuck = "none" | "call" | "speech";

/** A call is open and nobody is speaking: this share of the owner's volume. */
export const RADIO_CALL_GAIN = 0.4;
/** The owner or Franki is speaking, or a reply is being prepared: this share of the owner's volume. */
export const RADIO_SPEECH_GAIN = 0.12;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** The element's volume, 0 to 1, for the owner's volume and the duck level. */
export function radioGain(volume: number, duck: RadioDuck): number {
  const v = clamp01(volume);
  switch (duck) {
    case "none":
      return v;
    case "call":
      return v * RADIO_CALL_GAIN;
    case "speech":
      return v * RADIO_SPEECH_GAIN;
    default:
      duck satisfies never;
      return 0;
  }
}

/**
 * The duck level a voice snapshot asks for. `none` while the call is closed; `speech` while the owner's speech is
 * open (a `speech_started` with no `speech_stopped` yet), while a reply is being prepared (the avatar thinks), and
 * while Franki speaks; `call` otherwise, connecting and recovery included.
 */
export function radioDuck(v: VoiceState): RadioDuck {
  if (v.phase === "CLOSED") return "none";
  if (v.speech.some((x) => x.startMs !== null && x.endMs === null)) return "speech";
  const look = avatarState(v);
  if (look === "thinking" || look === "speaking") return "speech";
  return "call";
}
