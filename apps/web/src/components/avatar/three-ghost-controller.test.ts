// The three.js renderer's controller (brief 013, design note §5.1 and §8.1 WP12) with fake dependencies: no
// browser, no three.js, no network. Every phase change is the pure machines'; these tests pin what the controller
// does with them: the probe, the import, the build on `sized` only, settle before every fade-in, the engine's hold,
// one live engine across start and stop, and the Electricity grant.
import { describe, expect, it } from "vitest";
import type { Acting } from "../../ui/avatar/acting";
import { lookFor } from "../../ui/avatar/look";
import type { Phase } from "../../ui/avatar/renderer-phase";
import type { AvatarInput, AvatarLook } from "../../ui/avatar/types";
import { type ElectricityBudget, createElectricityBudget } from "../../ui/electricity-budget";
import type { AvatarAudioSource } from "../../ui/levels/audio-source";
import type { AvatarEngine, EngineEvent, EngineHost, EngineStats, EngineTargets, EngineTimings, Size } from "./three/engine";
import { ThreeGhostController } from "./three-ghost-controller";
import type { LoadedEngine, ThreeHostDeps } from "./three-host";

const BASE: AvatarInput = {
  state: "thinking",
  micMuted: false,
  outputMuted: false,
  inputLevel: 0,
  outputLevel: 0,
  event: null,
  eventElapsedMs: 0,
  firstConnecting: false,
  reducedMotion: false,
};

function look(p: Partial<AvatarInput> = {}): [AvatarLook, AvatarInput] {
  const input = { ...BASE, ...p };
  return [lookFor(input), input];
}

const THINKING = look();
const LISTENING = look({ state: "listening" });
const CONNECTING = look({ state: "connecting" });
const WAKING = look({ state: "connecting", event: "wake" });
const CELEBRATE = look({ event: "celebrate" });
const REDUCED = look({ reducedMotion: true });

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every settled promise's callbacks run. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

class FakeEngine implements AvatarEngine {
  readonly canvas = {} as HTMLCanvasElement;
  readonly log: string[] = [];
  readonly targets: EngineTargets[] = [];
  readonly settled: Acting[] = [];
  disposed = 0;
  setTargets(t: EngineTargets): void {
    this.targets.push(t);
    this.log.push(`targets ${t.acting.name} ${t.command.wake}/${t.command.celebrate} electric=${t.acting.electric}`);
  }
  settle(acting: Acting): void {
    this.settled.push(acting);
    this.log.push(`settle ${acting.name}`);
  }
  resize(w: number, h: number): void {
    this.log.push(`resize ${w}x${h}`);
  }
  pause(paused: boolean): void {
    this.log.push(paused ? "hold" : "run");
  }
  dispose(): void {
    this.disposed++;
    this.log.push("dispose");
  }
  timings(): EngineTimings {
    return { steps: [], warmMs: 0, settleMs: 0, totalMs: 0, longestCpuStepMs: 0, programs: { afterWarm: 0, afterSettle: 0 } };
  }
  stats(): EngineStats {
    return { fps: 0, frameMs: 0, cpuMs: 0, state: "idle", quality: "auto", drawCalls: 0, triangles: 0, errors: [] };
  }
}

interface Build {
  d: Deferred<AvatarEngine>;
  container: HTMLElement;
  size: Size;
  initial: Acting;
  signal: AbortSignal;
  host: EngineHost;
}

