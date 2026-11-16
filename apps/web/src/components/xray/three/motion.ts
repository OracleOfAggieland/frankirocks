// How the three.js X-ray machine moves, as plain numbers: no three.js, no clock, no randomness. The engine steps
// this once a frame with the frame's own time step and poses the model from the result, so every number here can be
// tested in node. Times are seconds.
//
// Four kinds of channel.
// - Eased (glow, green, ember, film, bones, scan, scanFast, flicker, spark, blink, stutter, beam, valve, knob,
//   needleRest, wander): each glides toward a target that the view and the hover pick, and comes to rest on
//   settledXrayMotion.
// - The arm (aim, aimVel): a critically damped spring, so the arm starts gently, swings and settles with no bounce,
//   as ghost physics asks. It is eased too: it comes to rest on its target with no speed left.
// - The scan line's phase (scanPhase): it runs at a speed the eased channels pick, so a change of speed never makes
//   the line jump.
// - Drawn (screen, scanY, scanAlpha, needle, arc, arcSeed, hum, aperture): worked out each step from the others and
//   the loop clock `t`, so a flicker, a blink or a crackle keeps going for as long as its state lasts.
import type { XrayPropView } from "../../../ui/xray/types";

export interface XrayMotion {
  /** The loop clock, 0 to LOOP_SECONDS. Every loop below fits a whole number of times into it, so the wrap is seamless. */
  readonly t: number;
  /** 0 to 1: how brightly the glass glows, before the flicker, the blink and the stutter. */
  readonly glow: number;
  /** 0 to 1: the glass's colour leaning from warm amber to ghost green. */
  readonly green: number;
  /** 0 to 1: the glass's colour leaning to ember, over the green. */
  readonly ember: number;
  /** 0 to 1: the glass's colour leaning to the pale grey of bare film, over the green. */
  readonly film: number;
  /** 0 to 1: how brightly the hand's bones show on the glass. */
  readonly bones: number;
  /** 0 to 1: how strong the scan line is. */
  readonly scan: number;
  /** 0 to 1: how fast the scan line runs, from a slow pass to a quick hunt. */
  readonly scanFast: number;
  /** 0 to 1: how hard the glass flickers. */
  readonly flicker: number;
  /** 0 to 1: how strong the arc at the tube head is. */
  readonly spark: number;
  /** 0 to 1: how deep the glass's slow blink is. */
  readonly blink: number;
  /** 0 to 1: how often the glass stutters dark, as a dying tube does. */
  readonly stutter: number;
  /** 0 to 1: how visible the faint beam from the tube head to the glass is. */
  readonly beam: number;
  /** 0 to 1: how warm the valve's filament on top is. */
  readonly valve: number;
  /** 0 to 1: how far the knob is turned. */
  readonly knob: number;
  /** 0 to 1: where the dial's needle rests, 0 at the left stop. */
  readonly needleRest: number;
  /** 0 to 1: how much the needle wanders about its rest. */
  readonly wander: number;
  /** 0 to 1: the arm's pose, 0 parked upright and 1 with the tube head aimed at the glass. */
  readonly aim: number;
  /** The arm's speed, in poses a second. */
  readonly aimVel: number;
  /** 0 to 1: where the scan line is in its pass, from the glass's top. */
  readonly scanPhase: number;
  /** 0 to 1: the glass's brightness as drawn. */
  readonly screen: number;
  /** 0 to 1: the scan line's height on the glass as drawn, 0 at the top. */
  readonly scanY: number;
  /** 0 to 1: the scan line's brightness as drawn. */
  readonly scanAlpha: number;
  /** 0 to 1: the needle's place across the dial as drawn. */
  readonly needle: number;
  /** 0 to 1: the arc's brightness this instant. */
  readonly arc: number;
  /** A whole number from 0 to ARC_SEEDS - 1: which jagged shape the arc takes. It changes ARC_HZ times a second. */
  readonly arcSeed: number;
  /** -1 to 1: the tube head's small hum, a sway of a degree or so. */
  readonly hum: number;
  /** 0 to 1: how brightly the tube head's window glows. */
  readonly aperture: number;
}

/** The loop clock wraps here; 600 s holds a whole number of every loop's period. */
export const LOOP_SECONDS = 600;
export const ARC_SEEDS = 997;
/** The longest step taken at once; a longer frame is cut into steps this size. */
export const MAX_STEP = 1 / 60;
/** A frame longer than this (a hidden tab coming back) counts as this long. */
export const MAX_FRAME = 0.25;

