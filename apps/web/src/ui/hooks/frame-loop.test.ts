import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AvatarState } from "@franki/core";
import { describe, expect, it } from "vitest";
import type { AvatarLook } from "../avatar/types";
import { FrameLoop, type FrameScheduler } from "./frame-loop";

function rig(initial: { state?: AvatarState; levels?: { input: number; output: number } } = {}) {
  const queue: ((t: number) => void)[] = [];
  let cancelled = 0;
  const scheduler: FrameScheduler & { tick(t: number): void; pending(): number } = {
    request: (cb) => {
      queue.push(cb);
      return queue.length;
    },
    cancel: () => {
      cancelled++;
      queue.length = 0;
    },
    tick: (t) => {
      const cbs = queue.splice(0);
      cbs.forEach((cb) => cb(t));
    },
    pending: () => queue.length,
  };
  const meter = {
    levels: initial.levels ?? { input: 0, output: 0 },
    paused: false,
    samples: 0,
    sample() {
      this.samples++;
      return this.levels;
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
  };
  const listeners = new Set<(v: boolean) => void>();
  let visible = true;
  const visibility = {
    isVisible: () => visible,
    subscribe: (l: (v: boolean) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(v: boolean) {
      visible = v;
      listeners.forEach((l) => l(v));
    },
  };
  const inputs = { state: initial.state ?? ("closed" as AvatarState), micMuted: false, outputMuted: false, reducedMotion: false };
  const published: AvatarLook[] = [];
  const loop = new FrameLoop({ scheduler, meter, visibility, read: () => inputs, publish: (l) => published.push(l) });
  return { loop, scheduler, meter, visibility, inputs, published, cancelled: () => cancelled };
}

describe("FrameLoop", () => {
  it("uses Frame_Time only: wake starts on the first connecting and ends after 1200 ms of frames", () => {
    const r = rig();
    r.loop.start();
    r.scheduler.tick(1000);
    expect(r.published.at(-1)!.name).toBe("Dormant");
    r.inputs.state = "connecting";
    r.scheduler.tick(1016);
    expect(r.published.at(-1)!.name).toBe("Waking");
    r.scheduler.tick(2000);
    expect(r.published.at(-1)!.name).toBe("Waking");
    r.scheduler.tick(2216);
    expect(r.published.at(-1)!.name).toBe("Connecting");
  });

  it("publishes only on a discrete change or a drive move of at least 1/32", () => {
    const r = rig({ state: "listening", levels: { input: 0.5, output: 0 } });
    r.loop.start();
    r.scheduler.tick(0);
    expect(r.published).toHaveLength(1);
    r.meter.levels = { input: 0.5 + 1 / 64, output: 0 };
    r.scheduler.tick(16);
    r.scheduler.tick(32);
    expect(r.published).toHaveLength(1);
    r.meter.levels = { input: 0.6, output: 0 };
    r.scheduler.tick(48);
    expect(r.published).toHaveLength(2);
    expect(r.published[1].drive).toBeCloseTo(0.6);
    r.inputs.micMuted = true;
    r.scheduler.tick(64);
    expect(r.published).toHaveLength(3);
    expect(r.published[2].ghost).toBe(true);
  });

  it("stops scheduling and pauses the meter while hidden, and resumes when visible", () => {
    const r = rig({ state: "listening" });
    r.loop.start();
    r.scheduler.tick(0);
    expect(r.scheduler.pending()).toBe(1);
    r.visibility.set(false);
    expect(r.loop.isRunning()).toBe(false);
    expect(r.meter.paused).toBe(true);
    expect(r.scheduler.pending()).toBe(0);
    const samples = r.meter.samples;
    r.scheduler.tick(16);
    expect(r.meter.samples).toBe(samples);
    r.visibility.set(true);
    expect(r.meter.paused).toBe(false);
    expect(r.scheduler.pending()).toBe(1);
    r.loop.stop();
    expect(r.scheduler.pending()).toBe(0);
  });

  it("does not start running while the page starts hidden", () => {
    const r = rig();
    r.visibility.set(false);
    r.loop.start();
    expect(r.loop.isRunning()).toBe(false);
    expect(r.meter.paused).toBe(true);
  });

  it("passes non-frame inputs at the latest Frame_Time", () => {
    const r = rig({ state: "listening" });
    r.loop.start();
    r.scheduler.tick(500);
    r.loop.input({ kind: "event", event: "celebrate" });
    expect(r.published.at(-1)!.name).toBe("Celebrate");
    r.scheduler.tick(2100);
    expect(r.published.at(-1)!.name).toBe("Listening");
  });

  it("reads no wall clock", () => {
    const src = readFileSync(join(__dirname, "frame-loop.ts"), "utf8");
    expect(src).not.toMatch(new RegExp(["Date", "performance"].map((n) => `\\b${n}\\s*\\.\\s*now`).join("|")));
  });
});
