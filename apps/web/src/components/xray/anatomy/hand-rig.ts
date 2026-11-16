// The bones of one hand, from its 21 tracked joints (brief 051 part C). Pure. MediaPipe's joints: 0 the wrist, 1 the
// thumb's base (its joint with the wrist bones), 2 to 4 up the thumb, then 5 to 8, 9 to 12, 13 to 16 and 17 to 20, a
// knuckle and three joints for each finger.
// One bone for each pair of joined joints, shaped like a bone: the thumb's three, three for each finger, and a palm
// bone (metacarpal) for each finger from the wrist bones to its knuckle. MediaPipe has no joint where a palm bone
// starts, so that end is put a set share of the way from the wrist to the knuckle (PALM_BASE). Eight small wrist
// bones sit between the wrist and those starts, and the two forearm bones leave the wrist away from the fingers.
// Everything is in hand space: picture heights, x across, y up, z toward the camera.
import type { XrayPoint } from "../../../ui/xray/types";
import { type BonePlace, MIN_BONE, type Vec3, placeBone } from "./bone-place";

export type BoneKind = "thumb" | "proximal" | "middle" | "distal" | "palm";

export interface HandBone {
  readonly kind: BoneKind;
  readonly place: BonePlace;
  /** The bone's width, hand space. */
  readonly thickness: number;
}

export interface WristBone {
  readonly at: Vec3;
  readonly radius: number;
}

export interface HandRig {
  readonly bones: readonly HandBone[];
  readonly wrist: readonly WristBone[];
  /** The radius (thumb side) and the ulna, each from near the wrist outward; they fade along their length. */
  readonly forearm: readonly HandBone[];
  /** The palm's width, the scale every bone's size is taken from. */
  readonly size: number;
  /** The turn of the palm: +y from the wrist toward the middle knuckle. */
  readonly palm: BonePlace;
}

/** How far from the wrist toward its knuckle a palm bone starts. */
export const PALM_BASE = 0.3;
/** How long the forearm bones are drawn, in palm widths, before they have faded out. */
export const FOREARM_LENGTH = 2.6;

/** Each bone's width, in palm widths. */
export const THICKNESS: Readonly<Record<BoneKind, number>> = { thumb: 0.2, proximal: 0.165, middle: 0.145, distal: 0.125, palm: 0.15 };

/** Joint pairs of the thumb and the fingers, with what kind of bone joins them. */
export const FINGER_BONES: readonly (readonly [number, number, BoneKind])[] = [
  [1, 2, "thumb"], [2, 3, "thumb"], [3, 4, "thumb"],
  [5, 6, "proximal"], [6, 7, "middle"], [7, 8, "distal"],
  [9, 10, "proximal"], [10, 11, "middle"], [11, 12, "distal"],
  [13, 14, "proximal"], [14, 15, "middle"], [15, 16, "distal"],
  [17, 18, "proximal"], [18, 19, "middle"], [19, 20, "distal"],
];
/** The knuckles each palm bone ends at. */
export const KNUCKLES = [5, 9, 13, 17] as const;

/** A tracked point in hand space. z is in picture widths, so it is turned into picture heights with the aspect. */
export function handSpace(p: XrayPoint, aspect: number): Vec3 {
  return { x: (p.x - 0.5) * aspect, y: 0.5 - p.y, z: -p.z * aspect };
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3, fallback: Vec3): Vec3 => {
  const n = len(a);
  return n > MIN_BONE && Number.isFinite(n) ? scale(a, 1 / n) : fallback;
};

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const finite = (v: Vec3): Vec3 => (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? v : ZERO);

/** The hand's bones from its joints in hand space. Fewer than 21 joints, and the missing ones sit at the wrist. */
export function handRig(points: readonly Vec3[]): HandRig {
  const wristAt = finite(points[0] ?? ZERO);
  const j = (i: number) => finite(points[i] ?? wristAt);
  const w = j(0);
  // The palm's width, kept from collapsing when the hand is seen edge on.
  const size = Math.max(len(sub(j(5), j(17))), 0.55 * len(sub(j(9), w)), 1e-6);
  const bones: HandBone[] = FINGER_BONES.map(([a, b, kind]) => ({ kind, place: placeBone(j(a), j(b)), thickness: THICKNESS[kind] * size }));
  const bases = KNUCKLES.map((k) => lerp(w, j(k), PALM_BASE));
  KNUCKLES.forEach((k, i) => bones.push({ kind: "palm", place: placeBone(bases[i]!, j(k)), thickness: THICKNESS.palm * size }));

  const [b5, b9, b13, b17] = bases as [Vec3, Vec3, Vec3, Vec3];
  const thumbBase = j(1);
  const across = unit(sub(j(5), j(17)), { x: 1, y: 0, z: 0 });
  const r = (k: number) => k * size;
  const wrist: WristBone[] = [
    { at: lerp(lerp(thumbBase, b5, 0.45), w, 0.12), radius: r(0.085) }, // trapezium
    { at: lerp(b5, w, 0.3), radius: r(0.07) }, // trapezoid
    { at: lerp(b9, w, 0.38), radius: r(0.095) }, // capitate
    { at: lerp(lerp(b13, b17, 0.5), w, 0.3), radius: r(0.085) }, // hamate
    { at: lerp(w, lerp(thumbBase, b5, 0.5), 0.42), radius: r(0.08) }, // scaphoid
    { at: lerp(w, b9, 0.26), radius: r(0.075) }, // lunate
    { at: lerp(w, b17, 0.36), radius: r(0.07) }, // triquetrum
    { at: add(lerp(w, b17, 0.28), scale(across, -r(0.08))), radius: r(0.045) }, // pisiform
  ];

  // Away from the fingers: from the middle knuckle through the wrist, and on past it.
  const out = unit(sub(w, j(9)), { x: 0, y: -1, z: 0 });
  const radiusStart = add(add(w, scale(across, r(0.2))), scale(out, r(0.12)));
  const ulnaStart = add(add(w, scale(across, -r(0.2))), scale(out, r(0.1)));
  const forearm: HandBone[] = [
    { kind: "palm", place: placeBone(radiusStart, add(radiusStart, scale(out, r(FOREARM_LENGTH)))), thickness: r(0.24) },
    { kind: "palm", place: placeBone(ulnaStart, add(ulnaStart, scale(out, r(FOREARM_LENGTH * 1.05)))), thickness: r(0.2) },
  ];
  return { bones, wrist, forearm, size, palm: placeBone(w, j(9)) };
}
