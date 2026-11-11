// The engine's facade (brief 013, design note §3.3 engine.ts), written in WP10. The only module import()ed from
// outside three/; nothing outside three/ value-imports any file inside it.
//
// createEngine: creates and styles its own canvas (display block, width and height 100% of the container; every
// setSize keeps its third argument false, so only the backing store follows the pixel ratio), appends it, and runs
// buildRig with the loop held. Then, in order: attach the context listeners; boot(); warm the programs under the key
// the output path uses (render into a 1×1 WebGLRenderTarget while compileAsync takes its keys, then back to null);
// settle(initial). It resolves only if no shader error was recorded, the context is not lost and the settle frames
// rendered; otherwise it frees everything and rejects with EngineError ("shader", "create", "frames" or "aborted").
// Shadow-depth, PMREM, bloom, grade and output programs are not covered by the warm-up: they compile in the stage
// step and in the settle frames, and timings() reports both.
//
// Ready is the loop machine's `built`: life leaves "building" only once createEngine is about to resolve, so the
// loop's own host events (lost, restored, failed frames) and the shader and frame errors below reach the host only
// after ready. Before ready, every failure is the rejection.
import * as THREE from "three";
import { type Acting, NO_COMMAND, type OneShotCommand } from "../../../ui/avatar/acting";
import type { EngineFailure } from "../../../ui/avatar/renderer-phase";
import type { EngineOptions } from "./config";
import { type BuildStep, type EngineHost, type ErrorKind, type Rig, type Size, type StepTiming, buildRig } from "./context";
import { disposeRig } from "./dispose";
import { EngineError } from "./errors";
import type { EngineStats } from "./loop";

export type { BuildStep, EngineHost, EngineOptions, EngineStats, Size, StepTiming };
export type { EngineEvent } from "./context";

export interface EngineTargets {
  acting: Acting;
  command: OneShotCommand;
}

export interface EngineTimings {
  steps: readonly StepTiming[];
  /** The program warm-up (compileAsync under a render target). */
  warmMs: number;
  /** settle(): two frames, including the programs the warm-up does not cover. */
  settleMs: number;
  totalMs: number;
  /** The longest step except "stage", which holds the PMREM and the renderer's own setup. */
  longestCpuStepMs: number;
  /** renderer.info.programs.length after the warm-up and after the settle frames; equal when the warm-up hit. */
  programs: { afterWarm: number; afterSettle: number };
}

export interface AvatarEngine {
  /** Created and owned by the engine; aria-hidden, no tab stop. */
  readonly canvas: HTMLCanvasElement;
  /** Not the per-frame setTargets inside state.ts: this calls applyTargets. */
  setTargets(t: EngineTargets): void;
  /**
   * Shows a real frame of `acting` at once: applyTargets(acting, NO_COMMAND), endOneShots(), then the loop's two
   * snapping frames. The controller calls it on every entry into fading-in while the canvas is at opacity 0.
   */
  settle(acting: Acting): void;
  /** Records a pending size; the next frame applies it before drawing (no cleared frame on screen). */
  resize(cssWidth: number, cssHeight: number): void;
  /** The host's hold. A hidden tab and a lost context are handled inside, by the loop machine. */
  pause(paused: boolean): void;
  /** Idempotent. */
  dispose(): void;
  timings(): EngineTimings;
  stats(): EngineStats;
}

