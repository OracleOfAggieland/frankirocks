// How the three.js radio moves, as plain numbers: no three.js, no clock, no randomness. The engine steps this once
// a frame with the frame's own time step and poses the model from the result, so every number here can be tested
// in node. Times are seconds.
//
// Two kinds of channel. The eased ones (warm, green, ember, rest, sweep, tremble, blink, beat, drift, knob, source,
// spark) glide toward a target that the view and the hover pick, and come to rest on settledRadioMotion. The drawn
// ones (dial, needle, pulse, bob, arc, arcSeed, notes) are worked out each step from the eased ones and the loop
// clock `t`, so a sweep, a blink or a beat keeps going for as long as its state lasts.
import type { RadioPropView } from "../../../ui/radio/types";

export interface RadioMotion {
  /** The loop clock, 0 to LOOP_SECONDS. Every loop below fits a whole number of times into it, so the wrap is seamless. */
  readonly t: number;
  /** 0 to 1: how brightly the dial is lit, before the blink. */
  readonly warm: number;
  /** 0 to 1: the dial's colour leaning from warm amber to ghost green. */
  readonly green: number;
  /** 0 to 1: the dial's colour leaning to ember, over the green. */
  readonly ember: number;
  /** 0 to 1: where the needle rests across the dial, 0 parked at the left. */
  readonly rest: number;
  /** 0 to 1: how wide the tuning sweep is. */
  readonly sweep: number;
  /** 0 to 1: how hard the needle trembles in place. */
  readonly tremble: number;
  /** 0 to 1: how deep the dial's slow blink is. */
  readonly blink: number;
  /** 0 to 1: how strongly the speaker pulses and the cabinet bobs. */
  readonly beat: number;
  /** 0 to 1: how visible the rings and notes drifting from the speaker are. */
  readonly drift: number;
  /** 0 to 1: how far the knobs are turned. */
  readonly knob: number;
  /** 0 to 1: the soft brass glow that marks the radio as the open globe's source. */
  readonly source: number;
  /** 0 to 1: how strong the crackle at the antenna tip is. */
  readonly spark: number;
  /** 0 to 1: the dial's brightness as drawn. */
  readonly dial: number;
  /** 0 to 1: the needle's place across the dial as drawn. */
  readonly needle: number;
  /** -1 to 1: the speaker's push in and out. */
  readonly pulse: number;
  /** 0 to 1: the cabinet's lift off the floor, as a share of BOB_HEIGHT. */
  readonly bob: number;
  /** 0 to 1: the crackle's brightness this instant. */
  readonly arc: number;
  /** A whole number from 0 to ARC_SEEDS - 1: which jagged shape the crackle takes. It changes ARC_HZ times a second. */
  readonly arcSeed: number;
  /** 0 to 1: where the first drifting ring is in its travel. */
  readonly notes: number;
}

/** The loop clock wraps here; 600 s holds a whole number of every loop's period. */
export const LOOP_SECONDS = 600;
export const ARC_SEEDS = 997;
/** The longest step taken at once; a longer frame is cut into steps this size. */
export const MAX_STEP = 1 / 60;
/** A frame longer than this (a hidden tab coming back) counts as this long. */
export const MAX_FRAME = 0.25;

/** The speaker's beat, about 2 Hz. */
export const BEAT_HZ = 2;
/** One tuning sweep, left to right and back. */
export const SWEEP_SECONDS = 2.4;
/** One slow blink of "tap to play". */
export const BLINK_SECONDS = 2;
/** How long one ring takes to drift up and fade. */
export const NOTE_SECONDS = 2.5;
const TREMBLE_HZ = 9;
const ARC_HZ = 14;
/** How far the tuning sweep reaches either side of the dial's middle, and how far the needle trembles. */
const SWEEP_REACH = 0.4;
const TREMBLE_REACH = 0.025;
/** How much of the dial's light the blink takes away at its dimmest. */
const BLINK_DEPTH = 0.75;
/** The cabinet's bob in model units (the cabinet is 0.8 wide, so about 6 mm on a 30 cm radio). */
export const BOB_HEIGHT = 0.016;

