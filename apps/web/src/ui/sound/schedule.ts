// Sound_Cue scheduling (lab-ui-foundation R19.2 to R19.4, R19.7, R19.8; design "Sound engine"). Pure.
import type { LookName } from "../avatar/types";
import type { Cue } from "./score";

export interface SoundGate {
  /** The Visit has had a user gesture. */
  gestured: boolean;
  /** The Sound_Toggle is on. */
  soundOn: boolean;
  /** Franki's voice is not audible. Cues never play over the voice. */
  outputMuted: boolean;
}

export interface SoundTrack {
  name: LookName | null;
  /** Frame_Time the current look began. */
  since: number | null;
  /** The thinking cue's moment has come in this Thinking period (played or blocked). */
  thinkingCued: boolean;
}

export const initialSoundTrack: SoundTrack = { name: null, since: null, thinkingCued: false };

/** Thinking must last longer than this, in Frame_Time ms, before its cue. */
export const THINKING_CUE_AFTER_MS = 1000;

export function gateOpen(gate: SoundGate): boolean {
  return gate.gestured && gate.soundOn && gate.outputMuted;
}

/**
 * The cues for one step. The track always updates, so a cue blocked by a closed gate at its moment
 * does not play later.
 */
export function scheduleCues(
  prev: SoundTrack,
  look: { name: LookName; at: number },
  extra: { cardArrived: boolean; receiptShown: boolean },
  gate: SoundGate,
): { track: SoundTrack; cues: Cue[] } {
  const due: Cue[] = [];
  let track = prev;
  if (look.name !== prev.name) {
    track = { name: look.name, since: look.at, thinkingCued: false };
    if (look.name === "Waking") due.push("wake");
    if (look.name === "Celebrate") due.push("celebrate");
  }
  if (track.name === "Thinking" && !track.thinkingCued && track.since !== null && look.at - track.since > THINKING_CUE_AFTER_MS) {
    track = { ...track, thinkingCued: true };
    due.push("thinking");
  }
  if (extra.cardArrived) due.push("card");
  if (extra.receiptShown) due.push("receipt");
  return { track, cues: gateOpen(gate) ? due : [] };
}
