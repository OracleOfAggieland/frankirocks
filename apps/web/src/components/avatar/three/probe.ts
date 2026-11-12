// Prototype franki.html 269-270 and 299-370 (section 3: FFT_N, SIM_RATE, Probe), ported in WP8. Verbatim:
// allowed edits E1, E3 only (design note §1.3). The Probe reads the analyser data the AvatarAudioSource fills
// (§2.4 D1), so every feature is the prototype's. Not ported: spectrumDb, VOWELS, SpeechSynth (dev-only copies
// live in app/specimens/_sim), the `audio` taps (the Level_Meter does that), `sim` and `listen`.
import { clamp } from "./math";

/* =====================================================================
   3. AUDIO: one feature extractor shared by mic, remote voice and the simulator
   ===================================================================== */
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
    this.name = name;
    this.time = new Float32Array(FFT_N);
    this.db = new Float32Array(FFT_N / 2).fill(-140);
    this.prev = new Float32Array(FFT_N / 2);
    this.sr = SIM_RATE;
    this.level = 0; this.a = 0; this.cent = 0.4; this.centHz = 0; this.flux = 0;
    this.fluxHist = new Float32Array(43); this.fh = 0; this.fluxAcc = 0;   // 43 ticks at a fixed 60 Hz: about 0.7 s on any display
    this.onset = false; this.clap = false; this.syllable = false; this.plosive = false;
    this.lastOnset = -9; this.lastSyl = -9; this.lastLoud = -9;           // lastLoud: level above 0.08 (phrase-boundary blinks)
    this.hist = [];
  }
  silence() { this.time.fill(0); this.db.fill(-140); }
  analyse(dt: number, now: number) {
    const t = this.time;
    let s = 0;
    for (let i = 0; i < t.length; i++) s += t[i] * t[i];
    const dbfs = 20 * Math.log10(Math.sqrt(s / t.length) + 1e-9);
    this.level = clamp((dbfs + 60) / 50);                       // -60 dBFS -> 0, -10 dBFS -> 1
    const binHz = this.sr / FFT_N;
    // Spectral flux (onsets, claps) runs on a fixed 60 Hz tick against the spectrum of the previous tick, so a 144 Hz display
    // sees the same flux and fires the same nods, startles and cheers as a 60 Hz one. Level, envelope and centroid stay per frame.
    this.fluxAcc += dt;
    const tick = this.fluxAcc >= 1 / 60 || dt === 0;
    if (tick) this.fluxAcc = dt === 0 ? 0 : Math.min(this.fluxAcc - 1 / 60, 1 / 60);
    let num = 0, den = 0, flux = 0;
    for (let k = 1; k < FFT_N / 2; k++) {
      const hz = k * binHz, d = this.db[k];
      const m = Number.isFinite(d) ? Math.pow(10, d / 20) : 0;
      if (hz >= 150 && hz <= 5000) { num += hz * m; den += m; }
      if (tick) {
        if (hz >= 300 && hz <= 8000) { const df = m - this.prev[k]; if (df > 0) flux += df; }
        this.prev[k] = m;
      }
    }
    this.centHz = den > 1e-9 ? num / den : 0;
    // Mouth envelope: gate, normalise against a slow peak, perceptual power; 30 ms attack, 50 ms release (one-pole).
    // The level is in dB, so the dip between syllables is only ~0.2 of its range. Mapping just the top ~19 dB under the
    // recent peak lets the jaw close between syllables (lively, syllable-rate), and it adapts to loud and quiet voices.
    this.peak = Math.max(this.level, (this.peak || 0) - dt * 0.15);
    const floor = Math.max(0.08, this.peak - 0.32);
    const target = this.level < floor ? 0 : Math.pow(clamp((this.level - floor) / Math.max(0.12, this.peak - floor)), 0.85);
    this.a += (target - this.a) * (target > this.a ? 1 - Math.exp(-dt / 0.030) : 1 - Math.exp(-dt / 0.050));   // a quicker release than the spec's 90 ms so the jaw visibly closes between syllables
    if (this.level > 0.08) this.cent += (clamp((this.centHz - 500) / 2500) - this.cent) * (1 - Math.exp(-dt / 0.060));
    if (this.level > 0.08) this.lastLoud = now;
    // Onsets from adaptive spectral flux (about 0.7 s of history).
    this.onset = this.clap = false;
    if (tick) {
      let mean = 0;
      for (let i = 0; i < this.fluxHist.length; i++) mean += this.fluxHist[i];
      mean /= this.fluxHist.length;
      this.flux = flux;
      this.onset = flux > mean * 1.6 + 0.002 && this.level > 0.12 && now - this.lastOnset > 0.25;
      this.clap = this.onset && this.centHz > 2000 && flux > mean * 3;
      if (this.onset) this.lastOnset = now;
      this.fluxHist[this.fh] = flux; this.fh = (this.fh + 1) % this.fluxHist.length;
    }
    // Syllable onset: A' rises by > 0.25 within 50 ms. Plosive: from > 0.4 to < 0.1 within 40 ms.
    this.hist.push(now, this.a);
    while (this.hist.length > 2 && (now - this.hist[0] > 0.06 || this.hist.length > 40)) this.hist.splice(0, 2);   // bounded by count too: ?still=1 freezes the clock
    let lo = 1, hi = 0;
    for (let i = 0; i < this.hist.length; i += 2) {
      const age = now - this.hist[i], v = this.hist[i + 1];
      if (age <= 0.05) lo = Math.min(lo, v);
      if (age <= 0.04) hi = Math.max(hi, v);
    }
    this.syllable = this.a - lo > 0.25 && now - this.lastSyl > 0.12;
    if (this.syllable) this.lastSyl = now;
    this.plosive = hi > 0.4 && this.a < 0.1;
  }
}

/** The name `audio` keeps the verbatim `audio.voice.a` and `audio.mic.level` reads. */
export interface ProbesPart {
  audio: { mic: Probe; voice: Probe };
}

/** `mic: new Probe('mic'), voice: new Probe('voice')` (461-462). */
export function createProbes(): ProbesPart {
  return { audio: { mic: new Probe('mic'), voice: new Probe('voice') } };
}
