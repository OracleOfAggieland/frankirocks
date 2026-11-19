// How the three.js wall phone moves, as plain numbers: no three.js, no clock, no randomness. The engine steps this
// once a frame with the frame's own time step and poses the model from the result, so every number here can be
// tested in node. Times are seconds, angles are radians.
//
// The phone floats beside Franki while a call is out, rising and falling slowly on its own, and never reaches him:
// while the line is open the handset lifts a little off its cradle and hovers in front of the phone.
import type { MissReason, PhonePhase } from "../../../ui/phone/phone-call";

export type ShownPhase = Exclude<PhonePhase, "absent">;

export interface ShownView {
  readonly phase: ShownPhase;
  readonly reason: MissReason | null;
}

export type LampKind = "off" | "live" | "missed";

export interface PhoneMotion {
  readonly phase: ShownPhase;
  /** Seconds in this phase. */
  readonly t: number;
  /** Seconds since the phone appeared, whatever the phase: the float's clock, so a change of phase never jolts it. */
  readonly age: number;
  /** 0 as the phone arrives, 1 once it floats in its place. A spring, so it may pass 1 briefly. */
  readonly appear: number;
  readonly appearV: number;
  /** -1 to 1: where the whole phone is in its slow rise and fall. */
  readonly hover: number;
  /** -1 to 1: the whole phone's slow rock, out of step with the rise. */
  readonly rock: number;
  /** 0 on the cradle, 1 floating just off it. A soft spring. */
  readonly lift: number;
  readonly liftV: number;
  /** The finger wheel's turn, 0 at rest and negative while wound. */
  readonly wheel: number;
  /** 0 to 1: how hard the bells are ringing right now. */
  readonly ring: number;
  /** -1 to 1: the bells' shake and the clapper's swing, a quarter turn apart. */
  readonly bell: number;
  readonly clapper: number;
  /** 0 to 1: the waves at the earpiece, and where the first one is in its travel. */
  readonly waves: number;
  readonly wavePhase: number;
  /** -1 to 1: the lifted handset's own small drift. 0 on the cradle. */
  readonly sway: number;
  readonly lamp: LampKind;
  /** 0 to 1: the lamp's brightness. */
  readonly lampLevel: number;
}

export const INITIAL_MOTION: PhoneMotion = Object.freeze({
  phase: "dialing",
  t: 0,
  age: 0,
  appear: 0,
  appearV: 0,
  hover: 0,
  rock: 0,
  lift: 0,
  liftV: 0,
  wheel: 0,
  ring: 0,
  bell: 0,
  clapper: 0,
  waves: 0,
  wavePhase: 0,
  sway: 0,
  lamp: "off",
  lampLevel: 0,
});

/** The handset is off its cradle exactly while the line is open. */
export const liftedIn = (phase: ShownPhase): boolean => phase === "dialing" || phase === "ringing" || phase === "talking";

/** The longest step taken at once; a longer frame is cut into steps this size, so the springs stay stable. */
export const MAX_STEP = 1 / 60;
/** A frame longer than this (a hidden tab coming back) counts as this long. */
export const MAX_FRAME = 0.25;
/** The float's clock wraps here, a whole number of both its periods, so it never loses precision or jumps. */
export const AGE_WRAP = 4.6 * 7.3 * 100;

/** The phone's arrival. */
const APPEAR_K = 150;
const APPEAR_C = 17;
/** The handset's lift: softer than the arrival, so it drifts up rather than jumps. */
const LIFT_K = 70;
const LIFT_C = 13;

/** One whole rise and fall of the floating phone. Franki's own float takes 4 s, so the two drift in and out of step. */
export const FLOAT_PERIOD = 4.6;
/** The rock is slower than the rise. */
export const ROCK_PERIOD = 7.3;

/** How long the handset takes to leave the hook before the wheel is touched. */
export const DIAL_LEAD = 0.45;
/** One digit: wind, let go, pause. */
export const DIAL_CYCLE = 1.5;
const DIAL_WIND = 0.42;
const DIAL_RETURN = 0.85;
/** How far each digit winds the wheel. The list repeats. */
export const DIAL_TURNS: readonly number[] = [1.1, 2.3, 0.8, 1.7, 2.7, 1.3, 2.0];

/** One ring: the bells shake for RING_ON, then rest. */
export const RING_CYCLE = 2.4;
export const RING_ON = 1.3;
const SHAKE_HZ = 17;
const DING_AT = 0.5;
const WAVE_SECONDS = 1.7;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
const toward = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

function spring(x: number, v: number, target: number, k: number, c: number, dt: number): [number, number] {
  const nv = v + (k * (target - x) - c * v) * dt;
  return [x + nv * dt, nv];
}

/** The float at `age` seconds: the rise and fall, and the rock. Both start at 0, so the phone arrives level. */
export function floatAt(age: number): { hover: number; rock: number } {
  return {
    hover: Math.sin((2 * Math.PI * age) / FLOAT_PERIOD),
    rock: Math.sin((2 * Math.PI * age) / ROCK_PERIOD),
  };
}

