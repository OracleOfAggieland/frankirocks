// WP8 (design note §8.1): Probe.analyse over synthetic float buffers, against values worked out by hand from the
// prototype's formulas (franki.html 313-369). Every expected number below is written as the formula it comes from,
// so a changed constant or a reordered step fails here. Node only: probe.ts imports math.ts and nothing from three.
import { describe, expect, it } from "vitest";
import { FFT_N, Probe, SIM_RATE, createProbes } from "./probe";

const BIN_HZ = SIM_RATE / FFT_N; // 46.875

/** A DC buffer: its RMS is the value itself, so dBFS and level are exact. */
function loud(p: Probe, v: number): void {
  p.time.fill(v);
}

/** -Infinity everywhere except the named bins at 0 dB (magnitude 1), as an analyser reports a pure spectrum. */
function spectrum(p: Probe, bins: number[]): void {
  p.db.fill(-Infinity);
  for (const k of bins) p.db[k] = 0;
}

describe("Probe construction (300-311)", () => {
  it("starts with the prototype's buffers and values", () => {
    const p = new Probe("voice");
    expect(p.name).toBe("voice");
    expect(FFT_N).toBe(1024);
    expect(SIM_RATE).toBe(48000);
    expect(p.time.length).toBe(FFT_N);
    expect(p.db.length).toBe(FFT_N / 2);
    expect(p.db.every((d) => d === -140)).toBe(true);
    expect(p.prev.length).toBe(FFT_N / 2);
    expect(p.sr).toBe(SIM_RATE);
    expect([p.level, p.a, p.cent, p.centHz, p.flux]).toEqual([0, 0, 0.4, 0, 0]);
    expect(p.fluxHist.length).toBe(43);
    expect([p.fh, p.fluxAcc]).toEqual([0, 0]);
    expect([p.onset, p.clap, p.syllable, p.plosive]).toEqual([false, false, false, false]);
    expect([p.lastOnset, p.lastSyl, p.lastLoud]).toEqual([-9, -9, -9]);
    expect(p.hist).toEqual([]);
    expect(p.peak).toBeUndefined();
  });

  it("createProbes makes one mic and one voice probe", () => {
    const { audio } = createProbes();
    expect(audio.mic.name).toBe("mic");
    expect(audio.voice.name).toBe("voice");
    expect(audio.mic).not.toBe(audio.voice);
  });
});

describe("silence", () => {
  it("silence() zeroes the samples and floors the bins", () => {
    const p = new Probe("mic");
    loud(p, 0.5);
    spectrum(p, [10]);
    p.silence();
    expect(p.time.every((s) => s === 0)).toBe(true);
    expect(p.db.every((d) => d === -140)).toBe(true);
  });

  it("reads level 0, keeps the mouth shut and the centroid still", () => {
    const p = new Probe("voice");
    p.analyse(1 / 60, 0);
    expect(p.level).toBe(0); // 20·log10(1e-9) = -180 dBFS, far under -60
    expect(p.a).toBe(0);
    expect(p.peak).toBe(0); // max(0, 0 - dt·0.15)
    expect(p.cent).toBe(0.4); // the centroid moves only above level 0.08
    expect(p.lastLoud).toBe(-9);
    expect(p.onset).toBe(false);
    // -140 dB in every bin is magnitude 1e-7: the centroid of bins 4..106 (187.5 Hz to 4968.75 Hz) is bin 55.
    expect(p.centHz).toBeCloseTo(55 * BIN_HZ, 6);
  });
});

describe("level (316-318)", () => {
  it("maps -60 dBFS to 0 and -10 dBFS to 1, linear in dB between", () => {
    const p = new Probe("voice");
    loud(p, 0.1); // -20 dBFS
    p.analyse(1 / 60, 0);
    expect(p.level).toBeCloseTo(0.8, 6);
    loud(p, 10 ** (-30 / 20)); // -30 dBFS
    p.analyse(1 / 60, 1 / 60);
    expect(p.level).toBeCloseTo(0.6, 6);
    loud(p, 1); // 0 dBFS clamps
    p.analyse(1 / 60, 2 / 60);
    expect(p.level).toBe(1);
  });
});