/** Where the needle sits. Off parks it at the left; playing rests it on one fixed station mark. */
export const NEEDLE_PARK = 0;
export const NEEDLE_PLAY = 0.64;
export const NEEDLE_MIDDLE = 0.5;
export const NEEDLE_LOST = 0.36;

/** The dim warm glow that invites a press while the radio is off. */
export const HOVER_WARM = 0.32;
/** On, a hover lifts the dial this much more. */
const HOVER_LIFT = 0.1;

/** The settled pose's loop phases: a ring caught mid-air, the crackle in one fixed shape. */
const STILL_NOTES = 0.42;
const STILL_ARC = 0.75;
const STILL_ARC_SEED = 3;

/** How fast each eased channel closes on its target, per second. */
const RATE = { warm: 7, color: 5, rest: 4, amount: 5, knob: 3, source: 4 } as const;

export const EASED_CHANNELS = ["warm", "green", "ember", "rest", "sweep", "tremble", "blink", "beat", "drift", "knob", "source", "spark"] as const;
export type EasedChannel = (typeof EASED_CHANNELS)[number];

/** Every channel's range. The property tests hold the motion to these. */
export const RADIO_MOTION_RANGES: { readonly [K in keyof RadioMotion]: readonly [number, number] } = Object.freeze({
  t: [0, LOOP_SECONDS],
  warm: [0, 1],
  green: [0, 1],
  ember: [0, 1],
  rest: [0, 1],
  sweep: [0, 1],
  tremble: [0, 1],
  blink: [0, 1],
  beat: [0, 1],
  drift: [0, 1],
  knob: [0, 1],
  source: [0, 1],
  spark: [0, 1],
  dial: [0, 1],
  needle: [0, 1],
  pulse: [-1, 1],
  bob: [0, 1],
  arc: [0, 1],
  arcSeed: [0, ARC_SEEDS - 1],
  notes: [0, 1],
});

export const INITIAL_RADIO_MOTION: RadioMotion = Object.freeze({
  t: 0,
  warm: 0,
  green: 0,
  ember: 0,
  rest: NEEDLE_PARK,
  sweep: 0,
  tremble: 0,
  blink: 0,
  beat: 0,
  drift: 0,
  knob: 0,
  source: 0,
  spark: 0,
  dial: 0,
  needle: NEEDLE_PARK,
  pulse: 0,
  bob: 0,
  arc: 0,
  arcSeed: 0,
  notes: 0,
});

type Targets = { readonly [K in EasedChannel]: number };

const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
const TAU = 2 * Math.PI;
const toward = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));
/** A fixed hash of a whole number to 0..1, so the crackle flickers the same way every time. */
const hash01 = (n: number) => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/** What each eased channel heads for in `view`. The radio being off wins over whatever the signal says. */
export function radioTargets(view: RadioPropView, hover: boolean): Targets {
  const source = view.open ? 1 : 0;
  const lift = hover ? HOVER_LIFT : 0;
  const base = { warm: 0, green: 0, ember: 0, rest: NEEDLE_PARK, sweep: 0, tremble: 0, blink: 0, beat: 0, drift: 0, knob: 0, source, spark: 0 };
  if (view.power === "off") return { ...base, warm: hover ? HOVER_WARM : 0 };
  switch (view.signal) {
    case "playing":
      return { ...base, warm: clamp(0.9 + lift), green: 1, rest: NEEDLE_PLAY, beat: 1, drift: 1, knob: 1 };
    case "noSignal":
      return { ...base, warm: clamp(0.8 + lift), ember: 1, rest: NEEDLE_LOST, tremble: 1, knob: 1 };
    case "tapToPlay":
      return { ...base, warm: clamp(0.85 + lift), rest: NEEDLE_PLAY, blink: 1, knob: 1 };
    case "tuning":
    case "silent":
      // On and silent is a moment between events; it reads as tuning, which is what it is about to be.
      return { ...base, warm: clamp(0.8 + lift), rest: NEEDLE_MIDDLE, sweep: 1, knob: 0.5, spark: 1 };
  }
}

