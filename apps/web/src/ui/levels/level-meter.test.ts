import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FFT_SIZE, createLevelMeter } from "./level-meter";

function fakeContext(sampleValue = 255) {
  const nodes: { kind: string; connected: unknown[]; disconnected: number }[] = [];
  const ctx = {
    createMediaStreamSource(stream: MediaStream) {
      const node = {
        kind: "source",
        stream,
        connected: [] as unknown[],
        disconnected: 0,
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
        kind: "analyser",
        fftSize: 2048,
        connected: [] as unknown[],
        disconnected: 0,
        reads: 0,
        connect(to: unknown) {
          node.connected.push(to);
        },
        disconnect() {
          node.disconnected++;
        },
        getByteTimeDomainData(buf: Uint8Array) {
          node.reads++;
          buf.fill(sampleValue);
        },
      };
      nodes.push(node);
      return node;
    },
  };
  return { ctx: ctx as unknown as AudioContext, nodes };
}

const stream = (id: string) => ({ id }) as unknown as MediaStream;

describe("Level_Meter", () => {
  it("reports 0 and 0 with no streams or no context", () => {
    const { ctx } = fakeContext();
    expect(createLevelMeter(() => ctx).sample()).toEqual({ input: 0, output: 0 });
    const noCtx = createLevelMeter(() => null);
    noCtx.setStreams({ mic: stream("m"), output: stream("o") });
    expect(noCtx.sample()).toEqual({ input: 0, output: 0 });
  });

  it("taps each stream with one analyser connected to nothing else", () => {
    const { ctx, nodes } = fakeContext();
    const meter = createLevelMeter(() => ctx);
    meter.setStreams({ mic: stream("m"), output: stream("o") });
    const first = meter.sample();
    expect(first.input).toBeGreaterThan(0);
    expect(first.output).toBeGreaterThan(0);
    meter.sample();
    const analysers = nodes.filter((n) => n.kind === "analyser") as unknown as { fftSize: number; connected: unknown[] }[];
    expect(analysers).toHaveLength(2);
    for (const a of analysers) {
      expect(a.fftSize).toBe(FFT_SIZE);
      expect(a.connected).toEqual([]);
    }
    for (const s of nodes.filter((n) => n.kind === "source")) expect(s.connected).toHaveLength(1);
  });

  it("disconnects old nodes when the streams go away", () => {
    const { ctx, nodes } = fakeContext();
    const meter = createLevelMeter(() => ctx);
    meter.setStreams({ mic: stream("m"), output: stream("o") });
    meter.sample();
    meter.setStreams({ mic: null, output: null });
    expect(nodes.every((n) => n.disconnected >= 1)).toBe(true);
    expect(meter.sample()).toEqual({ input: 0, output: 0 });
  });

  it("reads nothing while paused, and resumes", () => {
    const { ctx, nodes } = fakeContext();
    const meter = createLevelMeter(() => ctx);
    meter.setStreams({ mic: stream("m"), output: null });
    meter.sample();
    meter.pause();
    const reads = () => nodes.filter((n) => n.kind === "analyser").map((n) => (n as unknown as { reads: number }).reads);
    const before = reads();
    expect(meter.sample()).toEqual({ input: 0, output: 0 });
    expect(reads()).toEqual(before);
    meter.resume();
    expect(meter.sample().input).toBeGreaterThan(0);
  });

  it("reads Web Audio errors as 0", () => {
    const ctx = {
      createMediaStreamSource() {
        throw new Error("not allowed");
      },
    } as unknown as AudioContext;
    const meter = createLevelMeter(() => ctx);
    meter.setStreams({ mic: stream("m"), output: stream("o") });
    expect(meter.sample()).toEqual({ input: 0, output: 0 });
  });

  it("uses no network, storage or recorder", () => {
    const src = readFileSync(join(__dirname, "level-meter.ts"), "utf8");
    for (const word of ["fetch", "localStorage", "sessionStorage", "indexedDB", "MediaRecorder", "XMLHttpRequest", "sendBeacon"]) {
      expect(src).not.toContain(word);
    }
  });
});