describe("mouth envelope a (339-342)", () => {
  it("attacks with a 30 ms one-pole toward the gated, peak-normalised target", () => {
    const p = new Probe("voice");
    loud(p, 0.1); // level 0.8: peak 0.8, floor max(0.08, 0.8 - 0.32) = 0.48, target ((0.8-0.48)/0.32)^0.85 = 1
    p.analyse(0.03, 0.03);
    expect(p.peak).toBeCloseTo(0.8, 6);
    expect(p.a).toBeCloseTo(1 - Math.exp(-1), 6);
    p.analyse(0.03, 0.06);
    expect(p.a).toBeCloseTo(1 - Math.exp(-2), 6);
  });

  it("releases with a 50 ms one-pole, and the peak falls 0.15 per second", () => {
    const p = new Probe("voice");
    loud(p, 0.1);
    p.analyse(0.03, 0.03);
    p.analyse(0.03, 0.06);
    const a0 = p.a;
    p.time.fill(0);
    p.analyse(0.05, 0.11); // level 0 under floor 0.4725: target 0
    expect(p.peak).toBeCloseTo(0.8 - 0.05 * 0.15, 6);
    expect(p.a).toBeCloseTo(a0 * Math.exp(-1), 6);
  });

  it("maps a level between floor and peak through the 0.85 power", () => {
    const p = new Probe("voice");
    loud(p, 0.1);
    p.analyse(0.03, 0.03);
    p.analyse(0.03, 0.06);
    const a0 = p.a;
    loud(p, 10 ** (-30 / 20)); // level 0.6; peak max(0.6, 0.8 - 0.02·0.15) = 0.797; floor 0.477
    p.analyse(0.02, 0.08);
    const target = Math.pow((0.6 - 0.477) / Math.max(0.12, 0.797 - 0.477), 0.85);
    expect(p.peak).toBeCloseTo(0.797, 6);
    expect(p.a).toBeCloseTo(a0 + (target - a0) * (1 - Math.exp(-0.02 / 0.05)), 6); // target < a: the release pole
  });
});

describe("centroid cent and centHz (326-335, 343)", () => {
  it("weights bins in 150-5000 Hz by magnitude, and eases cent with a 60 ms pole only when loud", () => {
    const p = new Probe("voice");
    loud(p, 0.1);
    spectrum(p, [64]); // 64 · 46.875 = 3000 Hz
    p.analyse(0.06, 0.06);
    expect(p.centHz).toBe(3000);
    // clamp((3000 - 500) / 2500) = 1
    expect(p.cent).toBeCloseTo(0.4 + (1 - 0.4) * (1 - Math.exp(-1)), 6);
  });

  it("ignores bins outside 150-5000 Hz and non-finite dB", () => {
    const p = new Probe("voice");
    loud(p, 0.1);
    spectrum(p, [3, 32, 107]); // 140.625 Hz and 5015.625 Hz are outside; 1500 Hz inside
    p.analyse(0.06, 0.06);
    expect(p.centHz).toBe(1500);
  });

  it("holds cent while quiet, though centHz still updates", () => {
    const p = new Probe("voice");
    spectrum(p, [64]); // time stays silent: level 0
    p.analyse(0.06, 0.06);
    expect(p.centHz).toBe(3000);
    expect(p.cent).toBe(0.4);
  });
});

describe("lastLoud (344)", () => {
  it("stamps the clock only above level 0.08", () => {
    const p = new Probe("voice");
    loud(p, 10 ** (-57 / 20)); // level 0.06
    p.analyse(1 / 60, 1);
    expect(p.lastLoud).toBe(-9);
    loud(p, 10 ** (-55 / 20)); // level 0.10
    p.analyse(1 / 60, 2);
    expect(p.lastLoud).toBe(2);
  });
});

describe("the fixed 60 Hz flux tick (322-324, 330-333, 355)", () => {
  it("updates prev and the flux history only on ticks, whatever the frame rate", () => {
    const p = new Probe("mic");
    spectrum(p, [64]);
    p.analyse(0.01, 0.01); // 0.01 < 1/60: no tick
    expect(p.fluxAcc).toBeCloseTo(0.01, 12);
    expect(p.prev[64]).toBe(0);
    expect(p.fh).toBe(0);
    p.analyse(0.01, 0.02); // 0.02 >= 1/60: tick, carry the remainder
    expect(p.fluxAcc).toBeCloseTo(0.02 - 1 / 60, 12);
    expect(p.prev[64]).toBe(1);
    expect(p.fh).toBe(1);
  });

  it("carries at most one tick of remainder, and dt 0 always ticks and resets", () => {
    const p = new Probe("mic");
    p.analyse(0.05, 0.05);
    expect(p.fluxAcc).toBeCloseTo(1 / 60, 12); // min(0.05 - 1/60, 1/60)
    expect(p.fh).toBe(1);
    p.analyse(0, 0.05);
    expect(p.fluxAcc).toBe(0);
    expect(p.fh).toBe(2);
  });

  it("wraps the 43-entry history", () => {
    const p = new Probe("mic");
    for (let i = 0; i < 43; i++) p.analyse(0, i);
    expect(p.fh).toBe(0);
  });
});