/** One slow pass of the scan line, top to bottom, and one quick pass while it hunts for bones. */
export const SCAN_SLOW_SECONDS = 3.2;
export const SCAN_FAST_SECONDS = 1.25;
/** One slow blink of a paused machine. */
export const BLINK_SECONDS = 2.4;
/** The lit glass breathes on this period. */
export const BREATH_SECONDS = 3;
/** The flicker's and the stutter's ticks, and the arc's. */
const FLICKER_HZ = 20;
const STUTTER_HZ = 10;
const ARC_HZ = 15;
/** How much of the glass's light the blink takes at its dimmest, the breath at its lowest, and a stutter. */
const BLINK_DEPTH = 0.8;
const BREATH_DEPTH = 0.07;
const STUTTER_DEPTH = 0.85;
/** How far the needle wanders either side of its rest. */
const WANDER_REACH = 0.06;

/** The dim warm glow that invites a press while the machine is off. */
export const HOVER_WARM = 0.3;
/** On, a hover lifts the glass this much more. */
const HOVER_LIFT = 0.1;

/** The arm's spring: its natural speed, in radians a second, and the cap on its speed. */
const AIM_OMEGA = 5.2;
export const AIM_MAX_SPEED = 6;

/** The settled pose's loop phases: the scan line caught a little above the middle, the arc in one fixed shape. */
export const STILL_SCAN = 0.38;
const STILL_ARC = 0.75;
const STILL_ARC_SEED = 5;

/** How fast each eased channel closes on its target, per second. */
const RATE = { glow: 6, color: 4, bones: 3, amount: 5, spark: 10, valve: 2.5, knob: 3, needle: 3.5 } as const;

export const EASED_CHANNELS = [
  "glow",
  "green",
  "ember",
  "film",
  "bones",
  "scan",
  "scanFast",
  "flicker",
  "spark",
  "blink",
  "stutter",
  "beam",
  "valve",
  "knob",
  "needleRest",
  "wander",
  "aim",
  "aimVel",
] as const;
export type EasedChannel = (typeof EASED_CHANNELS)[number];

/** Every channel's range. The property tests hold the motion to these. */
export const XRAY_MOTION_RANGES: { readonly [K in keyof XrayMotion]: readonly [number, number] } = Object.freeze({
  t: [0, LOOP_SECONDS],
  glow: [0, 1],
  green: [0, 1],
  ember: [0, 1],
  film: [0, 1],
  bones: [0, 1],
  scan: [0, 1],
  scanFast: [0, 1],
  flicker: [0, 1],
  spark: [0, 1],
  blink: [0, 1],
  stutter: [0, 1],
  beam: [0, 1],
  valve: [0, 1],
  knob: [0, 1],
  needleRest: [0, 1],
  wander: [0, 1],
  aim: [0, 1],
  aimVel: [-AIM_MAX_SPEED, AIM_MAX_SPEED],
  scanPhase: [0, 1],
  screen: [0, 1],
  scanY: [0, 1],
  scanAlpha: [0, 1],
  needle: [0, 1],
  arc: [0, 1],
  arcSeed: [0, ARC_SEEDS - 1],
  hum: [-1, 1],
  aperture: [0, 1],
});

export const INITIAL_XRAY_MOTION: XrayMotion = Object.freeze({
  t: 0,
  glow: 0,
  green: 0,
  ember: 0,
  film: 0,
  bones: 0,
  scan: 0,
  scanFast: 0,
  flicker: 0,
  spark: 0,
  blink: 0,
  stutter: 0,
  beam: 0,
  valve: 0,
  knob: 0,
  needleRest: 0,
  wander: 0,
  aim: 0,
  aimVel: 0,
  scanPhase: 0,
  screen: 0,
  scanY: 0,
  scanAlpha: 0,
  needle: 0,
  arc: 0,
  arcSeed: 0,
  hum: 0,
  aperture: 0,
});

type Eased = { readonly [K in EasedChannel]: number };