function harness(opts: { probe?: boolean | (() => boolean); budget?: ElectricityBudget } = {}) {
  const loads: Deferred<LoadedEngine>[] = [];
  const builds: Build[] = [];
  const engines: FakeEngine[] = [];
  const told: (AvatarEngine | null)[] = [];
  const observers: { el: HTMLElement; cb: (w: number, h: number) => void; live: boolean }[] = [];
  let probes = 0;
  const mod = {
    createEngine(container: HTMLElement, size: Size, initial: Acting, _options: unknown, host: EngineHost, signal: AbortSignal) {
      const d = deferred<AvatarEngine>();
      builds.push({ d, container, size, initial, signal, host });
      return d.promise;
    },
  } as unknown as LoadedEngine;
  const budget = opts.budget ?? createElectricityBudget(2);
  const deps: ThreeHostDeps = {
    options: { still: false, quality: "auto" },
    probeWebGL2() {
      probes++;
      const p = opts.probe ?? true;
      return typeof p === "function" ? p() : p;
    },
    loadEngine() {
      const d = deferred<LoadedEngine>();
      loads.push(d);
      return d.promise;
    },
    engineHost(audio: AvatarAudioSource, onEvent: (e: EngineEvent) => void): EngineHost {
      return {
        scheduler: { request: () => 0, cancel: () => {} },
        visibility: { isVisible: () => true, subscribe: () => () => {} },
        mono: () => 0,
        yieldNow: () => Promise.resolve(),
        audio,
        onEvent,
      };
    },
    observeSize(el, cb) {
      const o = { el, cb, live: true };
      observers.push(o);
      return () => {
        o.live = false;
      };
    },
    budget,
    onEngine: (e) => told.push(e),
  };
  const ctl = new ThreeGhostController(deps);
  const container = { id: "canvas-layer" } as unknown as HTMLElement;
  const phase = (): Phase => ctl.getSnapshot().phase;
  const liveObserver = () => observers.filter((o) => o.live).at(-1);
  const resize = (w: number, h: number) => liveObserver()?.cb(w, h);
  const set = ([l, i]: [AvatarLook, AvatarInput]) => ctl.setLook(l, i);

  /** A fresh engine for the newest build, resolved. */
  async function ready(): Promise<FakeEngine> {
    const e = new FakeEngine();
    engines.push(e);
    builds.at(-1)!.d.resolve(e);
    await flush();
    return e;
  }

  /** start, a look, the probe, the import, the container and its box: ends in building. */
  async function toBuilding(at: [AvatarLook, AvatarInput] = THINKING) {
    ctl.start();
    set(at);
    expect(phase()).toBe("loading");
    loads.at(-1)!.resolve(mod);
    await flush();
    expect(phase()).toBe("mounting");
    ctl.attach(container);
    resize(240, 264);
    expect(phase()).toBe("building");
  }

  async function toThree(at: [AvatarLook, AvatarInput] = THINKING): Promise<FakeEngine> {
    await toBuilding(at);
    const e = await ready();
    expect(phase()).toBe("fading-in");
    ctl.fadeDone();
    expect(phase()).toBe("three");
    return e;
  }

  const undisposed = () => engines.filter((e) => e.disposed === 0).length;
  return { ctl, deps, loads, builds, engines, told, observers, budget, container, mod, phase, resize, set, ready, toBuilding, toThree, undisposed, probes: () => probes };
}

describe("ThreeGhostController: server and first paint", () => {
  it("serves the SVG view, one stable object, before anything starts", () => {
    const { ctl } = harness();
    const s = ctl.getServerSnapshot();
    expect(s).toBe(ctl.getServerSnapshot());
    expect(s).toMatchObject({ phase: "svg", svg: "shown", canvas: "absent", engine: "none", loop: "none", failure: null, granted: false });
    expect(ctl.getSnapshot()).toEqual(s);
  });

  it("constructs without touching a dependency", () => {
    const h = harness();
    expect(h.probes()).toBe(0);
    expect(h.loads).toHaveLength(0);
    expect(h.observers).toHaveLength(0);
  });

  it("never probes or loads while reduced motion is on: the SVG ghost stays and three.js is never fetched", () => {
    const h = harness();
    h.ctl.start();
    h.set(REDUCED);
    expect(h.probes()).toBe(0);
    expect(h.loads).toHaveLength(0);
    expect(h.phase()).toBe("svg");
  });

  it("does nothing on a look before start", () => {
    const h = harness();
    h.set(THINKING);
    expect(h.probes()).toBe(0);
    expect(h.phase()).toBe("svg");
  });
});

