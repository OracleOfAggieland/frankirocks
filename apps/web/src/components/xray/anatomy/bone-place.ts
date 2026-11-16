// Where one bone goes (brief 051 part C). Pure. Every bone mesh is built standing on its own +y axis from 0 to 1;
// placing it from joint a to joint b is a start, a turn that takes +y onto the line from a to b, and a length. Two
// joints in the same place give a bone of length 0 standing straight up: never a NaN.
import type { Quat } from "./smooth";

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BonePlace {
  /** The bone's start: joint a. */
  readonly origin: Vec3;
  /** A unit vector from a toward b. */
  readonly dir: Vec3;
  /** From a to b. */
  readonly length: number;
  /** The turn that takes +y onto `dir`. */
  readonly quat: Quat;
}

export function placeBone(a: Vec3, b: Vec3): BonePlace {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > MIN_BONE)) return { origin: a, dir: UP, length: Number.isFinite(length) ? length : 0, quat: [0, 0, 0, 1] };
  const dir = { x: dx / length, y: dy / length, z: dz / length };
  // The turn about the axis up × dir = (dir.z, 0, -dir.x), by the angle between them. atan2 keeps it exact straight
  // down, where the half-angle formula divides by nothing.
  const across = Math.hypot(dir.x, dir.z);
  const angle = Math.atan2(across, dir.y);
  const ax = across > 0 ? dir.z / across : 1;
  const az = across > 0 ? -dir.x / across : 0;
  const s = Math.sin(angle / 2);
  return { origin: a, dir, length, quat: [ax * s, 0, az * s, Math.cos(angle / 2)] };
}

/** Joints closer together than this make a bone of that length standing straight up. */
export const MIN_BONE = 1e-10;
const UP: Vec3 = { x: 0, y: 1, z: 0 };

/** Turns (0, 1, 0) by `q`. */
export function turnUp(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  return { x: 2 * (x * y - w * z), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + w * x) };
}
