// How the radio globe turns, as plain numbers: no three.js, no clock, no randomness (brief 047 part C). The engine
// steps this once a frame with the frame's own time step, and turns the globe by the result. Angles are radians,
// times seconds, distances CSS pixels.
//
// The convention every part of the globe shares: latitude 0, longitude 0 faces +Z, north is +Y, and east is to the
// right as seen from outside (+X at longitude 90). The globe is turned by `yaw` about Y first, then by `pitch` about
// X, so yaw = -longitude brings a meridian to the front and pitch = latitude brings a parallel to the centre.
import type { RadioSignal } from "../../../ui/radio/types";

export interface EaseTarget {
  readonly yaw: number;
  readonly pitch: number;
}

export interface GlobeMotion {
  /** Normalised to [-pi, pi). */
  readonly yaw: number;
  /** Within ±PITCH_LIMIT. */
  readonly pitch: number;
  /** Radians a second, while coasting after a release. */
  readonly vYaw: number;
  readonly vPitch: number;
  /** Where an ease is heading, or null. */
  readonly target: EaseTarget | null;
  /** True while a pointer holds the globe. */
  readonly held: boolean;
}

export const DEG = Math.PI / 180;
/** The poles never come further round than this, so the globe never flips. */
export const PITCH_LIMIT = 70 * DEG;
/** At rest the globe leans toward the viewer a little, so the northern hemisphere is favoured. */
export const REST_PITCH = 20 * DEG;
/** A faced station ends this far above the centre of view. */
export const FACE_ABOVE = 8 * DEG;
/** Radians turned by a drag across the canvas's full width. */
export const DRAG_GAIN = 2.4;
/** The fastest a release can set the globe spinning, radians a second. */
export const MAX_SPIN = 8;
/** How quickly a coast dies away, per second. */
export const FRICTION = 3.2;
/** A coast slower than this stops. */
const COAST_STOP = 0.01;
/** The slow turn while nothing is tuned and nobody is touching it, radians a second. */
export const IDLE_SPIN = 0.12;
/** The ease's rate, per second, and the least speed it moves at, so it arrives and does not creep. */
const EASE_RATE = 5;
const EASE_MIN_SPEED = 0.05;
/** An ease this close to its target lands on it exactly. */
const EASE_SNAP = 5e-4;
/** The longest step taken at once; a longer frame is cut into steps this size. */
export const MAX_STEP = 1 / 60;
/** A frame longer than this (a hidden tab coming back) counts as this long. */
export const MAX_FRAME = 0.25;

export const INITIAL_GLOBE: GlobeMotion = Object.freeze({ yaw: 0, pitch: REST_PITCH, vYaw: 0, vPitch: 0, target: null, held: false });

const TAU = 2 * Math.PI;

/** Any angle into [-pi, pi). A non-finite angle reads as 0. */
export function normYaw(a: number): number {
  if (!Number.isFinite(a)) return 0;
  let r = a - TAU * Math.floor((a + Math.PI) / TAU);
  if (r >= Math.PI) r -= TAU;
  if (r < -Math.PI) r += TAU;
  return r;
}

export const clampPitch = (p: number): number => (Number.isFinite(p) ? Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, p)) : 0);

/** A point on the unit sphere for a latitude and longitude in degrees, by the convention above. */
export function latLonToVec(lat: number, lon: number): [number, number, number] {
  const phi = lat * DEG;
  const lam = lon * DEG;
  return [Math.cos(phi) * Math.sin(lam), Math.sin(phi), Math.cos(phi) * Math.cos(lam)];
}

/** The yaw and pitch that bring a station to the front, a little above centre. */
export function faceTarget(lat: number, lon: number): EaseTarget {
  return { yaw: normYaw(-lon * DEG), pitch: clampPitch((lat * DEG) - FACE_ABOVE) };
}

/** A pointer moved by (dx, dy) pixels on a canvas `size` pixels wide. It holds the globe and ends any ease. */
export function dragBy(m: GlobeMotion, dx: number, dy: number, size: number): GlobeMotion {
  if (!(size > 0) || !Number.isFinite(size)) return { ...m, held: true, target: null, vYaw: 0, vPitch: 0 };
  const k = DRAG_GAIN / size;
  const ddx = Number.isFinite(dx) ? dx : 0;
  const ddy = Number.isFinite(dy) ? dy : 0;
  return { yaw: normYaw(m.yaw + ddx * k), pitch: clampPitch(m.pitch + ddy * k), vYaw: 0, vPitch: 0, target: null, held: true };
}

const capSpin = (v: number) => (Number.isFinite(v) ? Math.min(MAX_SPIN, Math.max(-MAX_SPIN, v)) : 0);

/** The pointer let go, moving at (vx, vy) pixels a second. The globe coasts on, except under `still`. */
export function release(m: GlobeMotion, vx: number, vy: number, size: number, opts: { still: boolean }): GlobeMotion {
  if (opts.still || !(size > 0) || !Number.isFinite(size)) return { ...m, held: false, vYaw: 0, vPitch: 0 };
  const k = DRAG_GAIN / size;
  return { ...m, held: false, vYaw: capSpin(vx * k), vPitch: capSpin(vy * k) };
}