describe("onset and clap (346-356)", () => {
  it("fires on adaptive flux above the history mean, with a 250 ms refractory, only when loud", () => {
    const p = new Probe("mic");
    loud(p, 0.1);
    spectrum(p, [64]); // flux 1 in 300-8000 Hz against an empty history: mean 0
    p.analyse(1 / 60, 1.0);
    expect(p.flux).toBe(1);
    expect(p.onset).toBe(true);
    expect(p.lastOnset).toBe(1.0);
    expect(p.clap).toBe(true); // centHz 3000 > 2000 and flux 1 > 3 · 0

    spectrum(p, [64, 80]); // flux 1 again, mean 1/43, but 0.1 s after the last onset
    p.analyse(1 / 60, 1.1);
    expect(p.flux).toBe(1);
    expect(p.onset).toBe(false);
    expect(p.clap).toBe(false);

    spectrum(p, [64, 80, 96]); // mean 2/43: threshold 2/43 · 1.6 + 0.002, and 0.4 s after the last onset
    p.analyse(1 / 60, 1.4);
    expect(p.onset).toBe(true);
    expect(p.clap).toBe(true); // centHz (3000 + 3750 + 4500) / 3 = 3750; flux 1 > 3 · 2/43
    expect(p.centHz).toBe(3750);
  });

  it("does not fire on a steady spectrum, nor while quiet", () => {
    const p = new Probe("mic");
    loud(p, 0.1);
    spectrum(p, [64]);
    p.analyse(1 / 60, 1.0);
    p.analyse(1 / 60, 2.0); // same spectrum: flux 0
    expect(p.flux).toBe(0);
    expect(p.onset).toBe(false);

    const q = new Probe("mic");
    loud(q, 10 ** (-55 / 20)); // level 0.10, under the 0.12 gate
    spectrum(q, [64]);
    q.analyse(1 / 60, 1.0);
    expect(q.flux).toBe(1);
    expect(q.onset).toBe(false);
  });

  it("is a clap only when bright", () => {
    const p = new Probe("mic");
    loud(p, 0.1);
    spectrum(p, [32]); // 1500 Hz: an onset, not a clap
    p.analyse(1 / 60, 1.0);
    expect(p.onset).toBe(true);
    expect(p.clap).toBe(false);
  });
});

describe("syllable and plosive (357-368)", () => {
  it("fires a syllable when a rises over 0.25 within 50 ms, at most every 120 ms", () => {
    const p = new Probe("voice");
    p.analyse(1 / 60, 1.0); // a 0
    expect(p.syllable).toBe(false);
    loud(p, 0.1);
    p.analyse(0.03, 1.03); // a = 1 - e^-1 against the 0 of 30 ms ago
    expect(p.syllable).toBe(true);
    expect(p.lastSyl).toBe(1.03);
    p.time.fill(0);
    p.analyse(0.03, 1.06);
    loud(p, 0.1);
    p.analyse(0.03, 1.09); // a rises again, but 60 ms after the last syllable
    expect(p.syllable).toBe(false);
  });

  it("fires a plosive when a falls from over 0.4 to under 0.1 within 40 ms (formula, with dt larger than the clock step)", () => {
    const p = new Probe("voice");
    loud(p, 0.1);
    p.analyse(0.03, 0.03);
    p.analyse(0.03, 0.06); // a = 1 - e^-2
    p.time.fill(0);
    p.analyse(0.2, 0.08); // a = (1 - e^-2) · e^-4, under 0.1; the 0.865 of 20 ms ago is in the window
    expect(p.a).toBeCloseTo((1 - Math.exp(-2)) * Math.exp(-4), 6);
    expect(p.plosive).toBe(true);
  });

  it("keeps the prototype's behaviour: with dt equal to the clock step the 50 ms release cannot fall 4x in 40 ms", () => {
    // A prototype oddity kept as it is (brief rule 1): 0.4 · e^(-0.04 / 0.05) = 0.18 > 0.1, so on the live clock,
    // where the loop passes now = T and T advances by dt, the plosive snap never fires.
    const p = new Probe("voice");
    let now = 0;
    let fired = false;
    const step = (dt: number) => { now += dt; p.analyse(dt, now); fired ||= p.plosive; };
    for (const dt of [1 / 60, 1 / 144, 0.05]) {
      loud(p, 0.1);
      for (let i = 0; i < 30; i++) step(dt);
      p.time.fill(0);
      for (let i = 0; i < 30; i++) step(dt);
    }
    expect(fired).toBe(false);
  });

  it("bounds the history by count while the clock is frozen (still frames)", () => {
    const p = new Probe("voice");
    loud(p, 0.1);
    for (let i = 0; i < 100; i++) p.analyse(0, 2.35);
    expect(p.hist.length).toBe(40);
  });

  it("drops history older than 60 ms", () => {
    const p = new Probe("voice");
    for (let i = 0; i <= 4; i++) p.analyse(0.025, i * 0.025);
    // at now 0.1 the entries at 0, 0.025 and 0.05 are 0.1, 0.075 and 0.05 old: the first two are dropped
    expect(p.hist.length / 2).toBe(3);
    expect(p.hist[0]).toBeCloseTo(0.05, 12);
  });
});
