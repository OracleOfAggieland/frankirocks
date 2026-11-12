// The lab spider, as one pure step per frame and a pose to draw. Pure: Frame_Time in, numbers out.
// The head centre sits exactly on the pointer (no lag). Over a text field the body steps 14 px down and
// right and tucks its legs. Over something you can touch, a brass ring grows and the front legs lift. On
// press the legs pull in and the body shrinks a little. After REST_MS without a move, it lowers on a
// silk thread and sways; the next move or press climbs it back.
import { DUR, SPRING } from "../motion";
import {
  DEG,
  LEGS,
  type Vec,
  add,
  clamp,
  hipOffset,
  legAngle,
  lerp,
  lerpVec,
  pairOf,
  polar,
  restOffset,
  scale,
  solveLeg,
  sub,
  vec,
} from "./geometry";
import { type GaitState, initialGait, stepGait } from "./gait";
import { MAX_DT_MS, START_HEADING, nextHeading, nextVelocity } from "./heading";
import { type SpringValue, at, stepSpring } from "./spring";

export const REST_MS = 2000;
export const REST_DROP = 10;
export const THREAD = 46;
export const SWAY_DEG = 4;
/** The thread sways on the slow ambient period. */
export const SWAY_PERIOD_MS = DUR.drift;
export const TEXT_OFFSET = 14;
export const TEXT_OPACITY = 0.7;
export const PRESS_LEGS = 0.72;
export const PRESS_BODY = 0.92;
/** The touch ring's radius (a 30 px ring) and the scale it grows from. */
export const RING_R = 15;
export const RING_FROM = 0.6;
/** How far the legs fold over a text field, and while hanging on the thread. */
export const TUCK_LEGS = 0.42;
export const HANG_LEGS = 0.86;
/** A lifted front foot: raised toward the heading and drawn shorter, as a foot off the ground looks from above. */
export const LIFT_ANGLE_DEG = [18, 0, 0, 0] as const;
export const LIFT_DISTANCE = 11.5;
/** A leg is drawn at most this long, so a foot the body has outrun trails with its knee still bent. */
export const DRAW_REACH = 15;

export interface SpiderInput {
  readonly t: number;
  /** The pointer, in viewport pixels. */
  readonly x: number;
  readonly y: number;
  /** False while the pointer is off the page or over a layer the spider can't draw above. */
  readonly present: boolean;
  /** Over something you can touch. */
  readonly touch: boolean;
  /** Over a text field. */
  readonly text: boolean;
  readonly pressed: boolean;
}

export interface SpiderState {
  readonly t: number | null;
  readonly hot: Vec | null;
  /** The head centre: the pointer, plus the step aside over a text field. */
  readonly origin: Vec | null;
  readonly velocity: Vec;
  readonly heading: number;
  readonly gait: GaitState;
  readonly lastMove: number;
  readonly pressed: boolean;
  /** Whether the pointer was on the page last frame. */
  readonly present: boolean;
  readonly swayPhase: number;
  readonly ring: SpringValue;
  readonly lift: SpringValue;
  readonly tuck: SpringValue;
  readonly press: SpringValue;
  readonly drop: SpringValue;
  readonly presence: SpringValue;
}

export const initialSpider: SpiderState = {
  t: null,
  hot: null,
  origin: null,
  velocity: vec(0, 0),
  heading: START_HEADING,
  gait: initialGait,
  lastMove: 0,
  pressed: false,
  present: false,
  swayPhase: 0,
  ring: at(0),
  lift: at(0),
  tuck: at(0),
  press: at(0),
  drop: at(0),
  presence: at(0),
};

