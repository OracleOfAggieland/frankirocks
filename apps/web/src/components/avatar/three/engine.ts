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
import type { Acting, OneShotCommand } from "../../../ui/avatar/acting";
import type { EngineOptions } from "./config";
import type { BuildStep, EngineHost, Size, StepTiming } from "./context";
import { notPorted } from "./errors";
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

export async function createEngine(
  container: HTMLElement,
  size: Size,
  initial: Acting,
  options: EngineOptions,
  host: EngineHost,
  signal: AbortSignal,
): Promise<AvatarEngine> {
  return notPorted("createEngine", container, size, initial, options, host, signal);
}
