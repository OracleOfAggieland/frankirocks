// Prototype franki.html 269-270 and 299-370 (section 3: FFT_N, SIM_RATE, Probe), ported in WP8. Verbatim:
// allowed edits E1, E3 only (design note §1.3). The Probe reads the analyser data the AvatarAudioSource fills
// (§2.4 D1), so every feature is the prototype's. Not ported: spectrumDb, VOWELS, SpeechSynth (dev-only copies
// live in app/specimens/_sim), the `audio` taps (the Level_Meter does that), `sim` and `listen`.
import { notPorted } from "./errors";

export const FFT_N = 1024;
export const SIM_RATE = 48000;

/** Per-source analysis: level, mouth envelope A', spectral centroid, onsets, claps, syllables, plosives. */
export class Probe {
  name!: string;
  time!: Float32Array<ArrayBuffer>;
  db!: Float32Array<ArrayBuffer>;
  prev!: Float32Array<ArrayBuffer>;
  sr!: number;
  level!: number; a!: number; cent!: number; centHz!: number; flux!: number;
  fluxHist!: Float32Array<ArrayBuffer>; fh!: number; fluxAcc!: number;
  onset!: boolean; clap!: boolean; syllable!: boolean; plosive!: boolean;
  lastOnset!: number; lastSyl!: number; lastLoud!: number;
  hist!: number[];
  /** Unset until the first analyse, as in the prototype (`this.peak || 0`, 339). */
  peak?: number;
  constructor(name: string) {
    notPorted("Probe", name);
  }
  silence(): void {
    notPorted("Probe.silence");
  }
  analyse(dt: number, now: number): void {
    notPorted("Probe.analyse", dt, now);
  }
}

/** The name `audio` keeps the verbatim `audio.voice.a` and `audio.mic.level` reads. */
export interface ProbesPart {
  audio: { mic: Probe; voice: Probe };
}

/** `mic: new Probe('mic'), voice: new Probe('voice')` (461-462). */
export function createProbes(): ProbesPart {
  return notPorted("createProbes");
}