export function stepSpider(s: SpiderState, input: SpiderInput): SpiderState {
  const { t } = input;
  const gap = s.t === null ? 0 : t - s.t;
  const dt = clamp(gap, 0, MAX_DT_MS);
  const hot = vec(input.x, input.y);
  const moved = s.hot === null || s.hot.x !== hot.x || s.hot.y !== hot.y || (input.pressed && !s.pressed);
  const lastMove = moved ? t : s.lastMove;
  const resting = input.present && !input.pressed && t - lastMove >= REST_MS;
  const text = input.text;
  const touch = input.touch && !text;

  const tuck = stepSpring(s.tuck, text ? 1 : 0, SPRING.settle, dt);
  const ring = stepSpring(s.ring, touch ? 1 : 0, SPRING.settle, dt);
  const lift = stepSpring(s.lift, touch ? 1 : 0, SPRING.settle, dt);
  const press = stepSpring(s.press, input.pressed ? 1 : 0, SPRING.press, dt);
  const drop = stepSpring(s.drop, resting ? REST_DROP : 0, SPRING.float, dt);
  // Arrival is immediate, so the pointer is never faint while the native cursor is hidden; leaving fades.
  const presence = input.present ? at(1) : stepSpring(s.presence, 0, SPRING.settle, dt);

  const origin = add(hot, scale(vec(TEXT_OFFSET, TEXT_OFFSET), tuck.x));
  // A fresh start when the pointer comes back onto the page or frames stopped for a while (a hidden
  // tab): the feet go to rest under the body. A fast move is never a reset; the gait keeps up with it.
  const reset = s.origin === null || !s.present || gap > MAX_DT_MS;
  const velocity = reset ? vec(0, 0) : nextVelocity(s.velocity, sub(origin, s.origin as Vec), dt);
  const heading = nextHeading(s.heading, velocity, dt);
  const gait = stepGait(s.gait, { t, body: origin, heading, velocity, reset });
  const hanging = drop.x / REST_DROP > 1e-3;
  const swayPhase = hanging ? (s.swayPhase + (2 * Math.PI * dt) / SWAY_PERIOD_MS) % (2 * Math.PI) : 0;

  return { t, hot, origin, velocity, heading, gait, lastMove, pressed: input.pressed, present: input.present, swayPhase, ring, lift, tuck, press, drop, presence };
}

export interface LegPose {
  readonly hip: Vec;
  /** The upper bone's angle, in degrees. */
  readonly upper: number;
  readonly knee: Vec;
  /** The lower bone's angle, in degrees. */
  readonly lower: number;
  readonly foot: Vec;
}

export interface SpiderPose {
  /** The body centre in the viewport: where the drawing's origin goes. */
  readonly x: number;
  readonly y: number;
  readonly opacity: number;
  /** Degrees. */
  readonly heading: number;
  readonly bodyScale: number;
  /** Degrees, about the top of the thread. */
  readonly sway: number;
  readonly threadOpacity: number;
  readonly ringScale: number;
  readonly ringOpacity: number;
  /** In the drawing's frame, relative to the body centre, before the sway. */
  readonly legs: readonly LegPose[];
}

const unit = (v: number) => clamp(v, 0, 1);

export function spiderPose(s: SpiderState): SpiderPose {
  const origin = s.origin ?? vec(0, 0);
  const hang = unit(s.drop.x / REST_DROP);
  const centre = add(origin, vec(0, s.drop.x));
  const tuck = Math.max(0, s.tuck.x);
  const press = Math.max(0, s.press.x);
  const lift = unit(s.lift.x);
  const bodyScale = 1 - (1 - PRESS_BODY) * press;
  const legScale = (1 - (1 - PRESS_LEGS) * press) * lerp(1, TUCK_LEGS, tuck) * lerp(1, HANG_LEGS, hang);

  const legs: LegPose[] = [];
  for (let leg = 0; leg < LEGS; leg++) {
    const hip = hipOffset(leg, s.heading, bodyScale);
    const rest = restOffset(leg, s.heading);
    const planted = s.gait.feet.length === LEGS ? sub(s.gait.feet[leg].at, centre) : rest;
    let foot = lerpVec(planted, rest, hang);
    if (pairOf(leg) === 0) foot = lerpVec(foot, polar(LIFT_DISTANCE, legAngle(leg, s.heading, LIFT_ANGLE_DEG)), lift);
    const reach = sub(foot, hip);
    const drawn = Math.hypot(reach.x, reach.y) * legScale;
    foot = add(hip, scale(reach, drawn > DRAW_REACH ? (DRAW_REACH / drawn) * legScale : legScale));
    const solved = solveLeg(hip, foot, s.heading, leg);
    legs.push({
      hip,
      upper: Math.atan2(solved.knee.y - hip.y, solved.knee.x - hip.x) / DEG,
      knee: solved.knee,
      lower: Math.atan2(solved.foot.y - solved.knee.y, solved.foot.x - solved.knee.x) / DEG,
      foot: solved.foot,
    });
  }

  return {
    x: centre.x,
    y: centre.y,
    opacity: unit(s.presence.x) * (1 - (1 - TEXT_OPACITY) * unit(tuck)),
    heading: s.heading / DEG,
    bodyScale,
    sway: SWAY_DEG * Math.sin(s.swayPhase) * hang,
    threadOpacity: hang,
    ringScale: RING_FROM + (1 - RING_FROM) * s.ring.x,
    ringOpacity: unit(s.ring.x),
    legs,
  };
}
