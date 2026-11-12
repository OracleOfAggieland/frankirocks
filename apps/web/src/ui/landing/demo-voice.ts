// Franki's voice on the front door (brief 015, package H2). Pure and deterministic: no clock, no random
// source but a seeded one. A sentence becomes a plan of syllables; the plan gives the loudness envelope at
// any moment, and fills an analysis frame the way the avatar's audio source contract describes: the newest
// AUDIO_FFT_SIZE samples (a harmonic stack shaped by a vowel's formants, under the envelope) and their dB
// spectrum. createDemoVoice wraps that as an AvatarAudioSource that advances by the reader's `dt`.
import { mulberry32 } from "../electricity";
import { AUDIO_FFT_SIZE, AUDIO_MIN_DB, type AudioReader, type AvatarAudioSource } from "../levels/audio-source";

/** The sample rate the voice is rendered at, in Hz. */
export const VOICE_RATE = 48000;
/** Franki's speaking pitch, in Hz. */
export const VOICE_F0 = 128;
/** The quiet floor of the spectrum while voiced, in dB. */
export const VOICE_FLOOR_DB = -120;

/** Silence before the first syllable, and the pauses after a word, a comma and a full stop, in seconds. */
const LEAD_S = 0.12;
const WORD_GAP_S = 0.035;
const COMMA_GAP_S = 0.24;
const STOP_GAP_S = 0.42;
/** A syllable lasts between these, in seconds. */
const SYLLABLE_MIN_S = 0.15;
const SYLLABLE_SPREAD_S = 0.08;
/** The sum of the harmonic amplitudes at full envelope: about -16 dBFS of speech. */
const PEAK = 0.42;
const HARMONICS = 24;
/** The Blackman taper's coherent gain over two, as an analyser reports a sinusoid's magnitude. */
const WINDOW_GAIN = 0.21;

/** First three formants of seven vowels, in Hz. */
const VOWELS: readonly (readonly [number, number, number])[] = [
  [730, 1090, 2440],
  [530, 1840, 2480],
  [300, 2200, 3000],
  [570, 840, 2410],
  [340, 870, 2240],
  [660, 1720, 2410],
  [490, 1350, 1690],
];
const FORMANT_BW = [90, 110, 160] as const;
const FORMANT_GAIN = [1, 0.6, 0.3] as const;

export interface Syllable {
  /** Start, in seconds from the start of the sentence. */
  t0: number;
  dur: number;
  /** Peak of the envelope, 0..1. */
  amp: number;
  /** Index into the vowel table. */
  vowel: number;
  /** Pitch, in Hz. */
  f0: number;
}

export interface VoicePlan {
  readonly syllables: readonly Syllable[];
  /** When each word of `voiceWords(text)` starts, in seconds. */
  readonly words: readonly number[];
  /** The whole sentence, pauses included, in seconds. */
  readonly duration: number;
}

/** The words of a sentence, as the plan and the spoken line both count them. */
export function voiceWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w !== "");
}

/** About how many syllables a written word takes to say. Numbers are read out ("186" is seven). */
export function syllablesIn(word: string): number {
  const w = word.toLowerCase();
  const digits = w.replace(/[^0-9]/g, "");
  if (digits.length > 0) {
    const spoken = digits.length === 1 ? 1 : digits.length * 2 + 1;
    return spoken + (w.includes("$") ? 2 : 0);
  }
  const letters = w.replace(/[^a-z]/g, "");
  if (letters === "") return 0;
  let n = (letters.match(/[aeiouy]+/g) ?? []).length;
  if (n > 1 && letters.endsWith("e") && !/[^aeiouy]le$/.test(letters)) n -= 1;
  return Math.max(1, n);
}

/** Pure. The syllables of a sentence, their timing, pitch and loudness. The same text and seed give the same plan. */
export function planVoice(text: string, seed = 23): VoicePlan {
  const rnd = mulberry32(seed);
  const tokens = voiceWords(text);
  const counts = tokens.map(syllablesIn);
  const total = Math.max(1, counts.reduce((a, b) => a + b, 0));
  const syllables: Syllable[] = [];
  const words: number[] = [];
  let t = LEAD_S;
  let k = 0;
  tokens.forEach((token, wi) => {
    words.push(t);
    const n = counts[wi];
    for (let i = 0; i < n; i++) {
      const stressed = (n > 1 && i === 0) || (n === 1 && token.replace(/[^a-z0-9]/gi, "").length > 3);
      const dur = SYLLABLE_MIN_S + rnd() * SYLLABLE_SPREAD_S;
      const amp = (stressed ? 0.92 : 0.7) + rnd() * 0.08;
      const vowel = Math.floor(rnd() * VOWELS.length) % VOWELS.length;
      // The pitch falls gently across the sentence and lifts on a stressed syllable.
      const f0 = VOICE_F0 * (1.06 - 0.1 * (k / total)) * (stressed ? 1.05 : 1);
      syllables.push({ t0: t, dur, amp, vowel, f0 });
      t += dur;
      k += 1;
    }
    if (n > 0) t += /[,;:]$/.test(token) ? COMMA_GAP_S : /[.?!]$/.test(token) ? STOP_GAP_S : WORD_GAP_S;
  });
  return { syllables, words, duration: t };
}

