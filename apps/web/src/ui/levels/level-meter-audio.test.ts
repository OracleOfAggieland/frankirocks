// Brief 013 WP16: the Level_Meter's second analyser per tap, read as the avatar's audio source.
import { describe, expect, it } from "vitest";
import { AUDIO_FFT_SIZE, AUDIO_MAX_DB, AUDIO_MIN_DB, AUDIO_SMOOTHING } from "./audio-source";
import { FFT_SIZE, UNBUILT_AUDIO_TAP, audioTapStep, createLevelMeter, type AudioTap } from "./level-meter";

interface FakeNode {
  kind: "source" | "analyser";
  connected: unknown[];
  disconnected: number;
  fftSize?: number;
  smoothingTimeConstant?: number;
  minDecibels?: number;
  maxDecibels?: number;
  byteReads: number;
  floatTimeReads: number;
  floatFreqReads: number;
}

function fakeContext(opts: { state?: AudioContextState; sampleRate?: number; failFloat?: boolean } = {}) {
  const nodes: FakeNode[] = [];
  const calls: string[] = [];
  const ctx = {
    state: opts.state ?? "running",
    sampleRate: opts.sampleRate ?? 48000,
    createMediaStreamSource(stream: MediaStream) {
      const node = {
        kind: "source" as const,
        stream,
        connected: [] as unknown[],
        disconnected: 0,
        byteReads: 0,
        floatTimeReads: 0,
        floatFreqReads: 0,
        connect(to: unknown) {
          node.connected.push(to);
        },
        disconnect() {
          node.disconnected++;
        },
      };
      nodes.push(node);
      return node;
    },
    createAnalyser() {
      const node = {
        kind: "analyser" as const,
        fftSize: 2048,
        smoothingTimeConstant: 0.8,
        minDecibels: -100,
        maxDecibels: -30,
        connected: [] as unknown[],
        disconnected: 0,
        byteReads: 0,
        floatTimeReads: 0,
        floatFreqReads: 0,
        connect(to: unknown) {
          node.connected.push(to);
        },
        disconnect() {
          node.disconnected++;
        },
        getByteTimeDomainData(buf: Uint8Array) {
          node.byteReads++;
          buf.fill(255);
        },
        getFloatTimeDomainData(buf: Float32Array) {
          node.floatTimeReads++;
          calls.push("time");
          if (opts.failFloat) throw new Error("detached");
          buf.fill(0.5);
        },
        getFloatFrequencyData(buf: Float32Array) {
          node.floatFreqReads++;
          calls.push("db");
          buf.fill(-42);
        },
      };
      nodes.push(node);
      return node;
    },
  };
  return { ctx, audioContext: ctx as unknown as AudioContext, nodes, calls };
}

const stream = (id: string) => ({ id }) as unknown as MediaStream;
const arrays = () => ({
  time: new Float32Array(AUDIO_FFT_SIZE),
  db: new Float32Array(AUDIO_FFT_SIZE / 2),
});
const analysers = (nodes: FakeNode[]) => nodes.filter((n) => n.kind === "analyser");
const sources = (nodes: FakeNode[]) => nodes.filter((n) => n.kind === "source");

