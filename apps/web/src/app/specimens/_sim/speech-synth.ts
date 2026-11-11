// The prototype's simulated speech, for the Specimens_Page only (brief 013, design note §8.2 and WP14; director
// decision D-2). A dev-only copy of prototype franki.html 227-228 (clamp, lerp), 236-244 (mulberry32), 269-270
// (FFT_N, SIM_RATE), 273-296 (spectrumDb), 373 (VOWELS) and 374-457 (SpeechSynth), verbatim. Allowed edits: E1
// (types, and `!` where TypeScript cannot see a value is set) and E3 (SpeechSynth sits inside createSpeechSource, so
// `STILL` is the source's own option instead of a top-level constant). It imports nothing from
// components/avatar/three/, so the engine never reaches the specimens directory and the specimens page never
// value-imports the engine.
//
// createSpeechSource is an AvatarAudioSource: `read('voice')` renders dt seconds of Franki's voice (the prototype's
// sim.franki, f0 128, seed 23) and `read('mic')` the user's (sim.user, f0 190, seed 11) into `time`, fills `db` with
// spectrumDb and returns SIM_RATE, exactly as the prototype's feedProbes does for the simulator (3348, 3351). The
// engine reads a stream only while the look's gate for it is open, so each synth talks whenever it is read; while a
// gate is closed it is not stepped, as the prototype's forced-state simulator is not rendered while not talking.
import type { AudioReader, AvatarAudioSource } from "../../../ui/levels/audio-source";

/* =====================================================================
   2. UTILS (the two the simulator uses)
   ===================================================================== */
const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =====================================================================
   3. AUDIO: one feature extractor shared by mic, remote voice and the simulator
   ===================================================================== */
export const FFT_N = 1024;
export const SIM_RATE = 48000;

/** Radix-2 FFT producing a dB spectrum the same way AnalyserNode does (Blackman window, magnitude / N). */
export const spectrumDb = (() => {
  const n = FFT_N, levels = Math.log2(n);
  const rev = new Uint16Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < levels; b++) r = (r << 1) | ((i >> b) & 1); rev[i] = r; }
  const cs = new Float32Array(n / 2), sn = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / n); sn[i] = -Math.sin(2 * Math.PI * i / n); }
  const win = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; win[i] = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a); }
  const re = new Float32Array(n), im = new Float32Array(n);
  return function (time: Float32Array, outDb: Float32Array) {
    for (let i = 0; i < n; i++) { re[rev[i]] = time[i] * win[i]; im[rev[i]] = 0; }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const c = cs[k * step], s = sn[k * step], a = i + k, b = a + half;
          const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    for (let k = 0; k < n / 2; k++) outDb[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / n + 1e-12);
  };
})();

/** A speech-like signal: harmonic source shaped by moving formants, plus fricative noise and plosive gaps. */
export const VOWELS = [[730, 1090, 2440], [530, 1840, 2480], [300, 2200, 3000], [570, 840, 2410], [340, 870, 2240], [660, 1720, 2410], [490, 1350, 1690]];

/** One syllable of SpeechSynth: start, length, formants, consonant kind (0 none, 1 plosive, 2 fricative, 3 nasal), accent, depth. */
export interface Syllable {
  t0: number;
  dur: number;
  F: number[];
  cons: number;
  accent: number;
  depth: number;
}

/** SpeechSynth.params: silence is `{ amp: 0, noise: 0 }`; a voiced moment adds the formants and the pitch. */
export interface SynthParams {
  amp: number;
  noise: number;
  F?: number[];
  f0?: number;
}

export interface SpeechSourceOptions {
  /** The parity panel's still frames: each synth pre-rolls once into the middle of a syllable, then holds (412-418). */
  still: boolean;
}

