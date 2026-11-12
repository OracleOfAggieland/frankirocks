// The lab spider's gait. Pure: the same inputs always give the same feet.
// A planted foot stays put in viewport space while the body travels. A foot needs a step when it is more
// than STEP_FROM_REST from its rest point, or its leg would stretch past STEP_STRETCH. The legs step in two
// alternating groups (L1 R2 L3 R4, and R1 L2 R3 L4); a group lifts only when the other is planted, except
// above GALLOP_SPEED, when a group may lift once the other is half way through a shorter step.
import {
  LEGS,
  type Vec,
  add,
  clampToReach,
  dist,
  hipOffset,
  len,
  lerpVec,
  pairOf,
  restOffset,
  scale,
  sideOf,
  sub,
} from "./geometry";

export const STEP_FROM_REST = 7;
export const STEP_STRETCH = 15.5;
/** A group this far off its rest points takes its turn when the other group is due. */
export const DUE_FROM_REST = 2;
/** A step never lands further than this from its hip, so it isn't due again the moment it lands. */
export const LAND_REACH = STEP_STRETCH - 1.5;
export const STEP_MS = 80;
export const GALLOP_STEP_MS = 50;
/** px per ms. */
export const GALLOP_SPEED = 1.6;
/** A step lands ahead of its rest point by the travel during the step, at most this far. */
export const MAX_LEAD = 6;

export type Group = 0 | 1;

/** Group 0 is L1 R2 L3 R4; group 1 is R1 L2 R3 L4. */
export const groupOf = (leg: number): Group => ((sideOf(leg) + pairOf(leg)) % 2) as Group;
export const GROUPS: readonly (readonly number[])[] = [
  [0, 5, 2, 7],
  [4, 1, 6, 3],
];

export interface Swing {
  readonly from: Vec;
  readonly start: number;
  readonly dur: number;
}

export interface Foot {
  readonly at: Vec;
  readonly swing: Swing | null;
}

export interface GroupSwing {
  readonly start: number;
  readonly dur: number;
  /** True when this swing started while the other group was still swinging (a gallop). */
  readonly overlapped: boolean;
}

export interface GaitState {
  readonly feet: readonly Foot[];
  /** The current swing of each group, or null while planted. */
  readonly groups: readonly [GroupSwing | null, GroupSwing | null];
  readonly lastGroup: Group;
  readonly body: Vec | null;
}

export interface GaitInput {
  readonly t: number;
  /** The head centre, where the hips are. */
  readonly body: Vec;
  readonly heading: number;
  /** px per ms. */
  readonly velocity: Vec;
  /** The pointer has just come back (or a long gap in frames): put every foot at rest under the body. */
  readonly reset?: boolean;
}

export const initialGait: GaitState = { feet: [], groups: [null, null], lastGroup: 1, body: null };

export const hipAt = (body: Vec, leg: number, heading: number): Vec => add(body, hipOffset(leg, heading));
export const restAt = (body: Vec, leg: number, heading: number): Vec => add(body, restOffset(leg, heading));

/** Where a step that lasts `dur` should land: ahead of the rest point by the travel during it, at most MAX_LEAD. */
export function stepTarget(body: Vec, leg: number, heading: number, velocity: Vec, dur: number): Vec {
  const lead = scale(velocity, dur);
  const l = len(lead);
  const target = add(restAt(body, leg, heading), l > MAX_LEAD ? scale(lead, MAX_LEAD / l) : lead);
  // A front foot led far forward would land already stretched; it lands just inside the stretch instead.
  const hip = hipAt(body, leg, heading);
  const reach = dist(hip, target);
  return reach > LAND_REACH ? add(hip, scale(sub(target, hip), LAND_REACH / reach)) : target;
}

/** A swing's ease: slow off the ground, fast through the air, slow onto the ground. */
const ease = (p: number): number => p * p * (3 - 2 * p);

function restPose(body: Vec, heading: number): Foot[] {
  return Array.from({ length: LEGS }, (_, leg) => ({ at: restAt(body, leg, heading), swing: null }));
}

function needsStep(foot: Foot, leg: number, body: Vec, heading: number): boolean {
  return dist(foot.at, restAt(body, leg, heading)) > STEP_FROM_REST || dist(foot.at, hipAt(body, leg, heading)) > STEP_STRETCH;
}

export function stepGait(state: GaitState, input: GaitInput): GaitState {
  const { t, body, heading, velocity } = input;
  if (input.reset === true || state.body === null || state.feet.length !== LEGS) {
    return { feet: restPose(body, heading), groups: [null, null], lastGroup: state.lastGroup, body };
  }

  // Move every swinging foot along its arc, toward a target that follows the body.
  const feet: Foot[] = state.feet.map((foot, leg) => {
    if (foot.swing === null) return foot;
    const p = (t - foot.swing.start) / foot.swing.dur;
    const target = stepTarget(body, leg, heading, velocity, foot.swing.dur);
    if (p >= 1) return { at: target, swing: null };
    return { at: lerpVec(foot.swing.from, target, ease(Math.max(0, p))), swing: foot.swing };
  });
  const groups: [GroupSwing | null, GroupSwing | null] = [state.groups[0], state.groups[1]];
  for (const g of [0, 1] as const) {
    if (groups[g] !== null && GROUPS[g].every((leg) => feet[leg].swing === null)) groups[g] = null;
  }

  // Lift a group that needs a step, the one that didn't step last first. When only the group that
  // stepped last is due, the other goes in its place if it is off its rest points at all, so the
  // groups keep taking turns.
  const galloping = len(velocity) > GALLOP_SPEED;
  let lastGroup = state.lastGroup;
  const fresh = (1 - state.lastGroup) as Group;
  const due = (g: Group) => GROUPS[g].some((leg) => needsStep(feet[leg], leg, body, heading));
  const off = (g: Group) => GROUPS[g].some((leg) => dist(feet[leg].at, restAt(body, leg, heading)) > DUE_FROM_REST);
  const turnFor = (g: Group) => due(g) || (g === fresh && due(state.lastGroup) && off(g));
  for (const g of [fresh, state.lastGroup]) {
    if (groups[g] !== null) continue;
    if (!turnFor(g)) continue;
    const other = groups[(1 - g) as Group];
    const halfway = other !== null && (t - other.start) / other.dur >= 0.5;
    if (other !== null && !(galloping && halfway)) continue;
    const dur = galloping ? GALLOP_STEP_MS : STEP_MS;
    groups[g] = { start: t, dur, overlapped: other !== null };
    for (const leg of GROUPS[g]) feet[leg] = { at: feet[leg].at, swing: { from: feet[leg].at, start: t, dur } };
    lastGroup = g;
  }

  // No foot is ever out of its leg's reach: a foot the body has outrun slides after it.
  const reached = feet.map((foot, leg) => {
    const at = clampToReach(hipAt(body, leg, heading), foot.at, leg, heading);
    return at === foot.at ? foot : { at, swing: foot.swing };
  });
  return { feet: reached, groups, lastGroup, body };
}