describe("Level_Meter audio source (brief 013 WP16)", () => {
  it("configures the second analyser as the prototype's tap", () => {
    const { audioContext, nodes } = fakeContext();
    const meter = createLevelMeter(() => audioContext);
    meter.setStreams({ mic: stream("m"), output: stream("o") });
    const { time, db } = arrays();
    meter.audio.read("voice", 1 / 60, time, db);
    meter.audio.read("mic", 1 / 60, time, db);
    const second = analysers(nodes).filter((a) => a.fftSize !== FFT_SIZE);
    expect(second).toHaveLength(2);
    for (const a of second) {
      expect(a.fftSize).toBe(AUDIO_FFT_SIZE);
      expect(a.smoothingTimeConstant).toBe(AUDIO_SMOOTHING);
      expect(a.minDecibels).toBe(AUDIO_MIN_DB);
      expect(a.maxDecibels).toBe(AUDIO_MAX_DB);
      expect(a.connected).toEqual([]);
    }
    expect([AUDIO_FFT_SIZE, AUDIO_SMOOTHING, AUDIO_MIN_DB, AUDIO_MAX_DB]).toEqual([1024, 0, -140, 0]);
  });

  it("returns the sample rate and fills time then db from the second analyser", () => {
    const { audioContext, nodes, calls } = fakeContext({ sampleRate: 44100 });
    const meter = createLevelMeter(() => audioContext);
    meter.setStreams({ mic: null, output: stream("o") });
    const { time, db } = arrays();
    expect(meter.audio.read("voice", 0.016, time, db)).toBe(44100);
    expect(time.every((v) => v === 0.5)).toBe(true);
    expect(db.every((v) => v === -42)).toBe(true);
    expect(calls).toEqual(["time", "db"]);
    // Read again: the same analyser, no new nodes.
    const count = nodes.length;
    expect(meter.audio.read("voice", 0.016, time, db)).toBe(44100);
    expect(nodes.length).toBe(count);
    // The first analyser was never read by the audio path.
    const first = analysers(nodes).find((a) => a.fftSize === FFT_SIZE)!;
    expect(first.byteReads).toBe(0);
  });

  it("taps each stream with one source feeding both analysers", () => {
    const { audioContext, nodes } = fakeContext();
    const meter = createLevelMeter(() => audioContext);
    meter.setStreams({ mic: stream("m"), output: null });
    const { time, db } = arrays();
    meter.audio.read("mic", 0, time, db);
    meter.sample();
    meter.rawInput();
    expect(sources(nodes)).toHaveLength(1);
    expect(analysers(nodes)).toHaveLength(2);
    expect(sources(nodes)[0].connected).toHaveLength(2);
  });

  it("returns 0 with no stream, no context, or a context that is not running", () => {
    const { time, db } = arrays();
    const running = fakeContext();
    const noStream = createLevelMeter(() => running.audioContext);
    expect(noStream.audio.read("mic", 0, time, db)).toBe(0);
    expect(noStream.audio.read("voice", 0, time, db)).toBe(0);
    noStream.setStreams({ mic: stream("m"), output: null });
    expect(noStream.audio.read("voice", 0, time, db)).toBe(0);

    const noCtx = createLevelMeter(() => null);
    noCtx.setStreams({ mic: stream("m"), output: stream("o") });
    expect(noCtx.audio.read("mic", 0, time, db)).toBe(0);

    for (const state of ["suspended", "closed"] as const) {
      const f = fakeContext({ state });
      const meter = createLevelMeter(() => f.audioContext);
      meter.setStreams({ mic: stream("m"), output: stream("o") });
      expect(meter.audio.read("mic", 0, time, db)).toBe(0);
      expect(meter.audio.read("voice", 0, time, db)).toBe(0);
      expect(f.nodes).toEqual([]);
    }
  });

  it("returns 0 while paused, reads nothing, and resumes", () => {
    const { audioContext, nodes } = fakeContext();
    const meter = createLevelMeter(() => audioContext);
    meter.setStreams({ mic: stream("m"), output: null });
    const { time, db } = arrays();
    expect(meter.audio.read("mic", 0, time, db)).toBe(48000);
    meter.pause();
    const before = analysers(nodes).map((a) => a.floatTimeReads);
    expect(meter.audio.read("mic", 0, time, db)).toBe(0);
    expect(analysers(nodes).map((a) => a.floatTimeReads)).toEqual(before);
    meter.resume();
    expect(meter.audio.read("mic", 0, time, db)).toBe(48000);
  });

  it("leaves sample() and rawInput() reading the first analyser as before", () => {
    const { audioContext, nodes } = fakeContext();
    const meter = createLevelMeter(() => audioContext);
    meter.setStreams({ mic: stream("m"), output: stream("o") });
    const { time, db } = arrays();
    meter.audio.read("mic", 0, time, db);
    meter.audio.read("voice", 0, time, db);
    // The first smoothed sample starts from 0 with attack 0.5, so the audio reads did not move it.
    expect(meter.sample()).toEqual({ input: 0.5, output: 0.5 });
    expect(meter.rawInput()).toBe(1);
    const first = analysers(nodes).filter((a) => a.fftSize === FFT_SIZE);
    const second = analysers(nodes).filter((a) => a.fftSize === AUDIO_FFT_SIZE);
    expect(first).toHaveLength(2);
    expect(first.map((a) => a.byteReads).reduce((x, y) => x + y)).toBe(3);
    expect(first.every((a) => a.floatTimeReads === 0)).toBe(true);
    expect(second.every((a) => a.byteReads === 0)).toBe(true);
  });

  it("disconnects the second analyser with the tap", () => {
    const { audioContext, nodes } = fakeContext();
    const meter = createLevelMeter(() => audioContext);
    meter.setStreams({ mic: stream("m"), output: stream("o") });
    const { time, db } = arrays();
    meter.audio.read("mic", 0, time, db);
    meter.audio.read("voice", 0, time, db);
    meter.setStreams({ mic: null, output: stream("o") });
    expect(meter.audio.read("mic", 0, time, db)).toBe(0);
    meter.dispose();
    expect(nodes.every((n) => n.disconnected >= 1)).toBe(true);
    expect(meter.audio.read("voice", 0, time, db)).toBe(0);
  });

  it("reads an error on the second analyser as 0 and keeps the level path", () => {
    const { audioContext, nodes } = fakeContext({ failFloat: true });
    const meter = createLevelMeter(() => audioContext);
    meter.setStreams({ mic: stream("m"), output: null });
    const { time, db } = arrays();
    expect(meter.audio.read("mic", 0, time, db)).toBe(0);
    expect(meter.audio.read("mic", 0, time, db)).toBe(0);
    const second = analysers(nodes).filter((a) => a.fftSize === AUDIO_FFT_SIZE);
    expect(second).toHaveLength(1);
    expect(second[0].floatTimeReads).toBe(1);
    expect(second[0].disconnected).toBe(1);
    expect(meter.sample().input).toBe(0.5);
    expect(meter.rawInput()).toBe(1);
  });

  it("reads a Web Audio error building the tap as 0, as sample() does", () => {
    const ctx = {
      state: "running",
      sampleRate: 48000,
      createMediaStreamSource() {
        throw new Error("not allowed");
      },
    } as unknown as AudioContext;
    const meter = createLevelMeter(() => ctx);
    meter.setStreams({ mic: stream("m"), output: stream("o") });
    const { time, db } = arrays();
    expect(meter.audio.read("mic", 0, time, db)).toBe(0);
    expect(meter.audio.read("voice", 0, time, db)).toBe(0);
    expect(meter.sample()).toEqual({ input: 0, output: 0 });
  });
});

describe("audioTapStep", () => {
  const analyser = {} as AnalyserNode;
  const live: AudioTap = { phase: "live", analyser };
  const failed: AudioTap = { phase: "failed" };
  const closed: AudioTap = { phase: "closed" };

  it("decides every transition", () => {
    expect(audioTapStep(UNBUILT_AUDIO_TAP, { kind: "built", analyser })).toEqual(live);
    expect(audioTapStep(UNBUILT_AUDIO_TAP, { kind: "error" })).toEqual(failed);
    expect(audioTapStep(UNBUILT_AUDIO_TAP, { kind: "disconnected" })).toEqual(closed);
    expect(audioTapStep(live, { kind: "built", analyser: {} as AnalyserNode })).toBe(live);
    expect(audioTapStep(live, { kind: "error" })).toEqual(failed);
    expect(audioTapStep(live, { kind: "disconnected" })).toEqual(closed);
  });

  it("keeps failed and closed absorbing", () => {
    for (const s of [failed, closed]) {
      expect(audioTapStep(s, { kind: "built", analyser })).toBe(s);
      expect(audioTapStep(s, { kind: "error" })).toBe(s);
      expect(audioTapStep(s, { kind: "disconnected" })).toBe(s);
    }
  });
});