const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
const TAU = 2 * Math.PI;
const toward = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));
/** A fixed hash of a whole number to 0..1, so the flicker and the arc go the same way every time. */
const hash01 = (n: number) => {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const OFF: Eased = {
  glow: 0,
  green: 0,
  ember: 0,
  film: 0,
  bones: 0,
  scan: 0,
  scanFast: 0,
  flicker: 0,
  spark: 0,
  blink: 0,
  stutter: 0,
  beam: 0,
  valve: 0,
  knob: 0,
  needleRest: 0,
  wander: 0,
  aim: 0,
  aimVel: 0,
};

/**
 * What each eased channel heads for in `view`. The machine being off wins over whatever the signal says. Each
 * state differs from every other in the colour and brightness of its glass, and most in the arm and the needle too,
 * so each reads apart at the stage's size, and in its still pose.
 */
export function xrayTargets(view: XrayPropView, hover: boolean): Eased {
  const lift = hover ? HOVER_LIFT : 0;
  if (view.power === "off") return { ...OFF, glow: hover ? HOVER_WARM : 0, valve: hover ? 0.2 : 0 };
  const on = { ...OFF, knob: 1, aim: 1 };
  switch (view.signal) {
    case "dark":
    // On and dark is a moment between events; it reads as asking, which is what it is about to be.
    case "asking":
      // The tube warms: the glass flickers a dim amber and an arc crackles at the head.
      return { ...on, glow: clamp(0.42 + lift), flicker: 1, spark: 1, valve: 0.75, needleRest: 0.15, wander: 0.6 };
    case "warming":
      // The picture is coming: the glass flickers brighter and greener, a faint hand and a slow scan show through.
      return { ...on, glow: clamp(0.62 + lift), green: 0.6, flicker: 0.65, spark: 1, bones: 0.28, scan: 0.45, beam: 0.25, valve: 0.9, needleRest: 0.38, wander: 0.4 };
    case "searching":
      // Ghost green, the hand half bright, and the scan line hunting quickly up and down the glass.
      return { ...on, glow: clamp(0.8 + lift), green: 1, bones: 0.55, scan: 1, scanFast: 1, beam: 0.55, valve: 1, needleRest: 0.56, wander: 1 };
    case "seeing":
      // Full ghost green, the bones bright, the beam on and a slow, sure scan.
      return { ...on, glow: clamp(0.92 + lift), green: 1, bones: 1, scan: 1, beam: 1, valve: 1, needleRest: 0.82, wander: 0.2 };
    case "filmOnly":
      // The pale grey of bare film, the hand faint and no beam: the picture with nothing tracked on it.
      return { ...on, glow: clamp(0.72 + lift), green: 1, film: 1, bones: 0.3, scan: 0.8, valve: 0.8, needleRest: 0.3, wander: 0.15 };
    case "blocked":
      // Refused: a steady ember glass, the arm still raised to it.
      return { ...on, glow: clamp(0.78 + lift), ember: 1, aim: 0.82, valve: 0.4, needleRest: 0.05 };
    case "noCamera":
      // Nothing to see: a dim ember that stutters like a dying tube, and the arm drooping away from the glass.
      return { ...on, glow: clamp(0.5 + lift), ember: 1, stutter: 1, aim: 0.3, valve: 0.15, needleRest: 0 };
    case "paused":
      // Waiting: a slow green blink with the hand faint in it, the arm halfway up.
      return { ...on, glow: clamp(0.62 + lift), green: 1, blink: 1, bones: 0.4, aim: 0.6, valve: 0.4, needleRest: 0.22 };
  }
}

/** The drawn channels from the eased ones at loop time `t` and the scan line's phase. */
function drawn(e: Eased, t: number, scanPhase: number): Pick<XrayMotion, "screen" | "scanY" | "scanAlpha" | "needle" | "arc" | "arcSeed" | "hum" | "aperture"> {
  const fTick = Math.floor(t * FLICKER_HZ);
  // Mostly a shallow shimmer, with a deep dip now and then, as an old tube does while it warms.
  const flickDim = e.flicker * (hash01(fTick) < 0.28 ? 0.6 : 0.18 * hash01(fTick + 11)) + e.flicker * 0.08 * (0.5 + 0.5 * Math.sin(TAU * 3 * t));
  const blinkDim = e.blink * BLINK_DEPTH * (0.5 + 0.5 * Math.cos((TAU * t) / BLINK_SECONDS));
  const sTick = Math.floor(t * STUTTER_HZ);
  const stutterDim = e.stutter * (hash01(sTick + 3) < 0.14 ? STUTTER_DEPTH : 0.06 * hash01(sTick + 5));
  // The lit glass breathes a little; scan is only above zero while a picture is showing.
  const breath = 1 - e.scan * BREATH_DEPTH * (0.5 + 0.5 * Math.sin((TAU * t) / BREATH_SECONDS));
  const aTick = Math.floor(t * ARC_HZ);
  // Mostly bright, with a dark tick now and then, as a real spark gap does.
  const arc = clamp(e.spark * (hash01(aTick + 17) < 0.25 ? 0.08 : 0.55 + 0.45 * hash01(aTick + 29)));
  // The scan line rises in at the top and fades out at the bottom of each pass.
  const scanAlpha = clamp(e.scan * Math.sin(Math.PI * scanPhase) ** 0.6);
  const wander = e.wander * WANDER_REACH * (0.6 * Math.sin(TAU * 0.45 * t) + 0.4 * Math.sin(TAU * 1.7 * t + 1.3));
  const humAmount = clamp(0.5 * e.beam + 0.5 * e.spark);
  return {
    screen: clamp(e.glow * (1 - flickDim) * (1 - blinkDim) * (1 - stutterDim) * breath),
    scanY: clamp(scanPhase),
    scanAlpha,
    needle: clamp(e.needleRest + wander),
    arc,
    arcSeed: ((aTick % ARC_SEEDS) + ARC_SEEDS) % ARC_SEEDS,
    hum: clamp(humAmount * (0.6 * Math.sin(TAU * 0.5 * t) + 0.4 * Math.sin(TAU * 1.5 * t + 0.8)), -1, 1),
    aperture: clamp(0.15 * e.valve * e.knob + 0.85 * Math.max(e.beam * (0.9 + 0.1 * Math.sin(TAU * 2 * t)), arc)),
  };
}

/**
 * Where the motion comes to rest in `view`, with nothing moving: the pose drawn under Reduced_Motion. The glass is
 * lit without a flicker or a blink, the needle sits on its rest, the arm has arrived, and a lit glass has its scan
 * line held a little above the middle.
 */
export function settledXrayMotion(view: XrayPropView, hover: boolean): XrayMotion {
  const e = xrayTargets(view, hover);
  return {
    t: 0,
    ...e,
    scanPhase: STILL_SCAN,
    // A paused glass is drawn halfway through its blink, so it stays apart from a lit one.
    screen: clamp(e.glow * (1 - e.blink * BLINK_DEPTH * 0.5) * (1 - e.stutter * 0.3)),
    scanY: STILL_SCAN,
    scanAlpha: clamp(e.scan * 0.85),
    needle: clamp(e.needleRest),
    arc: clamp(e.spark * STILL_ARC),
    arcSeed: STILL_ARC_SEED,
    hum: 0,
    aperture: clamp(0.15 * e.valve * e.knob + 0.85 * Math.max(e.beam, e.spark * STILL_ARC)),
  };
}

/** The arm's spring, one step: critically damped toward `target`, its speed capped, its pose held to 0..1. */
function spring(aim: number, vel: number, target: number, dt: number): [number, number] {
  const accel = AIM_OMEGA * AIM_OMEGA * (target - aim) - 2 * AIM_OMEGA * vel;
  let v = clamp(vel + accel * dt, -AIM_MAX_SPEED, AIM_MAX_SPEED);
  let a = aim + v * dt;
  if (a < 0 || a > 1) {
    a = clamp(a);
    v = 0;
  }
  return [a, v];
}

function one(m: XrayMotion, target: Eased, dt: number): XrayMotion {
  const t = (m.t + dt) % LOOP_SECONDS;
  const [aim, aimVel] = spring(m.aim, m.aimVel, target.aim, dt);
  const e: Eased = {
    glow: clamp(toward(m.glow, target.glow, RATE.glow, dt)),
    green: clamp(toward(m.green, target.green, RATE.color, dt)),
    ember: clamp(toward(m.ember, target.ember, RATE.color, dt)),
    film: clamp(toward(m.film, target.film, RATE.color, dt)),
    bones: clamp(toward(m.bones, target.bones, RATE.bones, dt)),
    scan: clamp(toward(m.scan, target.scan, RATE.amount, dt)),
    scanFast: clamp(toward(m.scanFast, target.scanFast, RATE.amount, dt)),
    flicker: clamp(toward(m.flicker, target.flicker, RATE.amount, dt)),
    spark: clamp(toward(m.spark, target.spark, RATE.spark, dt)),
    blink: clamp(toward(m.blink, target.blink, RATE.amount, dt)),
    stutter: clamp(toward(m.stutter, target.stutter, RATE.amount, dt)),
    beam: clamp(toward(m.beam, target.beam, RATE.amount, dt)),
    valve: clamp(toward(m.valve, target.valve, RATE.valve, dt)),
    knob: clamp(toward(m.knob, target.knob, RATE.knob, dt)),
    needleRest: clamp(toward(m.needleRest, target.needleRest, RATE.needle, dt)),
    wander: clamp(toward(m.wander, target.wander, RATE.amount, dt)),
    aim,
    aimVel,
  };
  const period = SCAN_SLOW_SECONDS + (SCAN_FAST_SECONDS - SCAN_SLOW_SECONDS) * e.scanFast;
  const advanced = m.scanPhase + dt / period;
  const scanPhase = clamp(advanced - Math.floor(advanced), 0, 1);
  return { t, ...e, scanPhase, ...drawn(e, t, scanPhase) };
}

/** The motion `dt` seconds later, showing `view`. Any `dt` is safe: negative or not a number reads as 0, long frames are capped. */
export function stepXrayMotion(m: XrayMotion, view: XrayPropView, hover: boolean, dt: number): XrayMotion {
  const target = xrayTargets(view, hover);
  let left = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), MAX_FRAME) : 0;
  let next = m;
  // At least one step, so a change of view lands even on a zero-length frame.
  do {
    const step = Math.min(left, MAX_STEP);
    next = one(next, target, step);
    left -= step;
  } while (left > 1e-9);
  return next;
}