describe("ThreeGhostController: failures keep the SVG ghost", () => {
  it("probe fails: failed no-webgl2, the engine chunk is never loaded", () => {
    const h = harness({ probe: false });
    h.ctl.start();
    h.set(THINKING);
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "failed", failure: "no-webgl2", svg: "shown", canvas: "absent" });
    expect(h.loads).toHaveLength(0);
  });

  it("a probe that throws reads as no WebGL 2", () => {
    const h = harness({
      probe: () => {
        throw new Error("no canvas");
      },
    });
    h.ctl.start();
    h.set(THINKING);
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "failed", failure: "no-webgl2" });
  });

  it("import fails: failed, SVG shown, no canvas layer", async () => {
    const h = harness();
    h.ctl.start();
    h.set(THINKING);
    h.loads[0].reject(new Error("chunk failed"));
    await flush();
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "failed", failure: "build", svg: "shown", canvas: "absent" });
    expect(h.builds).toHaveLength(0);
  });

  it("shader error during the build: failed shader, the SVG stays, a late event changes nothing", async () => {
    const h = harness();
    await h.toBuilding();
    h.builds[0].d.reject(Object.assign(new Error("link failed"), { reason: "shader" }));
    await flush();
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "failed", failure: "shader", svg: "shown", canvas: "absent", engine: "dispose" });
    h.ctl.fadeDone();
    h.set(LISTENING);
    expect(h.phase()).toBe("failed");
    expect(h.builds).toHaveLength(1);
  });

  it("the engine fails after ready (30 bad frames): disposed, SVG at once, the host told", async () => {
    const h = harness();
    const e = await h.toThree();
    h.builds[0].host.onEvent({ kind: "failed", reason: "frames", detail: "30 frame errors" });
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "failed", failure: "frames", svg: "shown", canvas: "absent" });
    expect(e.disposed).toBe(1);
    expect(h.told).toEqual([e, null]);
    expect(h.budget.active()).toBe(0);
  });

  it("an aborted build is not a failure", async () => {
    const h = harness();
    await h.toBuilding();
    h.builds[0].d.reject(Object.assign(new Error("aborted"), { reason: "aborted" }));
    await flush();
    expect(h.phase()).toBe("building");
  });
});

describe("ThreeGhostController: mount, size, ready, settle, fade", () => {
  it("builds once, on the first non-zero box, with the current look and no grant", async () => {
    const h = harness();
    h.ctl.start();
    h.set(THINKING);
    h.loads[0].resolve(h.mod);
    await flush();
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "mounting", svg: "shown", canvas: "hidden", engine: "await-size" });
    expect(h.builds).toHaveLength(0);
    h.ctl.attach(h.container);
    h.resize(0, 0);
    expect(h.phase()).toBe("mounting");
    h.resize(240, 264);
    h.resize(250, 275);
    expect(h.phase()).toBe("building");
    expect(h.builds).toHaveLength(1);
    const b = h.builds[0];
    expect(b.container).toBe(h.container);
    expect(b.size).toEqual({ w: 240, h: 264 });
    expect(b.initial).toMatchObject({ name: "Thinking", pose: "thinking", electric: false });
    expect(b.signal.aborted).toBe(false);
  });

  it("settles the current look before the canvas fades in, then releases the hold", async () => {
    const h = harness();
    await h.toBuilding();
    h.set(LISTENING);
    const e = await h.ready();
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "fading-in", svg: "leaving", canvas: "entering", loop: "runs" });
    const settle = e.log.indexOf("settle Listening");
    expect(settle).toBeGreaterThanOrEqual(0);
    expect(e.log.indexOf("run")).toBeGreaterThan(settle);
    expect(h.told).toEqual([e]);
    h.ctl.fadeDone();
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "three", svg: "absent", canvas: "shown" });
  });

  it("a resize during the build reaches the engine once it is ready; a 0 x 0 box keeps the last good size", async () => {
    const h = harness();
    await h.toBuilding();
    h.resize(300, 330);
    const e = await h.ready();
    expect(e.log).toContain("resize 300x330");
    h.resize(0, 0);
    h.resize(300, 330);
    expect(e.log.filter((l) => l.startsWith("resize"))).toEqual(["resize 300x330"]);
    h.resize(200, 220);
    expect(e.log.at(-1)).toBe("resize 200x220");
  });

  it("forwards the audio source the context gives, and reads silence without one", async () => {
    const h = harness();
    await h.toBuilding();
    const host = h.builds[0].host;
    const time = new Float32Array(1024);
    const db = new Float32Array(512);
    expect(host.audio.read("voice", 0.016, time, db)).toBe(0);
    h.ctl.setAudio({ read: (which) => (which === "voice" ? 48000 : 0) });
    expect(host.audio.read("voice", 0.016, time, db)).toBe(48000);
    expect(host.audio.read("mic", 0.016, time, db)).toBe(0);
    h.ctl.setAudio(null);
    expect(host.audio.read("voice", 0.016, time, db)).toBe(0);
  });

  it("publishes only on a change", async () => {
    const h = harness();
    let calls = 0;
    h.ctl.subscribe(() => calls++);
    await h.toThree();
    const before = calls;
    const snap = h.ctl.getSnapshot();
    h.set(THINKING);
    expect(calls).toBe(before);
    expect(h.ctl.getSnapshot()).toBe(snap);
  });
});

