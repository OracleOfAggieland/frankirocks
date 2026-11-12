import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AUDIO_FFT_SIZE, AUDIO_MIN_DB } from "../levels/audio-source";
import { LANDING } from "../copy-landing";
import {
  VOICE_FLOOR_DB,
  VOICE_RATE,
  createDemoVoice,
  envelopeAt,
  planVoice,
  renderVoice,
  speechMs,
  syllableAt,
  syllablesIn,
  voiceWords,
  wordsSpokenAt,
} from "./demo-voice";

const SAYS = LANDING.steps.suggested.says;

function buffers() {
  return { time: new Float32Array(AUDIO_FFT_SIZE), db: new Float32Array(AUDIO_FFT_SIZE / 2) };
}

function rmsDbfs(time: Float32Array): number {
  let s = 0;
  for (const x of time) s += x * x;
  return 20 * Math.log10(Math.sqrt(s / time.length) + 1e-9);
}

describe("syllablesIn", () => {
  it("counts vowel groups, drops a silent e and reads numbers out", () => {
    expect(syllablesIn("you")).toBe(1);
    expect(syllablesIn("dinners")).toBe(2);
    expect(syllablesIn("groceries")).toBe(3);
    expect(syllablesIn("make")).toBe(1);
    expect(syllablesIn("6.")).toBe(1);
    expect(syllablesIn("$186")).toBe(9);
    expect(syllablesIn("—")).toBe(0);
  });
});

describe("planVoice", () => {
  it("is deterministic and says the hero line in about ten seconds", () => {
    expect(planVoice(SAYS)).toEqual(planVoice(SAYS));
    const ms = speechMs(SAYS);
    expect(ms).toBeGreaterThan(8000);
    expect(ms).toBeLessThan(14000);
  });

  it("starts one entry per word, in order", () => {
    const plan = planVoice(SAYS);
    expect(plan.words).toHaveLength(voiceWords(SAYS).length);
    for (let i = 1; i < plan.words.length; i++) expect(plan.words[i]).toBeGreaterThanOrEqual(plan.words[i - 1]);
    expect(wordsSpokenAt(plan, 0)).toBe(0);
    expect(wordsSpokenAt(plan, plan.duration)).toBe(plan.words.length);
  });

  it("property: syllables never overlap and the envelope stays within 0..1", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.integer(), fc.double({ min: -1, max: 30, noNaN: true }), (text, seed, t) => {
        const plan = planVoice(text, seed);
        for (let i = 1; i < plan.syllables.length; i++) {
          const a = plan.syllables[i - 1];
          expect(plan.syllables[i].t0).toBeGreaterThanOrEqual(a.t0 + a.dur - 1e-9);
        }
        const e = envelopeAt(plan, t);
        expect(e).toBeGreaterThanOrEqual(0);
        expect(e).toBeLessThanOrEqual(1);
        if (t < 0 || t >= plan.duration) expect(e).toBe(0);
      }),
    );
  });
});

describe("renderVoice", () => {
  const plan = planVoice(SAYS);
  const s = plan.syllables[3];
  const mid = s.t0 + s.dur / 2;

  it("fills speech-level samples in a syllable and silence in a pause", () => {
    const { time, db } = buffers();
    renderVoice(plan, mid, time, db);
    const level = rmsDbfs(time);
    expect(level).toBeGreaterThan(-30);
    expect(level).toBeLessThan(-8);
    expect(Math.max(...db)).toBeGreaterThan(VOICE_FLOOR_DB + 40);
    renderVoice(plan, 0, time, db);
    expect(time.every((x) => x === 0)).toBe(true);
    expect(db.every((x) => x === AUDIO_MIN_DB)).toBe(true);
  });

  it("puts the loudest bin near a low harmonic of the pitch", () => {
    const { time, db } = buffers();
    renderVoice(plan, mid, time, db);
    const peak = db.indexOf(Math.max(...db));
    const hz = (peak * VOICE_RATE) / AUDIO_FFT_SIZE;
    expect(hz).toBeGreaterThan(80);
    expect(hz).toBeLessThan(3200);
    expect(syllableAt(plan, mid)).toBe(s);
  });
});

describe("createDemoVoice", () => {
  it("reads nothing until started, then speaks for the sentence and stops", () => {
    const voice = createDemoVoice();
    const { time, db } = buffers();
    expect(voice.read("voice", 0.016, time, db)).toBe(0);
    const plan = planVoice(SAYS);
    voice.start(plan);
    expect(voice.read("mic", 0.016, time, db)).toBe(0);
    let spoke = 0;
    for (let i = 0; i < 2000 && voice.elapsed() < plan.duration; i++) if (voice.read("voice", 1 / 60, time, db) === VOICE_RATE) spoke += 1;
    expect(spoke).toBeGreaterThan(100);
    expect(voice.read("voice", 1 / 60, time, db)).toBe(0);
    voice.stop();
    expect(voice.elapsed()).toBe(0);
  });

  it("advances by at most a tenth of a second per read", () => {
    const voice = createDemoVoice();
    const { time, db } = buffers();
    voice.start(planVoice(SAYS));
    voice.read("voice", 5, time, db);
    expect(voice.elapsed()).toBeCloseTo(0.1, 6);
    voice.read("voice", Number.NaN, time, db);
    expect(voice.elapsed()).toBeCloseTo(0.1, 6);
  });
});
