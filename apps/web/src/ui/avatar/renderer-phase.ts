// The renderer phase machine and the three.js engine's loop machine (brief 013, design note
// docs/briefs/013-design.md §4 and §5.2). Pure. fallbackFor is the truth table; rendererStep moves the phase
// toward what it says, with the crossfades; rendererView says what to draw and do in each phase.

/** Why the engine is not showing. Engine errors carry one of these; `aborted` is a mount that went away, not a failure. */
export type EngineFailure = "no-webgl2" | "create" | "build" | "merge" | "shader" | "frames" | "aborted";

export type GlSupport = "unknown" | "webgl2" | "none";
export type EngineStatus = "absent" | "loading" | "building" | "ready" | "lost" | "failed";

/** The truth table of §4.1. Only webgl2 + ready + not reduced + no skipped one-shot shows three.js. */
export function fallbackFor(f: { gl: GlSupport; engine: EngineStatus; reducedMotion: boolean; oneShotSkipped: boolean }): "svg" | "three" {
  if (f.gl !== "webgl2") return "svg"; // the server render, the first paint, before the probe, or no WebGL 2
  if (f.engine !== "ready") return "svg"; // still loading or building, failed, or lost and not restored
  if (f.reducedMotion) return "svg"; // the engine is held, not disposed
  if (f.oneShotSkipped) return "svg"; // the look is a one-shot the engine did not see start
  return "three";
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
  switch (s.phase) {
    case "svg":
      return { gl: "unknown", engine: "absent" };
    case "loading":
    case "mounting":
      return { gl: "webgl2", engine: "loading" };
    case "building":
      return { gl: "webgl2", engine: "building" };
    case "waiting":
    case "fading-in":
    case "three":
    case "fading-out":
    case "held":
      return { gl: "webgl2", engine: "ready" };
    case "lost":
      return { gl: "webgl2", engine: "lost" };
    case "failed":
      return s.failure === "no-webgl2" ? { gl: "none", engine: "failed" } : { gl: "webgl2", engine: "failed" };
  }
}

/**
 * Records the one fact an event carries. While the canvas fades in, shows or fades out the engine sees every
 * one-shot start, so `skipped` stays false there (`oneShotStep` never sets it while running). In waiting it is
 * recorded: staying in the skipped one-shot keeps it true, and the SVG keeps showing.
 */
function record(s: RendererState, e: RendererEvent): RendererState {
  if (e.kind === "reduced") return { ...s, reduced: e.value };
  if (e.kind === "one-shot") return { ...s, skipped: s.phase === "fading-in" || s.phase === "three" || s.phase === "fading-out" ? false : e.skipped };
  return { ...s };
}

/**
 * Where a ready engine settles, taken from the truth table rather than restated: fading-in when it says three,
 * otherwise held under reduced motion, otherwise waiting for the skipped one-shot to end.
 */
function settled(s: RendererState): RendererState {
  const shows = fallbackFor({ gl: "webgl2", engine: "ready", reducedMotion: s.reduced, oneShotSkipped: s.skipped });
  return { ...s, phase: shows === "three" ? "fading-in" : s.reduced ? "held" : "waiting" };
}

/** The phases a failure can reach: every phase after the probe, and before failed itself. */
const CAN_FAIL: ReadonlySet<Phase> = new Set<Phase>(["loading", "mounting", "building", "waiting", "fading-in", "three", "fading-out", "held", "lost"]);
/** The phases with a ready engine whose context can be lost. A lost context while building is ignored here. */
const CAN_LOSE: ReadonlySet<Phase> = new Set<Phase>(["waiting", "fading-in", "three", "fading-out", "held"]);