/** Where createEngine is after the build, so an unexpected throw is named for what it interrupted. */
type Stage = "boot" | "warm" | "settle";
const FAILURE_AT: Record<Stage, EngineFailure> = { boot: "build", warm: "shader", settle: "frames" };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function createEngine(
  container: HTMLElement,
  size: Size,
  initial: Acting,
  options: EngineOptions,
  host: EngineHost,
  signal: AbortSignal,
): Promise<AvatarEngine> {
  const t0 = host.mono();
  if (signal.aborted) throw new EngineError("aborted", "before create");

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  container.appendChild(canvas);

  // The first shader error is kept from the first program on; the host hears errors only after ready.
  let shaderError: string | null = null;
  let live: Rig | null = null;
  const onRecord = (kind: ErrorKind, msg: string) => {
    if (kind === "shader" && shaderError === null) shaderError = msg;
    if (live === null || live.loopState().life === "building" || live.loopState().life === "disposed") return;
    host.onEvent({ kind: "error", where: kind, detail: msg });
    if (kind === "shader") host.onEvent({ kind: "failed", reason: "shader", detail: msg });
  };

  let built: { rig: Rig; steps: StepTiming[] };
  try {
    built = await buildRig(host, canvas, { w: size.w, h: size.h }, initial, options, signal, onRecord);
  } catch (e) {
    canvas.remove();                                       // buildRig already freed what it built
    throw e;
  }
  const { rig, steps } = built;

  const freeAll = () => {
    try { rig.send("dispose"); } finally {
      try { rig.detach(); } finally { disposeRig(rig); }
    }
  };

  let stage: Stage = "boot";
  let warmMs = 0, settleMs = 0, afterWarm = 0, afterSettle = 0;
  try {
    rig.attach();
    rig.boot();
    await host.yieldNow();                                 // boot sizes the targets; let waiting tasks run before the warm-up
    if (signal.aborted) throw new EngineError("aborted", "after boot");

    stage = "warm";
    const w0 = host.mono();
    const warm = new THREE.WebGLRenderTarget(1, 1);
    rig.renderer.setRenderTarget(warm);
    const ready = rig.renderer.compileAsync(rig.scene, rig.camera);
    rig.renderer.setRenderTarget(null);
    try {
      await ready;
    } finally {
      warm.dispose();
    }
    warmMs = host.mono() - w0;
    afterWarm = rig.renderer.info.programs?.length ?? 0;
    if (signal.aborted) throw new EngineError("aborted", "after the warm-up");

    stage = "settle";
    const s0 = host.mono();
    rig.applyTargets(initial, NO_COMMAND);
    rig.endOneShots();
    const drew = rig.settle();
    settleMs = host.mono() - s0;
    afterSettle = rig.renderer.info.programs?.length ?? 0;

    if (shaderError !== null) throw new EngineError("shader", shaderError);
    if (rig.renderer.getContext().isContextLost()) throw new EngineError("create", "the WebGL context was lost during the build");
    if (!drew) throw new EngineError("frames", "the settle frames did not draw");
    if (signal.aborted) throw new EngineError("aborted", "after the settle frames");
  } catch (e) {
    try { freeAll(); } catch { /* the build's own error is the one that matters */ }
    if (e instanceof EngineError) throw e;
    throw new EngineError(FAILURE_AT[stage], messageOf(e));
  }

  rig.send("built");
  live = rig;
  const others = steps.filter((s) => s.name !== "stage");
  const timings: EngineTimings = {
    steps,
    warmMs,
    settleMs,
    totalMs: host.mono() - t0,
    longestCpuStepMs: others.reduce((m, s) => Math.max(m, s.ms), 0),
    programs: { afterWarm, afterSettle },
  };
  const gone = () => rig.loopState().life === "disposed";

  return {
    canvas,
    setTargets({ acting, command }) {
      if (gone()) return;
      rig.applyTargets(acting, command);
    },
    settle(acting) {
      if (gone()) return;
      rig.applyTargets(acting, NO_COMMAND);
      rig.endOneShots();
      try {
        rig.settle();
      } catch (e) {
        rig.recordError("frame", messageOf(e));
        rig.send("frame-error");
      }
    },
    resize(cssWidth, cssHeight) {
      if (gone()) return;
      rig.queueResize(cssWidth, cssHeight);
    },
    pause(paused) {
      rig.send(paused ? "hold" : "run");
    },
    dispose() {
      if (gone()) return;
      try { freeAll(); } catch (e) { rig.recordError("frame", `dispose: ${messageOf(e)}`); }
    },
    timings: () => timings,
    stats: () => rig.stats(),
  };
}
