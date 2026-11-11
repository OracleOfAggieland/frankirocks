// The loop's contract edits (design note §2.3, §5.2): the quality ladder runs before the draw, the two audio gates,
// the still settle's probe pre-roll, and the frame-error limit. The renderer and the scene passes are fakes; the
// probes and the mouth driver are the real ones (createProbes, createRig). No WebGL.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Acting } from "../../../ui/avatar/acting";
import type { AudioReader } from "../../../ui/levels/audio-source";
import { createConfig, STILL_T } from "./config";
import { createLoop } from "./loop";
import { createRandom } from "./math";
import { createProbes } from "./probe";
import { createRig } from "./rig";

type LoopRc = Parameters<typeof createLoop>[0];
type RigRc = Parameters<typeof createRig>[0];

const SPEAKING: Acting = { name: "Speaking", pose: "speaking", overlay: "none", oneShot: null, ghost: false, mic: false, voice: true, electric: true };

/** A steady vowel: a 984 Hz tone, so the settled centroid sits far from the probe's starting 0.4 (an 'oh', not an 'ee'). */
function toneSource(reads: AudioReader[]) {
  return {
    read(which: AudioReader, _dt: number, time: Float32Array<ArrayBuffer>, db: Float32Array<ArrayBuffer>) {
      reads.push(which);
      for (let i = 0; i < time.length; i++) time[i] = 0.2 * Math.sin((2 * Math.PI * 21 * i) / time.length);
      db.fill(-140); db[21] = -20;
      return 48000;
    },
  };
}

function build({ still = false, acting = SPEAKING, w = 100, h = 100 }: { still?: boolean; acting?: Acting; w?: number; h?: number } = {}) {
  const log: string[] = [];
  const reads: AudioReader[] = [];
  const events: string[] = [];
  const scheduled: ((ts: number) => void)[] = [];
  const clock = { T: still ? STILL_T : 0 };
  const targets: Acting = { ...acting };
  const host = {
    mono: () => 0,
    audio: toneSource(reads),
    visibility: { isVisible: () => true, subscribe: () => () => {} },
    scheduler: { request: (cb: (ts: number) => void) => { scheduled.push(cb); return scheduled.length; }, cancel: () => { log.push("cancel"); } },
    onEvent: (e: { kind: string }) => events.push(e.kind),
  };
  const base = {
    host, clock, targets, size: { w, h }, errors: [] as string[], recordError: () => {}, ...createConfig({ still, quality: "auto" }),
    ...createRandom(), ...createProbes(),
    camera: new THREE.PerspectiveCamera(), eyes: [], head: new THREE.Group(), content: new THREE.Group(),
  };
  const rig = createRig(base as unknown as RigRc);
  let throwing = false;
  const rc = {
    ...base, ...rig,
    canvas: {},
    renderer: {
      info: { reset: () => {}, render: { calls: 0, triangles: 0 } },
      render: () => { if (throwing) throw new Error("bad frame"); log.push("render"); },
      shadowMap: { needsUpdate: false },
      getPixelRatio: () => 1,
    },
    scene: { updateMatrixWorld: () => {} },
    gradePass: { uniforms: { uTime: { value: 0 } } },
    sm: { shown: "speaking" },
    resolveState: () => ({ base: targets.pose, muted: false }),
    updateBlink: () => {}, updateGaze: () => {}, setTargets: () => {},
    TIME_WRAP: 3600,
    applyRig: () => {}, applyWorldFX: () => {}, updateFX: () => {}, updateCamera: () => {}, updateCatchLights: () => {},
    camState: { dist: 5 },
    quality: { ladder: [{ every: 1 }], idx: 0, mode: "auto" },
    perf: { ema: 16.7, cpu: 0 },
    buildLadder: () => {}, applyQuality: () => {}, setQualityMode: () => {},
    tickQuality: (dms: number) => { log.push(`tick ${dms.toFixed(1)}`); },
    dockTop: () => 0,
  };
  const loop = createLoop(rc as unknown as LoopRc);
  return { loop, rig, log, reads, events, scheduled, targets, audio: base.audio, setThrowing: (v: boolean) => { throwing = v; } };
}

