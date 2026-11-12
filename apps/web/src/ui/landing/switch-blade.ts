// The knife switch's blade at the foot of the front door (brief 015, package I). Pure: the angle a pointer
// puts the blade at, the halfway decision on release, and a spring step that settles on its target without
// passing it. Angles are degrees from straight up, positive toward the open side; 0 is closed (in the clips).
import { SPRING, type Spring } from "../motion";

export interface Point {
  x: number;
  y: number;
}

/** Where the blade rests, open. */
export const OPEN_DEG = 38;
/** Past this, toward closed, letting go throws the switch. */
export const HALF_DEG = OPEN_DEG / 2;
/** How far the blade leans toward the clips while the pointer is over the switch or it has focus. */
export const NUDGE_DEG = 4;
/** A press that travels farther than this, in CSS pixels, is a drag and not a click. */
export const DRAG_SLOP_PX = 4;
/** The longest step the spring takes in one frame, so a stalled tab does not fling the blade. */
export const MAX_FRAME_MS = 64;
/** Integration sub-step, for a stable spring at any frame rate. */
const SUB_MS = 4;
/** Below these the blade counts as at rest on its target. */
const REST_DEG = 0.05;
const REST_DEG_PER_S = 0.5;

/** Keeps an angle between closed and open. Not a number counts as open. */
export function clampAngle(deg: number): number {
  if (!Number.isFinite(deg)) return OPEN_DEG;
  return Math.min(OPEN_DEG, Math.max(0, deg));
}

/**
 * The angle of the line from `pivot` to `pointer`, in degrees from straight up, positive clockwise (toward
 * +x on a y-down screen). In (-180, 180]. A pointer exactly on the pivot reads as straight up.
 */
export function angleFromPointer(pivot: Point, pointer: Point): number {
  const dx = pointer.x - pivot.x;
  const dy = pivot.y - pointer.y;
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/**
 * Where a drag puts the blade: the pointer's angle less the offset taken when the handle was grabbed (so the
 * blade does not jump to the pointer), held between closed and open. A pointer below the pivot's line, on
 * either side, holds the blade at the nearer end instead of flipping it.
 */
export function dragAngle(pivot: Point, pointer: Point, grab: number): number {
  const raw = angleFromPointer(pivot, pointer);
  if (raw > 90) return OPEN_DEG;
  if (raw < -90) return 0;
  return clampAngle(raw - grab);
}

/** The grab offset for a press at `pointer` while the blade stands at `angle`. */
export function grabOffset(pivot: Point, pointer: Point, angle: number): number {
  return angleFromPointer(pivot, pointer) - clampAngle(angle);
}

/** Letting go: past halfway toward the clips throws the switch (0); otherwise it settles back open. */
export function releaseTarget(angle: number): 0 | typeof OPEN_DEG {
  return clampAngle(angle) < HALF_DEG ? 0 : OPEN_DEG;
}

/** True once a press has travelled far enough to count as a drag. */
export function isDrag(start: Point, now: Point): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) > DRAG_SLOP_PX;
}

export interface BladeState {
  /** Degrees. */
  angle: number;
  /** Degrees per second. */
  velocity: number;
}

export interface BladeStep extends BladeState {
  /** True when the blade has reached its target and stopped. */
  done: boolean;
}

/**
 * Advances the blade toward `target` on a spring for `dtMs` of frame time (clamped to MAX_FRAME_MS). The
 * blade never passes its target: the step that would cross it lands on it and stops, so the switch meets
 * the clips, or settles open, without overshoot. Stays between closed and open.
 */
export function stepBlade(state: BladeState, target: number, spring: Spring, dtMs: number): BladeStep {
  const goal = clampAngle(target);
  let angle = clampAngle(state.angle);
  let velocity = Number.isFinite(state.velocity) ? state.velocity : 0;
  let left = Math.min(MAX_FRAME_MS, Math.max(0, Number.isFinite(dtMs) ? dtMs : 0));
  if (angle === goal && Math.abs(velocity) < REST_DEG_PER_S) return { angle, velocity: 0, done: true };
  while (left > 0) {
    const h = Math.min(SUB_MS, left) / 1000;
    left -= SUB_MS;
    const accel = -spring.stiffness * (angle - goal) - spring.damping * velocity;
    velocity += accel * h;
    const next = angle + velocity * h;
    if ((angle - goal) * (next - goal) <= 0) return { angle: goal, velocity: 0, done: true };
    angle = clampAngle(next);
  }
  if (Math.abs(angle - goal) < REST_DEG && Math.abs(velocity) < REST_DEG_PER_S) return { angle: goal, velocity: 0, done: true };
  return { angle, velocity, done: false };
}

/** The spring for each move: the throw snaps shut on `press`; everything else settles. */
export const BLADE_SPRING = { throw: SPRING.press, settle: SPRING.settle } as const;

/**
 * Maps a client point into an SVG's viewBox, for an SVG drawn with the default `xMidYMid meet` inside
 * `rect`. A zero-size rect maps everything to the viewBox's origin.
 */
export function toViewBox(rect: { left: number; top: number; width: number; height: number }, view: { x: number; y: number; width: number; height: number }, client: Point): Point {
  const scale = Math.min(rect.width / view.width, rect.height / view.height);
  if (!(scale > 0)) return { x: view.x, y: view.y };
  const offX = (rect.width - view.width * scale) / 2;
  const offY = (rect.height - view.height * scale) / 2;
  return { x: view.x + (client.x - rect.left - offX) / scale, y: view.y + (client.y - rect.top - offY) / scale };
}

/** The point `distance` along the blade from `pivot` at `angle` degrees. */
export function alongBlade(pivot: Point, angle: number, distance: number): Point {
  const r = (angle * Math.PI) / 180;
  return { x: pivot.x + Math.sin(r) * distance, y: pivot.y - Math.cos(r) * distance };
}
