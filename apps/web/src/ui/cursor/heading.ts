// The lab spider's sense of travel: a lightly smoothed velocity and a heading that follows it. Pure.
// Times are Frame_Time milliseconds; speeds are px per ms.
import { type Vec, wrapAngle } from "./geometry";

/** The heading follows the direction of travel through a low-pass of this time constant. */
export const HEADING_TAU_MS = 90;
/** The velocity is smoothed this lightly, so one uneven frame doesn't jerk the legs. */
export const VELOCITY_TAU_MS = 40;
/** Below this speed the pointer is nearly still and the heading holds. */
export const HOLD_SPEED = 0.05;
/** Frames longer than this are treated as this long, so a stalled frame doesn't throw the filters. */
export const MAX_DT_MS = 64;
/** Where the spider faces before it has moved: up, like the pointer it replaces. */
export const START_HEADING = -Math.PI / 2;

/** The share of the way a first-order low-pass moves toward its input in `dt`. */
export function lowPassShare(dt: number, tau: number): number {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-dt / tau);
}

/** Smooths the velocity toward the raw displacement over `dt`. */
export function nextVelocity(v: Vec, delta: Vec, dt: number): Vec {
  if (dt <= 0) return v;
  const k = lowPassShare(dt, VELOCITY_TAU_MS);
  return { x: v.x + (delta.x / dt - v.x) * k, y: v.y + (delta.y / dt - v.y) * k };
}

/** Turns the heading toward the direction of `v` along the shortest arc, or holds it when nearly still. */
export function nextHeading(heading: number, v: Vec, dt: number): number {
  if (Math.hypot(v.x, v.y) < HOLD_SPEED) return heading;
  const target = Math.atan2(v.y, v.x);
  return wrapAngle(heading + wrapAngle(target - heading) * lowPassShare(dt, HEADING_TAU_MS));
}
