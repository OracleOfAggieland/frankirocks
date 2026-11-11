// The renderer phase machine and the three.js engine's loop machine (brief 013, design note
// docs/briefs/013-design.md §4 and §5.2). Pure. fallbackFor is the truth table; rendererStep moves the phase
// toward what it says, with the crossfades; rendererView says what to draw and do in each phase.

/** Why the engine is not showing. Engine errors carry one of these; `aborted` is a mount that went away, not a failure. */
export type EngineFailure = "no-webgl2" | "create" | "build" | "merge" | "shader" | "frames" | "aborted";

export type GlSupport = "unknown" | "webgl2" | "none";
export type EngineStatus = "absent" | "loading" | "building" | "ready" | "lost" | "failed";

/** The truth table of §4.1. Only webgl2 + ready + not reduced + no skipped one-shot shows three.js. */
export function fallbackFor(f: { gl: GlSupport; engine: EngineStatus; reducedMotion: boolean; oneShotSkipped: boolean }): "svg" | "three" {
  return notPorted("fallbackFor", f);
}

export type Phase =
  | "svg"
  | "loading"
  | "mounting"
  | "building"
  | "waiting"
  | "fading-in"
  | "three"
  | "fading-out"
  | "held"
  | "lost"
  | "failed";

export interface RendererState {
  phase: Phase;
  reduced: boolean;
  /** The look is a one-shot whose start the engine did not see. Never true in fading-in, three or fading-out. */
  skipped: boolean;
  failure: EngineFailure | null;
}

/** Reduced starts true: the screen's first input has reducedMotion true, so the first paint is the SVG twice over. */
export const INITIAL_RENDERER: Readonly<RendererState> = Object.freeze({ phase: "svg", reduced: true, skipped: false, failure: null });

export type RendererEvent =
  | { kind: "reduced"; value: boolean }
  | { kind: "probed"; ok: boolean }
  | { kind: "loaded" }
  | { kind: "sized" }
  | { kind: "ready" }
  | { kind: "failed"; reason: EngineFailure }
  | { kind: "fade-done" }
  | { kind: "lost" }
  | { kind: "restored" }
  | { kind: "one-shot"; skipped: boolean }
  | { kind: "stopped" };

/** The truth table's inputs, read off the phase and the failure. */
export function statusOf(s: RendererState): { gl: GlSupport; engine: EngineStatus } {
  return notPorted("statusOf", s);
}

/** Total: every pair not in the §4.2 table only records `reduced` or `skipped`. `stopped` returns to svg from any phase. */
export function rendererStep(s: RendererState, e: RendererEvent): RendererState {
  return notPorted("rendererStep", s, e);
}

/** True exactly in waiting, fading-in, three and fading-out: the phases where the engine's frames advance under the look. */
export function seesOneShots(s: RendererState): boolean {
  return notPorted("seesOneShots", s);
}

/** shown: opacity 1. leaving: fades 1 to 0 after a delay of one base duration. entering: the franki-fade keyframe, 0 to 1. */
export type SvgLayer = "shown" | "leaving" | "entering" | "absent";
/** hidden: mounted at opacity 0. entering: fades 0 to 1. */
export type CanvasLayer = "absent" | "hidden" | "entering" | "shown";
export type EngineAction = "none" | "probe" | "load" | "await-size" | "build" | "keep" | "dispose";
export type LoopView = "none" | "not-yet" | "runs" | "held" | "stopped";

export interface RendererView {
  svg: SvgLayer;
  canvas: CanvasLayer;
  engine: EngineAction;
  loop: LoopView;
}

/** The §4.2 view table. */
export function rendererView(s: RendererState): RendererView {
  return notPorted("rendererView", s);
}

/** The engine's loop: four independent closed facts and a counter. */
export interface LoopState {
  life: "building" | "live" | "failed" | "disposed";
  /** The host's hold. Starts held: the controller releases it when the view's loop is "runs". */
  hold: "run" | "hold";
  page: "visible" | "hidden";
  gl: "ok" | "lost";
  /** Frame errors in a row. */
  errors: number;
}

export const INITIAL_LOOP: Readonly<LoopState> = Object.freeze({ life: "building", hold: "hold", page: "visible", gl: "ok", errors: 0 });

export type LoopEvent = "built" | "hold" | "run" | "hide" | "show" | "lost" | "restored" | "frame-error" | "frame-ok" | "dispose";

export const FRAME_ERROR_LIMIT = 30;

/** "frame-ok" resets errors; errors reaching FRAME_ERROR_LIMIT set life "failed"; "dispose" is absorbing. */
export function loopStep(s: LoopState, e: LoopEvent): LoopState {
  return notPorted("loopStep", s, e);
}

/** life live, hold run, page visible and gl ok. */
export function loopRuns(s: LoopState): boolean {
  return notPorted("loopRuns", s);
}

function notPorted(name: string, ...inputs: unknown[]): never {
  throw new Error(`${name}: not ported yet (${inputs.length} inputs)`);
}