describe("ThreeGhostController: one-shots", () => {
  it("starts the wake and the celebrate while running, and cuts each on leaving", async () => {
    const h = harness();
    const e = await h.toThree(LISTENING);
    h.set(WAKING);
    expect(e.targets.at(-1)!.command).toEqual({ wake: "start", celebrate: "none" });
    h.set(CELEBRATE);
    expect(e.targets.at(-1)!.command).toEqual({ wake: "cut", celebrate: "start" });
    h.set(THINKING);
    expect(e.targets.at(-1)!.command).toEqual({ wake: "none", celebrate: "cut" });
    expect(h.phase()).toBe("three");
  });

  it("a one-shot whose start the build missed waits under the SVG, then fades in with a settle", async () => {
    const h = harness();
    await h.toBuilding(CONNECTING);
    h.set(WAKING);
    const e = await h.ready();
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "waiting", svg: "shown", canvas: "hidden", loop: "runs" });
    expect(e.settled).toHaveLength(0);
    expect(e.log).toContain("run");
    h.set(WAKING);
    expect(h.phase()).toBe("waiting");
    h.set(CONNECTING);
    expect(h.phase()).toBe("fading-in");
    expect(e.settled.at(-1)).toMatchObject({ name: "Connecting", oneShot: null });
    expect(e.targets.every((t) => t.command.wake === "none")).toBe(true);
  });

  it("a new one-shot that starts while waiting is started after the fade-in's settle, so the settle never cuts it", async () => {
    const h = harness();
    await h.toBuilding(THINKING);
    h.set(CELEBRATE);
    const e = await h.ready();
    expect(h.phase()).toBe("waiting");
    e.log.length = 0;
    h.set(WAKING);
    expect(h.phase()).toBe("fading-in");
    const settleAt = e.log.findIndex((l) => l.startsWith("settle"));
    const startAt = e.log.findIndex((l) => l.startsWith("targets Waking start/"));
    expect(settleAt).toBeGreaterThanOrEqual(0);
    expect(startAt).toBeGreaterThan(settleAt);
  });
});

describe("ThreeGhostController: reduced motion, lost and restored", () => {
  it("reduced on fades the SVG back and holds the engine; off settles and fades in again", async () => {
    const h = harness();
    const e = await h.toThree();
    h.set(look({ reducedMotion: true }));
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "fading-out", svg: "entering", canvas: "shown" });
    h.ctl.fadeDone();
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "held", svg: "shown", canvas: "hidden", loop: "held" });
    expect(e.log.at(-1)).toBe("hold");
    expect(e.disposed).toBe(0);
    const settles = e.settled.length;
    h.set(THINKING);
    expect(h.phase()).toBe("fading-in");
    expect(e.settled).toHaveLength(settles + 1);
    expect(e.log.lastIndexOf("run")).toBeGreaterThan(e.log.lastIndexOf(`settle Thinking`));
  });

  it("reduced on during the fade-in cuts straight to held", async () => {
    const h = harness();
    await h.toBuilding();
    const e = await h.ready();
    h.set(look({ reducedMotion: true }));
    expect(h.phase()).toBe("held");
    expect(e.log.lastIndexOf("hold")).toBeGreaterThan(e.log.lastIndexOf("run"));
    // The grant goes with the screen time: arcs off on the held engine.
    expect(h.ctl.getSnapshot().granted).toBe(false);
  });

  it("a lost context shows the SVG at once; restored settles before the fade", async () => {
    const h = harness();
    const e = await h.toThree();
    const host = h.builds[0].host;
    host.onEvent({ kind: "lost" });
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "lost", svg: "shown", canvas: "hidden", loop: "stopped" });
    const settles = e.settled.length;
    host.onEvent({ kind: "restored" });
    expect(h.phase()).toBe("fading-in");
    expect(e.settled).toHaveLength(settles + 1);
    expect(e.disposed).toBe(0);
  });

  it("a context lost while held can still come back: the hold is released so the engine can draw its first good frame", async () => {
    const h = harness();
    const e = await h.toThree();
    h.set(look({ reducedMotion: true }));
    h.ctl.fadeDone();
    expect(e.log.at(-1)).toBe("hold");
    h.builds[0].host.onEvent({ kind: "lost" });
    expect(e.log.at(-1)).toBe("run");
    h.builds[0].host.onEvent({ kind: "restored" });
    expect(h.phase()).toBe("held");
    expect(e.log.at(-1)).toBe("hold");
  });

  it("frame and shader errors the engine records are not phase events", async () => {
    const h = harness();
    await h.toThree();
    h.builds[0].host.onEvent({ kind: "error", where: "frame", detail: "x" });
    expect(h.phase()).toBe("three");
  });
});