/** Turn to face a station: an ease the shortest way round, or under `still` a jump. */
export function faceStation(m: GlobeMotion, lat: number, lon: number, opts: { still: boolean }): GlobeMotion {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return m;
  const target = faceTarget(lat, lon);
  if (opts.still) return { yaw: target.yaw, pitch: target.pitch, vYaw: 0, vPitch: 0, target: null, held: false };
  return { ...m, vYaw: 0, vPitch: 0, target, held: false };
}

function approach(delta: number, dt: number): number {
  const move = Math.max(Math.abs(delta) * (1 - Math.exp(-EASE_RATE * dt)), EASE_MIN_SPEED * dt);
  return Math.abs(delta) <= move ? delta : Math.sign(delta) * move;
}

function one(m: GlobeMotion, dt: number, idleSpin: boolean): GlobeMotion {
  if (m.target !== null) {
    const dy = normYaw(m.target.yaw - m.yaw);
    const dp = m.target.pitch - m.pitch;
    const yaw = normYaw(m.yaw + approach(dy, dt));
    const pitch = clampPitch(m.pitch + approach(dp, dt));
    const left = Math.max(Math.abs(normYaw(m.target.yaw - yaw)), Math.abs(m.target.pitch - pitch));
    if (left <= EASE_SNAP) return { yaw: m.target.yaw, pitch: m.target.pitch, vYaw: 0, vPitch: 0, target: null, held: m.held };
    return { ...m, yaw, pitch };
  }
  if (m.held) return m;
  const fade = Math.exp(-FRICTION * dt);
  let vYaw = m.vYaw * fade;
  let vPitch = m.vPitch * fade;
  if (Math.abs(vYaw) < COAST_STOP) vYaw = 0;
  if (Math.abs(vPitch) < COAST_STOP) vPitch = 0;
  const spin = idleSpin ? IDLE_SPIN : 0;
  const yaw = normYaw(m.yaw + (m.vYaw + spin) * dt);
  const rawPitch = m.pitch + m.vPitch * dt;
  const pitch = clampPitch(rawPitch);
  if (pitch !== rawPitch) vPitch = 0;
  if (yaw === m.yaw && pitch === m.pitch && vYaw === m.vYaw && vPitch === m.vPitch) return m;
  return { ...m, yaw, pitch, vYaw, vPitch };
}

/**
 * The globe `dt` seconds later. `idleSpin` is true when nothing is tuned: then, with nothing held and no ease
 * running, it turns slowly. Under `still` nothing changes at all. Any `dt` is safe: negative reads as 0, a long frame
 * is capped at MAX_FRAME and cut into steps of MAX_STEP.
 */
export function stepGlobe(m: GlobeMotion, dt: number, opts: { idleSpin: boolean; still: boolean }): GlobeMotion {
  if (opts.still) return m;
  let left = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), MAX_FRAME) : 0;
  let next = m;
  while (left > 1e-9) {
    const step = Math.min(left, MAX_STEP);
    next = one(next, step, opts.idleSpin && !next.held && next.target === null);
    left -= step;
  }
  return next;
}

/** True when a step would change nothing: no ease, no coast, no spin. The wrapper can then skip drawing. */
export function globeAtRest(m: GlobeMotion, idleSpin: boolean): boolean {
  return m.target === null && m.vYaw === 0 && m.vPitch === 0 && (m.held || !idleSpin);
}

/* ---------------------------------------------------------------- the tuned station's marker */

export type MarkerTone = "live" | "tuning" | "waiting" | "ember";

export interface MarkerRing {
  /** Radius on the globe's surface, in globe radii. */
  readonly radius: number;
  readonly opacity: number;
}

export interface MarkerLook {
  readonly tone: MarkerTone;
  /** 0 to 1: the marker's brightness. */
  readonly level: number;
  /** The rings it sends out, every one of them, faded to 0 when not playing. */
  readonly rings: readonly MarkerRing[];
}

export const MARKER_RINGS = 3;
/** One ring's travel from the marker to its widest, seconds. */
export const RING_SECONDS = 2.1;
export const RING_FROM = 0.035;
export const RING_TO = 0.17;
/** Where the rings rest under `still`: spread through their travel, so the still frame reads as rings going out. */
const STILL_RING_T = 0.7;

const toneOf = (signal: RadioSignal): MarkerTone =>
  signal === "playing" ? "live" : signal === "tuning" ? "tuning" : signal === "noSignal" ? "ember" : "waiting";

/** How the tuned marker looks `t` seconds into a signal. Pure: the same inputs give the same look. */
export function markerLook(signal: RadioSignal, t: number, still: boolean): MarkerLook {
  const tone = toneOf(signal);
  const at = still ? STILL_RING_T : Number.isFinite(t) ? Math.max(0, t) : 0;
  const rings: MarkerRing[] = [];
  for (let i = 0; i < MARKER_RINGS; i++) {
    const p = (at / RING_SECONDS + i / MARKER_RINGS) % 1;
    rings.push({ radius: RING_FROM + (RING_TO - RING_FROM) * p, opacity: tone === "live" ? 0.85 * (1 - p) ** 1.5 : 0 });
  }
  let level = 1;
  if (tone === "tuning" && !still) {
    // A flicker: two fast sines that never quite agree, never fully dark.
    const f = 0.5 + 0.25 * Math.sin(at * 23) + 0.25 * Math.sin(at * 37 + 1.3);
    level = 0.35 + 0.65 * f;
  } else if (tone === "tuning") level = 0.75;
  else if (tone === "waiting") level = still ? 0.8 : 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(at * 2.4));
  return { tone, level, rings };
}
