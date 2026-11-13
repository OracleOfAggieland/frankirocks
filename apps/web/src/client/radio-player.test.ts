import { describe, expect, it } from "vitest";
import { RADIO_RAMP_MS, RADIO_RAMP_STEPS, type RadioAudioElement, type RadioPlayerReport, createRadioPlayer } from "./radio-player";

class FakeAudio implements RadioAudioElement {
  src = "";
  preload = "auto";
  volume = 1;
  paused = true;
  loads = 0;
  removed: string[] = [];
  readonly handlers = new Map<string, Set<() => void>>();
  playResult: () => Promise<void> = () => Promise.resolve();
  play() {
    this.paused = false;
    return this.playResult();
  }
  pause() {
    this.paused = true;
  }
  load() {
    this.loads++;
  }
  removeAttribute(name: string) {
    this.removed.push(name);
    if (name === "src") this.src = "";
  }
  addEventListener(type: string, l: () => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(l);
  }
  removeEventListener(type: string, l: () => void) {
    this.handlers.get(type)?.delete(l);
  }
  emit(type: string) {
    for (const l of this.handlers.get(type) ?? []) l();
  }
}

const refusal = (name: string) => Object.assign(new Error(name), { name });

function harness() {
  const made: FakeAudio[] = [];
  let now = 0;
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let nextId = 1;
  const player = createRadioPlayer({
    makeAudio: () => {
      const a = new FakeAudio();
      made.push(a);
      return a;
    },
    timers: {
      setTimeout: (fn, ms) => {
        const id = nextId++;
        timers.push({ fn, at: now + ms, id });
        return id;
      },
      clearTimeout: (h) => {
        const i = timers.findIndex((t) => t.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
    },
  });
  const reports: [number, RadioPlayerReport][] = [];
  player.onReport((t, r) => reports.push([t, r]));
  const runAll = () => {
    while (timers.length > 0) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers.shift()!;
      now = t.at;
      t.fn();
    }
  };
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { player, made, timers, reports, runAll, flush, clock: () => now };
}

describe("createRadioPlayer", () => {
  it("makes no element until the first load, then exactly one", () => {
    const h = harness();
    h.player.setGain(0.5);
    h.player.stop();
    expect(h.made).toHaveLength(0);
    h.player.load("https://radio.test/a", 1);
    h.player.load("https://radio.test/b", 2);
    expect(h.made).toHaveLength(1);
    expect(h.made[0]!.preload).toBe("none");
    expect(h.made[0]!.src).toBe("https://radio.test/b");
    expect(h.made[0]!.volume).toBe(0.5);
  });

  it("reports the element's events under the tune it was loaded with", () => {
    const h = harness();
    h.player.load("https://radio.test/a", 7);
    const a = h.made[0]!;
    a.emit("waiting");
    a.emit("playing");
    a.emit("stalled");
    a.emit("error");
    expect(h.reports).toEqual([
      [7, "waiting"],
      [7, "playing"],
      [7, "waiting"],
      [7, "failed"],
    ]);
  });

  it("reports blocked when play() is refused without a press", async () => {
    const h = harness();
    h.player.load("https://radio.test/a", 1);
    h.made[0]!.playResult = () => Promise.reject(refusal("NotAllowedError"));
    h.player.load("https://radio.test/a", 2);
    await h.flush();
    expect(h.reports).toEqual([[2, "blocked"]]);
  });

  it("reports failed for any other refusal, and nothing for an interrupted play()", async () => {
    const h = harness();
    h.player.load("https://radio.test/a", 1);
    const a = h.made[0]!;
    a.playResult = () => Promise.reject(refusal("NotSupportedError"));
    h.player.load("https://radio.test/a", 2);
    a.playResult = () => Promise.reject(refusal("AbortError"));
    h.player.load("https://radio.test/b", 3);
    await h.flush();
    expect(h.reports).toEqual([]);
    a.playResult = () => Promise.reject(refusal("NotSupportedError"));
    h.player.load("https://radio.test/c", 4);
    await h.flush();
    expect(h.reports).toEqual([[4, "failed"]]);
  });

  it("stop pauses, drops the source, reloads, and reports nothing after", () => {
    const h = harness();
    h.player.load("https://radio.test/a", 1);
    const a = h.made[0]!;
    h.player.stop();
    expect(a.paused).toBe(true);
    expect(a.removed).toContain("src");
    expect(a.src).toBe("");
    expect(a.loads).toBe(1);
    a.emit("error");
    a.emit("playing");
    expect(h.reports).toEqual([]);
  });

  it(`ramps a gain change over ${RADIO_RAMP_MS} ms in ${RADIO_RAMP_STEPS} steps, ending exactly on the target`, () => {
    const h = harness();
    h.player.load("https://radio.test/a", 1);
    const a = h.made[0]!;
    expect(a.volume).toBe(1);
    h.player.setGain(0.12);
    expect(a.volume).toBe(1);
    const seen: number[] = [];
    while (h.timers.length > 0) {
      h.timers.sort((x, y) => x.at - y.at);
      const t = h.timers.shift()!;
      t.fn();
      seen.push(a.volume);
    }
    expect(seen).toHaveLength(RADIO_RAMP_STEPS);
    expect(seen.at(-1)).toBe(0.12);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThan(seen[i - 1]!);
  });

  it("a new gain mid-ramp replaces the old ramp; the gain is clamped", () => {
    const h = harness();
    h.player.load("https://radio.test/a", 1);
    const a = h.made[0]!;
    h.player.setGain(0);
    h.timers.sort((x, y) => x.at - y.at)[0]!.fn();
    h.timers.shift();
    h.player.setGain(7);
    expect(h.timers).toHaveLength(1);
    h.runAll();
    expect(a.volume).toBe(1);
  });

  it("dispose stops and lets go of the listeners", () => {
    const h = harness();
    h.player.load("https://radio.test/a", 1);
    const a = h.made[0]!;
    h.player.dispose();
    expect(a.paused).toBe(true);
    expect([...a.handlers.values()].every((s) => s.size === 0)).toBe(true);
  });
});
