import { describe, expect, it } from "vitest";
import type { Fields } from "./recorder";
import { FPS_WINDOW_MS, createFrameWindow, createLinkWatch, errorMessage, readStats, sampleFrames } from "./samplers";

function sink() {
  const lines: { kind: string; fields: Fields }[] = [];
  return { lines, emit: (kind: string, fields: Fields = {}) => lines.push({ kind, fields }), words: () => {} };
}

describe("frames", () => {
  it("averages a window and counts long frames", () => {
    const w = createFrameWindow();
    let t = 0;
    w.add(t);
    for (let i = 0; i < 99; i++) w.add((t += 20));
    w.add((t += 100));
    expect(w.take()).toEqual({ avg: 48.1, min: 10, long: 1, n: 100, windowMs: 2080 });
    // The next window starts at the last frame.
    w.add((t += 16));
    expect(w.take()).toMatchObject({ n: 1, windowMs: 16 });
    expect(w.take()).toBeNull();
  });

  it("writes fps every 2 s while visible, and drops time spent hidden", () => {
    const s = sink();
    let fn: ((at: number) => void) | null = null;
    let visible = true;
    const stop = sampleFrames(s, { requestAnimationFrame: (f) => ((fn = f), 1), cancelAnimationFrame: () => (fn = null), visible: () => visible });
    let t = 0;
    for (let i = 0; i <= FPS_WINDOW_MS / 16 + 1; i++) fn!((t += 16));
    expect(s.lines.filter((l) => l.kind === "fps")).toHaveLength(1);
    visible = false;
    for (let i = 0; i < 300; i++) fn!((t += 16));
    expect(s.lines.filter((l) => l.kind === "fps")).toHaveLength(1);
    stop();
    expect(fn).toBeNull();
  });
});

describe("WebRTC stats", () => {
  it("reads the call quality numbers the browser reports", () => {
    expect(
      readStats([
        { type: "media-source", kind: "audio", audioLevel: 0.12345 },
        { type: "inbound-rtp", kind: "audio", audioLevel: 0.5, jitter: 0.0123, packetsLost: 3, concealedSamples: 480, jitterBufferDelay: 2.4, jitterBufferEmittedCount: 48 },
        { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.0456 },
        { type: "inbound-rtp", kind: "video", jitter: 9 },
      ]),
    ).toEqual({ micLevel: 0.123, inLevel: 0.5, jitterMs: 12.3, lost: 3, concealed: 480, jitterBufferMs: 50, rttMs: 45.6 });
  });

  it("leaves out what is not reported", () => {
    expect(readStats([{ type: "inbound-rtp", kind: "audio", packetsLost: 0 }, { type: "remote-inbound-rtp", roundTripTime: 0.1 }])).toEqual({ lost: 0, rttMs: 100 });
    expect(readStats([])).toEqual({});
  });

  it("follows the link's states and samples stats while the peer lives", async () => {
    const s = sink();
    const listeners = new Map<string, () => void>();
    const target = (o: Record<string, unknown>) =>
      Object.assign(o, { addEventListener: (t: string, f: () => void) => listeners.set(t, f), removeEventListener: (t: string) => listeners.delete(t) });
    const pc = target({
      connectionState: "new",
      iceConnectionState: "new",
      getStats: async () => new Map([["a", { type: "inbound-rtp", kind: "audio", packetsLost: 1 }]]),
    });
    const dc = target({ readyState: "connecting" });
    let interval: (() => void) | null = null;
    const watch = createLinkWatch(s, { setInterval: (f) => ((interval = f), 7), clearInterval: () => (interval = null) });
    watch.link(pc, dc);
    pc.connectionState = "connected";
    listeners.get("connectionstatechange")!();
    dc.readyState = "open";
    listeners.get("open")!();
    interval!();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    watch.link(null, null);
    expect(interval).toBeNull();
    expect(listeners.size).toBe(0);
    expect(s.lines).toEqual([
      { kind: "rt.state", fields: { what: "pc", state: "new" } },
      { kind: "rt.state", fields: { what: "ice", state: "new" } },
      { kind: "rt.state", fields: { what: "dc", state: "connecting" } },
      { kind: "rt.state", fields: { what: "pc", state: "connected" } },
      { kind: "rt.state", fields: { what: "dc", state: "open" } },
      { kind: "rtc.stats", fields: { lost: 1 } },
    ]);
  });
});

describe("errors", () => {
  it("caps a message at 300 characters", () => {
    expect(errorMessage(new TypeError("x".repeat(400)))).toHaveLength(300);
    expect(errorMessage("plain")).toBe("plain");
  });
});
