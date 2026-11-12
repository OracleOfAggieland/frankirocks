// The lab spider's body plan and leg solve. Pure: no browser globals, no random source.
// Coordinates are CSS pixels, y down. Angles are radians, measured from +x toward +y (clockwise on screen).
// A heading of 0 points the spider's head toward +x. Legs 0 to 3 are L1 to L4, legs 4 to 7 are R1 to R4.

export interface Vec {
  readonly x: number;
  readonly y: number;
}

/** The two bones of every leg, hip to knee and knee to foot. */
export const UPPER = 7;
export const LOWER = 9;
/** Furthest a foot can be from its hip, with the leg straight. */
export const REACH = UPPER + LOWER;
/** Nearest a foot can be from its hip, with the leg folded flat. */
export const MIN_REACH = LOWER - UPPER;

/** Hips sit on the head, this far from its centre (the hot spot). */
export const HIP_RADIUS = 2.2;
/** Each hip's angle from the heading, front to back, mirrored on the right. */
export const HIP_ANGLE_DEG = [30, 65, 105, 140] as const;
/** Each rest foot's angle from the heading (brief: about 35, 70, 110 and 145 degrees). */
export const REST_ANGLE_DEG = [35, 70, 110, 145] as const;
/** Each rest foot's distance from the head centre (brief: 13 to 15 px). Leg III is the shortest, as on a real spider. */
export const REST_DISTANCE = [14.5, 14, 13, 15] as const;

/** The body, in the body frame (head toward +x). */
export const BODY = {
  headR: 3.2,
  /** The abdomen's half-length along the body and half-width across it. */
  abdomenRx: 5.6,
  abdomenRy: 4.6,
  /** The abdomen's centre sits this far behind the head centre; its front tucks under the head. */
  abdomenBack: 6.4,
  eyeR: 0.8,
  eyeForward: 1.5,
  eyeApart: 1.15,
} as const;

export const LEGS = 8;

export const DEG = Math.PI / 180;

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpVec = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const polar = (r: number, angle: number): Vec => ({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** An angle wrapped into (-PI, PI]: applied to `b - a`, the shortest signed turn from `a` to `b`. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  else if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/** 0 for the left side, 1 for the right side. */
export const sideOf = (leg: number): 0 | 1 => (leg < 4 ? 0 : 1);
/** 0 for the front pair, 3 for the back pair. */
export const pairOf = (leg: number): number => leg % 4;
/** Left legs sit counter-clockwise of the heading (negative angles, y down), right legs clockwise. */
const sideSign = (leg: number): number => (sideOf(leg) === 0 ? -1 : 1);

/** A leg's angle from the body axis for a per-pair table, as a world angle at this heading. */
export function legAngle(leg: number, heading: number, table: readonly number[]): number {
  return heading + sideSign(leg) * table[pairOf(leg)] * DEG;
}

/** A hip, relative to the head centre. */
export function hipOffset(leg: number, heading: number, bodyScale = 1): Vec {
  return polar(HIP_RADIUS * bodyScale, legAngle(leg, heading, HIP_ANGLE_DEG));
}

/** A rest foot, relative to the head centre. */
export function restOffset(leg: number, heading: number): Vec {
  return polar(REST_DISTANCE[pairOf(leg)], legAngle(leg, heading, REST_ANGLE_DEG));
}

export interface LegSolve {
  readonly knee: Vec;
  /** Where the foot is drawn: the asked-for foot, pulled into reach if it was out of reach. */
  readonly foot: Vec;
}

/**
 * Which way a leg's knee turns from the hip-to-foot line: +1 clockwise, -1 counter-clockwise.
 * Fixed per leg, so a knee never flips sides mid-stride. Front legs (I, II) turn toward the side,
 * back legs (III, IV) turn the other way, which also points toward the side: the knee bends up and out.
 */
export const kneeBend = (leg: number): number => sideSign(leg) * (pairOf(leg) < 2 ? 1 : -1);

/**
 * The two-bone solve. The knee bends out to this leg's fixed side (see `kneeBend`), as a spider's
 * knees rise up and out. A foot out of reach is drawn at the nearest point in reach.
 */
export function solveLeg(hip: Vec, foot: Vec, heading: number, leg: number): LegSolve {
  const toFoot = sub(foot, hip);
  const raw = len(toFoot);
  const d = clamp(raw, MIN_REACH + 1e-3, REACH - 1e-3);
  const base = raw > 1e-9 ? Math.atan2(toFoot.y, toFoot.x) : legAngle(leg, heading, REST_ANGLE_DEG);
  const cosA = clamp((UPPER * UPPER + d * d - LOWER * LOWER) / (2 * UPPER * d), -1, 1);
  const a = Math.acos(cosA);
  const knee = add(hip, polar(UPPER, base + kneeBend(leg) * a));
  const drawn = add(hip, polar(d, base));
  return { knee, foot: drawn };
}

/** Pulls a point to within [MIN_REACH, REACH] of `hip`, keeping its direction. */
export function clampToReach(hip: Vec, p: Vec, leg: number, heading: number): Vec {
  const r = sub(p, hip);
  const d = len(r);
  if (d >= MIN_REACH && d <= REACH) return p;
  if (d < 1e-9) return add(hip, polar(MIN_REACH, legAngle(leg, heading, REST_ANGLE_DEG)));
  return add(hip, scale(r, clamp(d, MIN_REACH, REACH) / d));
}