/** The drawn channels from the eased ones at loop time `t`. */
function drawn(e: Targets, t: number): Pick<RadioMotion, "dial" | "needle" | "pulse" | "bob" | "arc" | "arcSeed" | "notes"> {
  const blinkDim = e.blink * BLINK_DEPTH * (0.5 + 0.5 * Math.cos((TAU * t) / BLINK_SECONDS));
  const beatPhase = TAU * BEAT_HZ * t;
  const tick = Math.floor(t * ARC_HZ);
  return {
    dial: clamp(e.warm * (1 - blinkDim)),
    needle: clamp(e.rest + e.sweep * SWEEP_REACH * Math.sin((TAU * t) / SWEEP_SECONDS) + e.tremble * TREMBLE_REACH * Math.sin(TAU * TREMBLE_HZ * t)),
    pulse: clamp(e.beat * Math.sin(beatPhase), -1, 1),
    bob: clamp(e.beat * (0.5 + 0.5 * Math.sin(beatPhase - 0.7))),
    // Mostly bright, with a dark tick now and then, as a real spark gap does.
    arc: clamp(e.spark * (hash01(tick) < 0.22 ? 0.1 : 0.55 + 0.45 * hash01(tick + 7))),
    arcSeed: ((tick % ARC_SEEDS) + ARC_SEEDS) % ARC_SEEDS,
    notes: clamp((t / NOTE_SECONDS) % 1),
  };
}

/**
 * Where the motion comes to rest in `view`, with nothing moving: the pose drawn under Reduced_Motion. The dial is
 * lit without a blink, the needle sits on its mark, and a playing radio has one ring held mid-air.
 */
export function settledRadioMotion(view: RadioPropView, hover: boolean): RadioMotion {
  const e = radioTargets(view, hover);
  const d = drawn(e, 0);
  return {
    t: 0,
    ...e,
    ...d,
    dial: clamp(e.warm),
    needle: clamp(e.rest),
    pulse: 0,
    bob: 0,
    arc: clamp(e.spark * STILL_ARC),
    arcSeed: STILL_ARC_SEED,
    notes: STILL_NOTES,
  };
}

function one(m: RadioMotion, target: Targets, dt: number): RadioMotion {
  const t = (m.t + dt) % LOOP_SECONDS;
  const e: Targets = {
    warm: clamp(toward(m.warm, target.warm, RATE.warm, dt)),
    green: clamp(toward(m.green, target.green, RATE.color, dt)),
    ember: clamp(toward(m.ember, target.ember, RATE.color, dt)),
    rest: clamp(toward(m.rest, target.rest, RATE.rest, dt)),
    sweep: clamp(toward(m.sweep, target.sweep, RATE.amount, dt)),
    tremble: clamp(toward(m.tremble, target.tremble, RATE.amount, dt)),
    blink: clamp(toward(m.blink, target.blink, RATE.amount, dt)),
    beat: clamp(toward(m.beat, target.beat, RATE.amount, dt)),
    drift: clamp(toward(m.drift, target.drift, RATE.amount, dt)),
    knob: clamp(toward(m.knob, target.knob, RATE.knob, dt)),
    source: clamp(toward(m.source, target.source, RATE.source, dt)),
    spark: clamp(toward(m.spark, target.spark, RATE.amount * 2, dt)),
  };
  return { t, ...e, ...drawn(e, t) };
}

/** The motion `dt` seconds later, showing `view`. Any `dt` is safe: negative or not a number reads as 0, long frames are capped. */
export function stepRadioMotion(m: RadioMotion, view: RadioPropView, hover: boolean, dt: number): RadioMotion {
  const target = radioTargets(view, hover);
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