/** Total: every pair not in the §4.2 table only records `reduced` or `skipped`. `stopped` returns to svg from any phase. */
export function rendererStep(s: RendererState, e: RendererEvent): RendererState {
  if (e.kind === "stopped") return { phase: "svg", reduced: s.reduced, skipped: false, failure: null };
  const r = record(s, e);
  if (s.phase === "failed") return r; // absorbing until stopped
  switch (e.kind) {
    case "probed":
      if (s.phase !== "svg") return r;
      if (!e.ok) return { ...r, phase: "failed", failure: "no-webgl2" };
      return r.reduced ? r : { ...r, phase: "loading" };
    case "loaded":
      return s.phase === "loading" ? { ...r, phase: "mounting" } : r;
    case "sized":
      // createEngine is called on this transition only.
      return s.phase === "mounting" ? { ...r, phase: "building" } : r;
    case "ready":
      return s.phase === "building" ? settled(r) : r;
    case "failed":
      return CAN_FAIL.has(s.phase) ? { ...r, phase: "failed", failure: e.reason } : r;
    case "lost":
      return CAN_LOSE.has(s.phase) ? { ...r, phase: "lost" } : r;
    case "restored":
      return s.phase === "lost" ? settled(r) : r;
    case "fade-done":
      if (s.phase === "fading-in") return { ...r, phase: "three" };
      if (s.phase === "fading-out") return settled(r);
      return r;
    case "one-shot":
      return s.phase === "waiting" && !r.skipped ? settled(r) : r;
    case "reduced":
      if (!e.value) return s.phase === "held" ? settled(r) : r;
      if (s.phase === "waiting" || s.phase === "fading-in") return { ...r, phase: "held" }; // from fading-in, a cut
      if (s.phase === "three") return { ...r, phase: "fading-out" };
      return r;
  }
}

/** True exactly in waiting, fading-in, three and fading-out: the phases where the engine's frames advance under the look. */
export function seesOneShots(s: RendererState): boolean {
  return s.phase === "waiting" || s.phase === "fading-in" || s.phase === "three" || s.phase === "fading-out";
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
  switch (s.phase) {
    case "svg":
      return { svg: "shown", canvas: "absent", engine: s.reduced ? "none" : "probe", loop: "none" };
    case "loading":
      return { svg: "shown", canvas: "absent", engine: "load", loop: "none" };
    case "mounting":
      // The canvas container is mounted at opacity 0, empty, waiting for a non-zero box.
      return { svg: "shown", canvas: "hidden", engine: "await-size", loop: "none" };
    case "building":
      return { svg: "shown", canvas: "hidden", engine: "build", loop: "not-yet" };
    case "waiting":
      return { svg: "shown", canvas: "hidden", engine: "keep", loop: "runs" };
    case "fading-in":
      return { svg: "leaving", canvas: "entering", engine: "keep", loop: "runs" };
    case "three":
      return { svg: "absent", canvas: "shown", engine: "keep", loop: "runs" };
    case "fading-out":
      return { svg: "entering", canvas: "shown", engine: "keep", loop: "runs" };
    case "held":
      return { svg: "shown", canvas: "hidden", engine: "keep", loop: "held" };
    case "lost":
      // A lost canvas is blank, and fading a blank canvas would be the flash: the SVG shows at once.
      return { svg: "shown", canvas: "hidden", engine: "keep", loop: "stopped" };
    case "failed":
      return { svg: "shown", canvas: "absent", engine: "dispose", loop: "none" };
  }
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
  if (s.life === "disposed") return { ...s };
  switch (e) {
    case "built":
      return { ...s, life: s.life === "building" ? "live" : s.life };
    case "hold":
      return { ...s, hold: "hold" };
    case "run":
      return { ...s, hold: "run" };
    case "hide":
      return { ...s, page: "hidden" };
    case "show":
      return { ...s, page: "visible" };
    case "lost":
      return { ...s, gl: "lost" };
    case "restored":
      return { ...s, gl: "ok" };
    case "frame-error": {
      // The counter stops at the limit, so the state space stays finite. A failed engine stays failed.
      const errors = Math.min(s.errors + 1, FRAME_ERROR_LIMIT);
      return { ...s, errors, life: errors >= FRAME_ERROR_LIMIT ? "failed" : s.life };
    }
    case "frame-ok":
      return { ...s, errors: 0 };
    case "dispose":
      return { ...s, life: "disposed" };
  }
}

/** life live, hold run, page visible and gl ok. */
export function loopRuns(s: LoopState): boolean {
  return s.life === "live" && s.hold === "run" && s.page === "visible" && s.gl === "ok";
}