/** Pure. How long the sentence takes to say, in milliseconds. */
export function speechMs(text: string): number {
  return Math.round(planVoice(text).duration * 1000);
}

/** The syllable sounding at `t` seconds, or null in a pause. */
export function syllableAt(plan: VoicePlan, t: number): Syllable | null {
  const s = plan.syllables;
  let lo = 0;
  let hi = s.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < s[mid].t0) hi = mid - 1;
    else if (t >= s[mid].t0 + s[mid].dur) lo = mid + 1;
    else return s[mid];
  }
  return null;
}

/** Pure. The loudness envelope at `t` seconds, 0..1: a rounded bump per syllable, 0 in the pauses. */
export function envelopeAt(plan: VoicePlan, t: number): number {
  if (!Number.isFinite(t)) return 0;
  const s = syllableAt(plan, t);
  if (s === null) return 0;
  const u = (t - s.t0) / s.dur;
  return s.amp * Math.pow(Math.sin(Math.PI * u), 0.8);
}

/** Pure. How many words have started by `t` seconds. */
export function wordsSpokenAt(plan: VoicePlan, t: number): number {
  let n = 0;
  while (n < plan.words.length && plan.words[n] <= t) n += 1;
  return n;
}

function formantGain(f: number, formants: readonly [number, number, number]): number {
  let g = 0.04;
  for (let i = 0; i < 3; i++) {
    const x = (f - formants[i]) / FORMANT_BW[i];
    g += FORMANT_GAIN[i] / (1 + x * x);
  }
  return g;
}

/**
 * Pure over its buffers. Fills `time` with the frame of samples that ends at `t` seconds and `db` with its
 * spectrum (`time.length / 2` bins), as an analyser would: magnitude over N with a Blackman taper. In a pause
 * the frame is silent and every bin is AUDIO_MIN_DB.
 */
export function renderVoice(plan: VoicePlan, t: number, time: Float32Array, db: Float32Array, rate = VOICE_RATE): void {
  const env = envelopeAt(plan, t);
  const s = syllableAt(plan, t);
  time.fill(0);
  if (s === null || env <= 0) {
    db.fill(AUDIO_MIN_DB);
    return;
  }
  const n = time.length;
  const bins = db.length;
  const binHz = rate / n;
  const formants = VOWELS[s.vowel];
  const weights: number[] = [];
  let sum = 0;
  for (let k = 1; k <= HARMONICS && k * s.f0 < rate / 2; k++) {
    const w = formantGain(k * s.f0, formants) / Math.sqrt(k);
    weights.push(w);
    sum += w;
  }
  const mags = new Float32Array(bins);
  const start = t - (n - 1) / rate;
  weights.forEach((w, i) => {
    const f = (i + 1) * s.f0;
    const a = (w / sum) * PEAK * env;
    // A rotating phasor: one sine and one cosine per harmonic, then a multiply per sample.
    const phase = 2 * Math.PI * f * start;
    const step = 2 * Math.PI * (f / rate);
    const ds = Math.sin(step);
    const dc = Math.cos(step);
    let sn = Math.sin(phase);
    let cs = Math.cos(phase);
    for (let j = 0; j < n; j++) {
      time[j] += a * sn;
      const next = sn * dc + cs * ds;
      cs = cs * dc - sn * ds;
      sn = next;
    }
    const b = Math.round(f / binHz);
    const m = a * WINDOW_GAIN;
    if (b >= 0 && b < bins) mags[b] += m;
    if (b - 1 >= 0 && b - 1 < bins) mags[b - 1] += m / 2;
    if (b + 1 < bins) mags[b + 1] += m / 2;
  });
  for (let k = 0; k < bins; k++) db[k] = mags[k] > 0 ? Math.max(VOICE_FLOOR_DB, 20 * Math.log10(mags[k])) : VOICE_FLOOR_DB;
}

/** The front door's voice: an AvatarAudioSource that says one sentence, advanced by the reader's `dt`. */
export interface DemoVoice extends AvatarAudioSource {
  /** Starts the sentence from its beginning. */
  start(plan: VoicePlan): void;
  /** Stops talking; the source reads nothing until the next start. */
  stop(): void;
  /** Seconds into the sentence. */
  elapsed(): number;
}

/** The most one read may advance, in seconds, so a reader that was away does not skip the sentence. */
const MAX_STEP_S = 0.1;

export function createDemoVoice(rate = VOICE_RATE): DemoVoice {
  let plan: VoicePlan | null = null;
  let t = 0;
  return {
    start(p) {
      plan = p;
      t = 0;
    },
    stop() {
      plan = null;
      t = 0;
    },
    elapsed: () => t,
    read(which: AudioReader, dt: number, time: Float32Array<ArrayBuffer>, db: Float32Array<ArrayBuffer>): number {
      if (which !== "voice" || plan === null) return 0;
      if (Number.isFinite(dt) && dt > 0) t += Math.min(dt, MAX_STEP_S);
      if (t >= plan.duration) {
        time.fill(0);
        db.fill(AUDIO_MIN_DB);
        return 0;
      }
      renderVoice(plan, t, time, db, rate);
      return rate;
    },
  };
}

/** The analysis frame size the contract asks for, re-exported for the tests. */
export const VOICE_WINDOW = AUDIO_FFT_SIZE;