describe("ThreeGhostController: start and stop (Strict Mode, Fast Refresh, unmount)", () => {
  it("stop disposes the engine, releases the grant, disconnects the size observer and tells the host", async () => {
    const h = harness();
    const e = await h.toThree();
    expect(h.budget.active()).toBe(1);
    h.ctl.stop();
    expect(e.disposed).toBe(1);
    expect(h.budget.active()).toBe(0);
    expect(h.observers.every((o) => !o.live)).toBe(true);
    expect(h.told).toEqual([e, null]);
    expect(h.ctl.getSnapshot()).toMatchObject({ phase: "svg", svg: "shown", canvas: "absent", granted: false });
    h.ctl.stop();
    expect(e.disposed).toBe(1);
  });

  it("stop during the import: the late module is ignored, nothing is built", async () => {
    const h = harness();
    h.ctl.start();
    h.set(THINKING);
    h.ctl.stop();
    h.loads[0].resolve(h.mod);
    await flush();
    expect(h.phase()).toBe("svg");
    expect(h.builds).toHaveLength(0);
  });

  it("stop during the build aborts it; an engine that still arrives is disposed at once", async () => {
    const h = harness();
    await h.toBuilding();
    const b = h.builds[0];
    h.ctl.stop();
    expect(b.signal.aborted).toBe(true);
    const late = await h.ready();
    expect(late.disposed).toBe(1);
    expect(h.undisposed()).toBe(0);
    expect(h.told).toEqual([]);
    expect(h.phase()).toBe("svg");
  });

  const DRIVE_TO: Record<string, (h: ReturnType<typeof harness>) => Promise<void>> = {
    svg: async (h) => {
      h.ctl.start();
      h.set(REDUCED);
    },
    loading: async (h) => {
      h.ctl.start();
      h.set(THINKING);
    },
    mounting: async (h) => {
      h.ctl.start();
      h.set(THINKING);
      h.loads[0].resolve(h.mod);
      await flush();
    },
    building: (h) => h.toBuilding(),
    waiting: async (h) => {
      await h.toBuilding(CONNECTING);
      h.set(WAKING);
      await h.ready();
    },
    "fading-in": async (h) => {
      await h.toBuilding();
      await h.ready();
    },
    three: async (h) => {
      await h.toThree();
    },
    "fading-out": async (h) => {
      await h.toThree();
      h.set(look({ reducedMotion: true }));
    },
    held: async (h) => {
      await h.toThree();
      h.set(look({ reducedMotion: true }));
      h.ctl.fadeDone();
    },
    lost: async (h) => {
      await h.toThree();
      h.builds[0].host.onEvent({ kind: "lost" });
    },
    failed: async (h) => {
      await h.toBuilding();
      h.builds[0].d.reject(Object.assign(new Error("x"), { reason: "create" }));
      await flush();
    },
  };

  for (const [from, drive] of Object.entries(DRIVE_TO)) {
    it(`start, stop, start from ${from} equals a fresh start and ends with exactly one live engine`, async () => {
      const h = harness();
      await drive(h);
      expect(h.phase()).toBe(from);
      expect(h.undisposed()).toBeLessThanOrEqual(1);
      h.ctl.stop();
      expect(h.undisposed()).toBe(0);
      h.ctl.start();
      h.set(THINKING);

      const fresh = harness();
      fresh.ctl.start();
      fresh.set(THINKING);
      expect(h.ctl.getSnapshot()).toEqual(fresh.ctl.getSnapshot());

      // Anything still pending from the first run resolves now and must change nothing: a late engine is disposed
      // at once and told nothing else.
      const stale = h.builds.map(() => new FakeEngine());
      h.builds.forEach((b, i) => b.d.resolve(stale[i]));
      for (const l of h.loads.slice(0, -1)) l.resolve(h.mod);
      await flush();
      expect(h.phase()).toBe("loading");
      for (const s of stale) expect(s.log).toEqual(s.disposed === 1 ? ["dispose"] : []);

      // The second run goes all the way to three.js with a new build. A container that stayed mounted is measured
      // again at once; a first container arrives through the ref.
      h.loads.at(-1)!.resolve(h.mod);
      await flush();
      if (h.phase() === "mounting") {
        h.ctl.attach(h.container);
        h.resize(240, 264);
      }
      expect(h.phase()).toBe("building");
      expect(h.builds.at(-1)!.container).toBe(h.container);
      const e = new FakeEngine();
      h.engines.push(e);
      h.builds.at(-1)!.d.resolve(e);
      await flush();
      h.ctl.fadeDone();
      expect(h.phase()).toBe("three");
      expect(h.undisposed()).toBe(1);
      expect(h.observers.filter((o) => o.live)).toHaveLength(1);
    });
  }

  it("a container that stays mounted across stop and start is measured again and built into", async () => {
    const h = harness();
    await h.toThree();
    h.ctl.stop();
    h.ctl.start();
    expect(h.phase()).toBe("loading");
    h.loads.at(-1)!.resolve(h.mod);
    await flush();
    // React did not call the ref again: the controller re-observes the same container and builds on its box.
    expect(h.observers.filter((o) => o.live)).toHaveLength(1);
    expect(h.phase()).toBe("building");
    expect(h.builds.at(-1)!.container).toBe(h.container);
  });

  it("an unmounted container stops being observed", async () => {
    const h = harness();
    await h.toThree();
    h.ctl.attach(null);
    expect(h.observers.every((o) => !o.live)).toBe(true);
  });
});

