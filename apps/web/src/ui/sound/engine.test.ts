import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FADE_S, createSoundEngine } from "./engine";

interface ParamLog {
  value: number;
  events: { kind: string; value: number; time: number }[];
}

function fakeContext() {
  const gains: ParamLog[] = [];
  const stops: number[] = [];
  const param = (initial = 0) => {
    const log: ParamLog & Record<string, unknown> = {
      value: initial,
      events: [],
      setValueAtTime(v: number, t: number) {
        log.events.push({ kind: "set", value: v, time: t });
      },
      linearRampToValueAtTime(v: number, t: number) {
        log.events.push({ kind: "ramp", value: v, time: t });
      },
      cancelScheduledValues() {},
    };
    return log;
  };
  const node = () => ({ connect() {}, disconnect() {} });
  const source = () => ({ ...node(), start() {}, stop(t: number) { stops.push(t); }, onended: null });
  const ctx = {
    currentTime: 10,
    sampleRate: 8000,
    destination: {},
    createGain() {
      const gain = param(1);
      gains.push(gain);
      return { ...node(), gain };
    },
    createOscillator: () => ({ ...source(), type: "sine", frequency: param() }),
    createBufferSource: () => ({ ...source(), buffer: null }),
    createBiquadFilter: () => ({ ...node(), type: "lowpass", frequency: param() }),
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
  };
  return { ctx: ctx as unknown as AudioContext, gains, stops };
}

describe("sound engine", () => {
  it("plays nothing without a context", () => {
    const engine = createSoundEngine(() => null);
    expect(() => engine.play("wake")).not.toThrow();
  });

  it("keeps the master gain and every envelope at or below 0.25", () => {
    const { ctx, gains } = fakeContext();
    const engine = createSoundEngine(() => ctx);
    engine.play("wake");
    engine.play("celebrate");
    expect(gains.length).toBeGreaterThan(1);
    const master = gains[0];
    expect(master.value).toBeLessThanOrEqual(0.25);
    for (const g of gains) for (const e of g.events) expect(e.value).toBeLessThanOrEqual(0.25);
  });

  it("fades to silence within 50 ms when Franki's voice becomes audible", () => {
    const { ctx, gains, stops } = fakeContext();
    const engine = createSoundEngine(() => ctx);
    engine.play("receipt");
    engine.setOutputMuted(false);
    const ramp = gains[0].events.filter((e) => e.kind === "ramp").at(-1)!;
    expect(ramp.value).toBe(0);
    expect(ramp.time - 10).toBeLessThanOrEqual(0.05);
    expect(FADE_S).toBeLessThanOrEqual(0.05);
    expect(stops.some((t) => t === 10 + FADE_S)).toBe(true);
  });

  it("starts no cue while Franki's voice is audible", () => {
    const { ctx, gains } = fakeContext();
    const engine = createSoundEngine(() => ctx);
    engine.setOutputMuted(false);
    engine.play("card");
    expect(gains).toHaveLength(0);
  });

  it("loads no audio file", () => {
    const src = readFileSync(join(__dirname, "engine.ts"), "utf8");
    expect(src).not.toMatch(/\.(mp3|wav|ogg|m4a)\b|fetch|decodeAudioData|new Audio\(/);
  });
});
