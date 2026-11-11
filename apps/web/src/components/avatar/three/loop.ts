// Prototype franki.html 3337-3454 (section 14: the main loop), 3269-3272 (the pointer listener, from ui.init) and
// 3473-3477, 3481 (the start lines), ported in WP10. Allowed edits E1-E7, E11 (`_proj` re-declared for
// frameAboveDock) and the contract edits of design note §3.3 loop.ts:
// - no THREE.Timer: `rawDt = prevTs === null ? 0 : (ts - prevTs) / 1000`, unclamped, for perf.ema and tickQuality;
//   `dt = clamp(rawDt, 0, 0.05)`; prevTs is null after every run(), so the first frame back has dt 0;
// - `c0 = host.mono()`; frameInner applies a pending size first (queueResize), before the zero-size check;
// - feedProbes reads host.audio only while `targets.mic` / `targets.voice` is open, otherwise silence();
// - settle(): two frameInner calls with dt 0 that snap CH_LIST at 3380 and again after applyRig;
// - the try/catch of frame() reports to the loop machine (FRAME_ERROR_LIMIT bad frames in a row fail the engine);
// - removed: sim.update, call.tick, ui.tick, renderer.setAnimationLoop, the window resize listener, notify.
// The loop machine itself is the pure loopStep/loopRuns of ui/avatar/renderer-phase.ts.
import type { LoopEvent, LoopState } from "../../../ui/avatar/renderer-phase";
import type { Rig } from "./context";
import { notPorted } from "./errors";

export interface EngineStats {
  fps: number;
  frameMs: number;
  cpuMs: number;
  /** `sm.shown`, as the prototype reports it. */
  state: string;
  /** `${quality.mode}:${tier}@${pr.toFixed(2)}`, the pixel ratio after E10. */
  quality: string;
  drawCalls: number;
  triangles: number;
  /** Frame and shader errors recorded since create, newest last, at most 20. */
  errors: string[];
}

export interface LoopPart {
  SUB: number;
  feedProbes(dt: number): void;
  /** The try/catch wrapper of 3358-3361. */
  frame(ts: number): void;
  frameInner(ts: number): void;
  stats(): EngineStats;
  frameAboveDock(w: number, h: number): void;
  resize(): void;
  /** contract: records a pending CSS size; frameInner applies it first (size.w, size.h, then resize()). */
  queueResize(w: number, h: number): void;
  watchDpr(): void;
  onDprChange(): void;
  /** 3474-3477 and 3481: buildLadder, watchDpr, setQualityMode(quality.mode), resize, scheduleBlink(0, 'idle'). */
  boot(): void;
  /** contract: two frameInner calls with dt 0, snapping every channel (3380) after setTargets and after applyRig. */
  settle(): void;
  loopState(): LoopState;
  /** Steps the loop machine and requests or cancels the next frame to match loopRuns. */
  send(e: LoopEvent): void;
  /** pointermove (3269-3272, with the contract pointer edit), the DPR query, visibility and the two context listeners. */
  attach(): void;
  detach(): void;
  run(): void;
  halt(): void;
}

export function createLoop(rc: Omit<Rig, keyof LoopPart>): LoopPart {
  return notPorted("createLoop", rc);
}