describe("ThreeGhostController: the Electricity grant", () => {
  it("is held only while the three.js ghost is on screen and the look is electric", async () => {
    const h = harness();
    const e = await h.toThree();
    expect(h.ctl.getSnapshot().granted).toBe(true);
    expect(e.targets.at(-1)!.acting.electric).toBe(true);
    h.set(LISTENING);
    expect(h.ctl.getSnapshot().granted).toBe(false);
    expect(h.budget.active()).toBe(0);
    h.set(THINKING);
    expect(h.ctl.getSnapshot().granted).toBe(true);
    h.builds[0].host.onEvent({ kind: "lost" });
    expect(h.ctl.getSnapshot().granted).toBe(false);
    expect(h.budget.active()).toBe(0);
  });

  it("denied at fading-in: arcs off; once the SVG layer releases its own, syncGrant grants without a look change", async () => {
    const budget = createElectricityBudget(1);
    const h = harness({ budget });
    const svgToken = budget.request();
    expect(svgToken).not.toBeNull();
    await h.toBuilding();
    const e = await h.ready();
    expect(h.phase()).toBe("fading-in");
    expect(h.ctl.getSnapshot().granted).toBe(false);
    expect(e.settled.at(-1)!.electric).toBe(false);
    h.ctl.fadeDone();
    expect(h.phase()).toBe("three");
    expect(h.ctl.getSnapshot().granted).toBe(false);
    // The SVG layer unmounted and its Electricity released its grant; the effect on [phase, electric] runs.
    budget.release(svgToken!);
    const before = e.targets.length;
    h.ctl.syncGrant();
    expect(h.ctl.getSnapshot().granted).toBe(true);
    expect(e.targets).toHaveLength(before + 1);
    expect(e.targets.at(-1)).toMatchObject({ acting: { name: "Thinking", electric: true }, command: { wake: "none", celebrate: "none" } });
  });
});
