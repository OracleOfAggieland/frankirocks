// Pinning the skull to the face (brief 051 part C). Pure. XrayFace.matrix places the canonical head in front of a
// camera XRAY_CAMERA_FOV degrees tall at the picture's aspect, which gets the skull's turn and depth right. What is
// left over shows on the screen as a small slip or a size a little off, so the skull's own key points are projected,
// compared with the same landmarks the tracker found, and the least-squares scale and shift that lines them up is
// applied on the picture, clamped so a bad frame can't throw the skull across the screen.
// Measured in picture units with x stretched by the aspect, so a step across and a step down are the same length.
import { XRAY_CAMERA_FOV, type XrayFace } from "../../../ui/xray/types";
import type { Vec3 } from "./bone-place";
import { CANONICAL, FIT_POINTS, LANDMARK } from "./canonical";
import type { Point2 } from "./screen-map";

/** p' = s p + t, about the picture's top left, with x in units of the picture's height. */
export interface FitCorrection {
  readonly s: number;
  readonly tx: number;
  readonly ty: number;
}

export interface Pair {
  /** Where the skull's key point projects. */
  readonly from: Point2;
  /** Where the tracker found the same landmark. */
  readonly to: Point2;
}

export const IDENTITY_FIT: FitCorrection = { s: 1, tx: 0, ty: 0 };
/** The correction never scales by more than this, up or down. */
export const FIT_SCALE_LIMIT = 1.25;
/** Nor moves the middle of the skull's key points by more than this, in picture heights, on either axis. */
export const FIT_SHIFT_LIMIT = 0.15;

/** Fewer good pairs than this, and the correction is none. */
export const FIT_MIN_POINTS = 3;
/** Points bunched tighter than this (mean squared distance from their middle, picture heights) give no scale. */
export const FIT_MIN_SPREAD = 1e-6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finitePoint = (p: Point2) => Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * The least-squares scale and shift that takes each pair's `from` onto its `to`, then clamped: the scale first, the
 * shift refound for the clamped scale, then the shift. Pairs with a point that is not a number are left out; too few,
 * or too bunched, or a picture with no good aspect, and the answer is IDENTITY_FIT.
 */
export function fitCorrection(all: readonly Pair[], aspect: number): FitCorrection {
  if (!(Number.isFinite(aspect) && aspect > 0)) return IDENTITY_FIT;
  // Points far off the picture are not a face's: the clamp below couldn't make use of them anyway.
  const pairs = all.filter((p) => finitePoint(p.from) && finitePoint(p.to) && [p.from.x, p.from.y, p.to.x, p.to.y].every((v) => Math.abs(v) < 1e3));
  const n = pairs.length;
  if (n < FIT_MIN_POINTS) return IDENTITY_FIT;
  let fx = 0;
  let fy = 0;
  let tx = 0;
  let ty = 0;
  for (const { from, to } of pairs) {
    fx += from.x * aspect;
    fy += from.y;
    tx += to.x * aspect;
    ty += to.y;
  }
  fx /= n;
  fy /= n;
  tx /= n;
  ty /= n;
  let num = 0;
  let den = 0;
  for (const { from, to } of pairs) {
    const ax = from.x * aspect - fx;
    const ay = from.y - fy;
    num += ax * (to.x * aspect - tx) + ay * (to.y - ty);
    den += ax * ax + ay * ay;
  }
  if (!(den / n > FIT_MIN_SPREAD) || !Number.isFinite(num)) return IDENTITY_FIT;
  const s = clamp(num / den, 1 / FIT_SCALE_LIMIT, FIT_SCALE_LIMIT);
  // The scale is about the projected points' middle, and the slip is how far that middle moves.
  const slipX = clamp(tx - fx, -FIT_SHIFT_LIMIT, FIT_SHIFT_LIMIT);
  const slipY = clamp(ty - fy, -FIT_SHIFT_LIMIT, FIT_SHIFT_LIMIT);
  return { s, tx: fx + slipX - s * fx, ty: fy + slipY - s * fy };
}

/** A picture point (0 to 1) under the correction. */
export function correctPoint(c: FitCorrection, aspect: number, p: Point2): Point2 {
  return { x: (c.s * p.x * aspect + c.tx) / aspect, y: c.s * p.y + c.ty };
}

/** The same on the picture's normalised device coordinates: ndc' = s ndc + o, per axis. */
export function correctionNdc(c: FitCorrection, aspect: number): { sx: number; sy: number; ox: number; oy: number } {
  return { sx: c.s, sy: c.s, ox: c.s - 1 + (2 * c.tx) / aspect, oy: 1 - c.s - 2 * c.ty };
}

/** Where a canonical point lands on the picture under `matrix` (column by column), or null behind the camera. */
export function projectHead(matrix: readonly number[], aspect: number, p: Vec3): Point2 | null {
  const m = matrix;
  const cx = m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!;
  const cy = m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!;
  const cz = m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!;
  const f = 1 / Math.tan((XRAY_CAMERA_FOV * Math.PI) / 360);
  return { x: ((f / aspect) * (cx / -cz) + 1) / 2, y: (1 - f * (cy / -cz)) / 2 };
}

/** The correction for one tracked face: FIT_POINTS projected through its matrix, against its own landmarks. */
export function faceCorrection(face: XrayFace, aspect: number): FitCorrection {
  const pairs: Pair[] = [];
  for (const name of FIT_POINTS) {
    const from = projectHead(face.matrix, aspect, CANONICAL[name]);
    const to = face.points[LANDMARK[name]];
    if (from !== null && to !== undefined) pairs.push({ from, to: { x: to.x, y: to.y } });
  }
  return fitCorrection(pairs, aspect);
}