/**
 * The lifted handset's own drift at `age` seconds, before it is scaled by how far it is lifted. Its two periods
 * divide AGE_WRAP too, so it runs on through the wrap.
 */
export function swayAt(age: number): number {
  return Math.sin((2 * Math.PI * age) / (ROCK_PERIOD / 2) + 0.6) * 0.7 + Math.sin((2 * Math.PI * age) / (FLOAT_PERIOD / 2) + 2) * 0.3;
}

/** The wheel's turn at `t` seconds into dialing: wound quickly by the finger, returned slowly by the governor. */
export function wheelAt(t: number): number {
  const since = t - DIAL_LEAD;
  if (since <= 0) return 0;
  const digit = Math.floor(since / DIAL_CYCLE);
  const at = since - digit * DIAL_CYCLE;
  const turn = DIAL_TURNS[digit % DIAL_TURNS.length]!;
  if (at < DIAL_WIND) return -turn * ease(at / DIAL_WIND);
  if (at < DIAL_WIND + DIAL_RETURN) return -turn * (1 - (at - DIAL_WIND) / DIAL_RETURN);
  return 0;
}

/** 0 to 1: whether the bells are in a ring at `t` seconds into ringing, with soft ends. */
export function ringAt(t: number): number {
  const at = t % RING_CYCLE;
  if (at >= RING_ON) return 0;
  return Math.min(1, at / 0.06, (RING_ON - at) / 0.18);
}

/** One tap of the bell as the handset settles on the cradle, fading out. */
export function dingAt(t: number): number {
  const since = t - DING_AT;
  return since < 0 ? 0 : Math.exp(-4.5 * since);
}

/**
 * Where the motion comes to rest in `view`, with nothing moving: the pose shown under Reduced_Motion. The phone is
 * level and still, the handset is already where it belongs, the lamp is steady, and a ring or a voice shows as still
 * strokes and still waves.
 */
export function settledMotion(view: ShownView): PhoneMotion {
  const talking = view.phase === "talking";
  const lamp: LampKind = talking ? "live" : view.phase === "missed" ? "missed" : "off";
  return {
    ...INITIAL_MOTION,
    phase: view.phase,
    appear: 1,
    lift: liftedIn(view.phase) ? 1 : 0,
    ring: view.phase === "ringing" ? 1 : 0,
    waves: talking ? 1 : 0,
    wavePhase: 0.12,
    lamp,
    lampLevel: lamp === "off" ? 0 : 0.8,
  };
}

function one(m: PhoneMotion, view: ShownView, dt: number): PhoneMotion {
  const t = view.phase === m.phase ? m.t + dt : dt;
  const age = (m.age + dt) % AGE_WRAP;
  const [appear, appearV] = spring(m.appear, m.appearV, 1, APPEAR_K, APPEAR_C, dt);
  const [lift, liftV] = spring(m.lift, m.liftV, liftedIn(view.phase) ? 1 : 0, LIFT_K, LIFT_C, dt);
  const { hover, rock } = floatAt(age);

  const ringing = view.phase === "ringing" ? ringAt(t) : view.phase === "ended" ? dingAt(t) * 0.55 : 0;
  const shake = 2 * Math.PI * SHAKE_HZ * t;
  const talking = view.phase === "talking";
  const lamp: LampKind = talking ? "live" : view.phase === "missed" ? "missed" : "off";
  const lampTarget = lamp === "live" ? 0.75 + 0.25 * Math.sin(t * 3.1) : lamp === "missed" ? 0.6 + 0.4 * Math.sin(t * 2.2) : 0;

  return {
    phase: view.phase,
    t,
    age,
    appear,
    appearV,
    hover,
    rock,
    lift,
    liftV,
    // Leaving dialing mid-turn, the wheel runs home instead of snapping.
    wheel: view.phase === "dialing" ? wheelAt(t) : toward(m.wheel, 0, 9, dt),
    ring: ringing,
    bell: ringing * Math.sin(shake),
    clapper: ringing * Math.cos(shake),
    waves: toward(m.waves, talking ? 1 : 0, 5, dt),
    wavePhase: (m.wavePhase + dt / WAVE_SECONDS) % 1,
    // On the age clock, and scaled by the lift, so it fades in and out with the handset and never jumps.
    sway: swayAt(age) * clamp01(lift),
    lamp,
    lampLevel: toward(m.lampLevel, lampTarget, 8, dt),
  };
}

/** The motion `dt` seconds later, showing `view`. Any `dt` is safe: negative reads as 0, long frames are capped. */
export function stepMotion(m: PhoneMotion, view: ShownView, dt: number): PhoneMotion {
  let left = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), MAX_FRAME) : 0;
  let next = m;
  // At least one step, so a change of phase lands even on a zero-length frame.
  do {
    const step = Math.min(left, MAX_STEP);
    next = one(next, view, step);
    left -= step;
  } while (left > 1e-9);
  return next;
}
