// Sound_Cue scores (lab-ui-foundation R19.1, R19.5; design "Sound engine"). Pure. Every cue is
// synthesized from these notes; no audio file is loaded.

export type Cue = "wake" | "thinking" | "card" | "celebrate" | "receipt";
export const CUES: readonly Cue[] = ["wake", "thinking", "card", "celebrate", "receipt"];

export interface Note {
  /** "noise" is band-passed white noise centred on `freq`. */
  type: "sine" | "triangle" | "noise";
  freq: number;
  startMs: number;
  durMs: number;
  peakGain: number;
}

/** No cue note is louder than this, so cues sit well below Franki's voice. */
export const MAX_CUE_GAIN = 0.25;

const SCORES: Record<Cue, readonly Note[]> = {
  // A rising three-note figure with a crackle, under 1.5 s.
  wake: [
    { type: "sine", freq: 330, startMs: 0, durMs: 260, peakGain: 0.16 },
    { type: "sine", freq: 440, startMs: 220, durMs: 260, peakGain: 0.17 },
    { type: "sine", freq: 660, startMs: 440, durMs: 520, peakGain: 0.18 },
    { type: "noise", freq: 3200, startMs: 0, durMs: 360, peakGain: 0.05 },
  ],
  // A very faint crackle.
  thinking: [{ type: "noise", freq: 2600, startMs: 0, durMs: 400, peakGain: 0.02 }],
  // A soft glassy tap.
  card: [{ type: "triangle", freq: 1760, startMs: 0, durMs: 80, peakGain: 0.08 }],
  // A short bright chime.
  celebrate: [
    { type: "sine", freq: 784, startMs: 0, durMs: 300, peakGain: 0.14 },
    { type: "sine", freq: 1175, startMs: 120, durMs: 420, peakGain: 0.12 },
  ],
  // A quick paper-printer whirr.
  receipt: [{ type: "noise", freq: 900, startMs: 0, durMs: 600, peakGain: 0.06 }],
};

export function scoreFor(cue: Cue): Note[] {
  return SCORES[cue].map((n) => ({ ...n }));
}

/** When the last note of a score ends, in ms. */
export function scoreLengthMs(notes: readonly Note[]): number {
  return notes.reduce((end, n) => Math.max(end, n.startMs + n.durMs), 0);
}