describe("createLoop: the quality ladder runs before the draw", () => {
  it("a frame's tickQuality runs at the top of the next frame, so a tier change never clears a drawn frame", () => {
    const { loop, log } = build();
    loop.frameInner(1000);
    loop.frameInner(1016.7);
    loop.frameInner(1033.4);
    expect(log).toEqual(["render", "tick 0.0", "render", "tick 16.7", "render"]);
  });

  it("nothing renders after a tick within one frame", () => {
    const { loop, log } = build();
    for (let i = 0; i < 10; i++) {
      log.length = 0;
      loop.frameInner(1000 + i * 16.7);
      expect(log.at(-1)).toBe("render");
    }
  });
});

describe("createLoop: the two audio gates", () => {
  it("a closed gate never reads its stream and reads silence", () => {
    const { loop, reads, audio } = build({ acting: { ...SPEAKING, voice: false } });
    audio.voice.time.fill(0.5); audio.mic.time.fill(0.5);
    loop.feedProbes(1 / 60);
    expect(reads).toEqual([]);
    expect(audio.voice.time.every((x) => x === 0) && audio.mic.time.every((x) => x === 0)).toBe(true);
    expect(audio.voice.level).toBe(0);
  });

  it("an open gate reads only its own stream", () => {
    const { loop, reads, audio } = build();
    loop.feedProbes(1 / 60);
    expect(reads).toEqual(["voice"]);
    expect(audio.voice.level).toBeGreaterThan(0.8);
    expect(audio.mic.level).toBe(0);
  });
});

describe("createLoop: the still settle", () => {
  it("pre-rolls the probes in still mode only", () => {
    const still = build({ still: true });
    expect(still.loop.settle()).toBe(true);
    expect(still.reads.length).toBe(240 + 2);
    const live = build();
    expect(live.loop.settle()).toBe(true);
    expect(live.reads.length).toBe(2);
  });

  it("the still mouth takes the settled vowel, whatever the early frames' timing", () => {
    const settled = build({ still: true });
    settled.loop.settle();
    for (let i = 0; i < 120; i++) settled.loop.frameInner(i * 16.7);
    expect(settled.rig.mouthDrv.dom).toBe(1);                                  // 'oh': the tone's settled centroid
    expect(settled.rig.CH.mO.t).toBeCloseTo(1, 6);

    for (const ms of [7, 16.7, 33.4]) {
      const other = build({ still: true });
      other.loop.settle();
      for (let i = 0; i < 120; i++) other.loop.frameInner(i * ms);
      expect(other.rig.mouthDrv.dom).toBe(settled.rig.mouthDrv.dom);
      // The envelope's one-pole can sit one double ulp either side of its target, depending on the last dt; a float32
      // uniform cannot tell them apart.
      other.rig.mouthDrv.targets.forEach((x, i) => expect(x).toBeCloseTo(settled.rig.mouthDrv.targets[i], 12));
    }
  });

  it("without the pre-roll the frozen clock keeps the shape latched on the first open frame (the defect it fixes)", () => {
    const raw = build({ still: true });
    for (let i = 0; i < 120; i++) raw.loop.frameInner(i * 16.7);
    expect(raw.rig.mouthDrv.dom).not.toBe(1);
  });

  it("returns false on a zero-size box", () => {
    const { loop } = build({ w: 0, h: 0 });
    expect(loop.settle()).toBe(false);
  });
});

describe("createLoop: the loop machine", () => {
  it("30 bad frames in a row fail the engine and stop the loop", () => {
    const { loop, events, scheduled, setThrowing } = build();
    loop.send("built");
    loop.send("run");
    expect(loop.loopState().life).toBe("live");
    setThrowing(true);
    for (let i = 0; i < 30; i++) loop.frame(1000 + i * 16.7);
    expect(loop.loopState().life).toBe("failed");
    expect(events).toEqual(["failed"]);
    expect(scheduled.length).toBeGreaterThan(0);
  });
});