/** The simulated voices as an AvatarAudioSource, one per specimen tile, so no two engines share a synth's state. */
export function createSpeechSource({ still }: SpeechSourceOptions): AvatarAudioSource {
  const STILL = still;

  class SpeechSynth {
    base: number; seed: number; talking: boolean; ring: Float32Array<ArrayBuffer>; gains: Float32Array<ArrayBuffer>;
    r!: () => number; clock!: number; phase!: Float64Array<ArrayBuffer>;
    F!: number[]; amp!: number; noise!: number; f0!: number; hp!: number; prevN!: number;
    phraseEnd!: number; gapEnd!: number; syl!: Syllable | null; cached!: boolean;
    phraseStart!: number;
    constructor(f0: number, seed: number) {
      this.base = f0; this.seed = seed; this.talking = false; this.ring = new Float32Array(FFT_N); this.gains = new Float32Array(64);
      this.reset();
    }
    reset() {
      this.r = mulberry32(this.seed); this.clock = 0; this.phase = new Float64Array(64);
      this.F = [500, 1500, 2500]; this.amp = 0; this.noise = 0; this.f0 = this.base; this.hp = 0; this.prevN = 0;
      this.phraseEnd = 0; this.gapEnd = 0; this.syl = null; this.ring.fill(0); this.cached = false;
    }
    newSyllable(t: number) {
      const r = this.r;
      const v = VOWELS[Math.floor(r() * VOWELS.length)];
      const c = r();
      this.syl = { t0: t, dur: 0.13 + r() * 0.15, F: v, cons: c < 0.38 ? 0 : c < 0.62 ? 1 : c < 0.82 ? 2 : 3, accent: r() < 0.3 ? 1 : 0, depth: 0.75 + r() * 0.25 };
    }
    /** Parameters at time t: amplitude, noise, formants, pitch. */
    params(t: number): SynthParams {
      if (!this.talking) return { amp: 0, noise: 0 };
      if (t >= this.phraseEnd && t >= this.gapEnd) {
        if (this.phraseEnd > 0 && t < this.phraseEnd + 0.05) { this.gapEnd = t + 0.32 + this.r() * 0.5; return { amp: 0, noise: 0 }; }
        this.phraseStart = t; this.phraseEnd = t + 1.4 + this.r() * 1.9; this.newSyllable(t);
      }
      if (t >= this.phraseEnd) return { amp: 0, noise: 0 };
      let s = this.syl!;
      if (t - s.t0 >= s.dur) { this.newSyllable(t); s = this.syl!; }
      const u = t - s.t0, end = s.dur;
      let amp = Math.min(1, u / 0.025) * Math.min(1, (end - u) / 0.07) * s.depth, noise = 0;
      if (s.cons === 1) { if (u < 0.035) amp = 0; else if (u < 0.05) { noise = 0.55; amp *= 0.3; } }
      else if (s.cons === 2) { if (u < 0.09) { noise = 0.42 * Math.min(1, u / 0.015); amp *= 0.18; } }
      else if (s.cons === 3 && u < 0.06) amp *= 0.55;
      const prog = (t - this.phraseStart) / (this.phraseEnd - this.phraseStart);
      const f0 = this.base * (1 + 0.14 * s.accent * Math.sin(Math.PI * clamp(u / end)) - 0.1 * prog) * (1 + 0.012 * Math.sin(t * 31));
      const F = s.cons === 3 && u < 0.06 ? [260, 1000, 2300] : s.F;
      return { amp, noise, F, f0 };
    }
    /** Advance by dt and leave the newest FFT_N samples in `out`. */
    render(dt: number, out: Float32Array) {
      if (STILL) {                                                          // still frames: pre-roll once into the middle of a syllable, then hold
        if (!this.cached && this.talking) {
          for (let k = 0; k < 240; k++) { this.step(1 / 60); if (k > 40 && this.amp > 0.5) break; }
          this.cached = true;
        }
        out.set(this.ring); return;
      }
      this.step(dt);
      out.set(this.ring);
    }
    step(dt: number) {
      const n = Math.min(Math.max(1, Math.round(dt * SIM_RATE)), 4096);
      const p = this.params(this.clock + dt * 0.5);
      const amp1 = p.amp, noise1 = p.noise;
      if (this.amp === 0 && amp1 === 0 && this.noise === 0 && noise1 === 0) {   // silent: shift in zeros, skip the harmonic loop
        const shift = Math.min(n, FFT_N);
        this.ring.copyWithin(0, shift); this.ring.fill(0, FFT_N - shift);
        this.clock += dt;
        return;
      }
      if (p.F) { for (let i = 0; i < 3; i++) this.F[i] += (p.F[i] - this.F[i]) * 0.45; this.f0 = p.f0!; }
      const gains = this.gains, nh = Math.min(60, Math.floor(5200 / this.f0));
      let norm = 0;
      for (let h = 1; h <= nh; h++) {
        const f = h * this.f0;
        const g = (1 / (1 + ((f - this.F[0]) / 90) ** 2) + 0.55 / (1 + ((f - this.F[1]) / 120) ** 2) + 0.28 / (1 + ((f - this.F[2]) / 170) ** 2)) * Math.pow(h, -0.35);
        gains[h - 1] = g; norm += g * g;
      }
      norm = 1 / Math.sqrt(norm + 1e-9);
      const shift = Math.min(n, FFT_N), ring = this.ring;
      ring.copyWithin(0, shift);
      const w = 2 * Math.PI * this.f0 / SIM_RATE;
      for (let i = 0; i < n; i++) {
        const k = i / n;
        const a = lerp(this.amp, amp1, k), nz = lerp(this.noise, noise1, k);
        let v = 0;
        for (let h = 0; h < nh; h++) { this.phase[h] += w * (h + 1); v += gains[h] * Math.sin(this.phase[h]); }
        const wn = this.r() * 2 - 1, hpN = wn - this.prevN; this.prevN = wn;
        const sample = a * v * norm * 0.16 + nz * hpN * 0.09;
        const idx = FFT_N - n + i;
        if (idx >= 0) ring[idx] = sample;
      }
      for (let h = 0; h < nh; h++) this.phase[h] %= 2 * Math.PI;
      this.amp = amp1; this.noise = noise1; this.clock += dt;
    }
  }

  // The prototype's two voices (491-494): the user's feeds the mic probe, Franki's the voice probe.
  const user = new SpeechSynth(190, 11);
  const franki = new SpeechSynth(128, 23);
  user.talking = true;
  franki.talking = true;

  return {
    read(which: AudioReader, dt: number, time: Float32Array<ArrayBuffer>, db: Float32Array<ArrayBuffer>): number {
      const synth = which === "mic" ? user : franki;
      synth.render(dt, time); spectrumDb(time, db);
      return SIM_RATE;
    },
  };
}
