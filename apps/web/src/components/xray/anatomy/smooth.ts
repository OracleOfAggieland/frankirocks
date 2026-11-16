// Movement between tracker frames (brief 051 part C). Pure. The tracker answers 15 to 30 times a second and the
// screen draws at 60, so the bones ease toward the newest pose by time, not by frame count. A long frame (a slow
// device, a tab that was in the background) is capped, so nothing leaps. When a face or a hand is lost it fades out
// over FADE_SECONDS in place instead of vanishing. Every step lands exactly on its target once it is close enough
// that the difference can't be seen, so a still person gives a still picture.

/** A rotation as a unit quaternion, x, y, z, w (three.js order). */
export type Quat = readonly [number, number, number, number];

/** The longest frame, in seconds, that counts at its length; a longer one counts as this long. */
export const MAX_FRAME = 0.1;
/** How long a lost face or hand takes to fade out, and a found one to fade in, in seconds. */
export const FADE_SECONDS = 0.3;
/** Closer to its target than this, an eased number is put on it. Picture units and centimetres both: unseen. */
export const SNAP = 1e-6;

/** The frame's length as it counts: 0 for none, backwards or not a number, and at most MAX_FRAME. */
export function frameSeconds(dt: number): number {
  return dt > 0 ? Math.min(dt, MAX_FRAME) : 0;
}

/** The share of the way to its target an ease covers in `dt` seconds, with `halfLife` seconds to cover half. */
function share(dt: number, halfLife: number): number {
  const t = frameSeconds(dt);
  if (t === 0) return 0;
  if (!(halfLife > 0)) return 1;
  return 1 - Math.pow(2, -t / halfLife);
}

/** One step of `from` toward `to`. */
export function approach(from: number, to: number, dt: number, halfLife: number): number {
  const k = share(dt, halfLife);
  if (k === 0) return from;
  const next = from + (to - from) * k;
  if (Math.abs(to - next) <= SNAP) return to;
  // Rounding never carries a step past its target.
  return from <= to ? Math.min(Math.max(next, from), to) : Math.max(Math.min(next, from), to);
}

/** One step of a rotation toward another, along the shorter way round. */
export function approachQuat(from: Quat, to: Quat, dt: number, halfLife: number): Quat {
  const k = share(dt, halfLife);
  if (k === 0) return from;
  const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + from[3] * to[3];
  // q and -q are the same turn: ease toward whichever of them is nearer.
  const sign = dot < 0 ? -1 : 1;
  const out = [0, 1, 2, 3].map((i) => from[i]! + (sign * to[i]! - from[i]!) * k);
  const n = Math.hypot(out[0]!, out[1]!, out[2]!, out[3]!);
  const next: Quat = [out[0]! / n, out[1]! / n, out[2]! / n, out[3]! / n];
  const gap = Math.max(...[0, 1, 2, 3].map((i) => Math.abs(sign * to[i]! - next[i]!)));
  return gap <= SNAP ? to : next;
}

/** One step of a presence, 0 (gone) to 1 (shown), toward 1 while `present` and toward 0 after. */
export function fade(p: number, present: boolean, dt: number): number {
  const t = frameSeconds(dt);
  if (t === 0) return p;
  return Math.min(1, Math.max(0, p + (present ? t : -t) / FADE_SECONDS));
}
