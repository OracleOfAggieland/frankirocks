/**
 * @machine landing.switch
 * The knife switch at the foot of the front door (brief 015, package I). Pure: switchStep(state, event).
 * Phases: open (resting, or settling back), drag (the handle follows a pointer), throw (the blade swings
 * shut), spark (the blade is in the clips; one spark across the contacts), go (the page opens the lab).
 * Always: `thrown` is sent once, at contact, and `go` only after it. The spark lasts SPARK_MS of frame time,
 *         then `go`. Under reduced motion contact sends `go` at once, with no spark. A spark grant is held
 *         only in `spark`, and every way out of it gives the grant back. A press that moved is a drag: the
 *         click that follows its release never throws the switch.
 * Never:  read the budget, a clock or the DOM; throw. The shell runs the commands: frames, pointer capture,
 *         the budget, and the wait for the click that may follow a drag.
 */
import { DUR } from "../motion";
import { BLADE_SPRING, NUDGE_DEG, OPEN_DEG, type Point, dragAngle, grabOffset, isDrag, releaseTarget, stepBlade } from "./switch-blade";

/** Where the blade pivots on the hinge pin, in the drawing's viewBox. */
export const PIVOT: Point = { x: 84, y: 206 };
/** How long the spark across the contacts lasts, in frame time. */
export const SPARK_MS = DUR.base * 2;

export type SwitchPhase = "open" | "drag" | "throw" | "spark" | "go";

export interface SwitchDrag {
  readonly id: number;
  /** The offset between the pointer's angle and the blade's, taken at the grab. */
  readonly grab: number;
  /** Where the press started, in client pixels. */
  readonly start: Point;
  readonly moved: boolean;
}

export interface SwitchState {
  readonly phase: SwitchPhase;
  /** Degrees from closed; OPEN_DEG at rest. */
  readonly angle: number;
  readonly velocity: number;
  readonly target: number;
  readonly spring: keyof typeof BLADE_SPRING;
  /** The last frame time the blade stepped at; null after frames stop. */
  readonly last: number | null;
  readonly sparkStart: number | null;
  /** The spark's grant from the electricity budget, held only while sparking. */
  readonly token: number | null;
  readonly drag: SwitchDrag | null;
  /** True between a drag's release and the click that may follow it. */
  readonly suppressClick: boolean;
  readonly thrown: boolean;
  readonly hovered: boolean;
  readonly focused: boolean;
  /** True once a pointer or focus has come near: the shell prefetches the lab. */
  readonly near: boolean;
  readonly reduced: boolean;
}

export type SwitchEvent =
  /** A click, Enter or Space on the button. */
  | { readonly type: "click" }
  /** A pointer press. `onHandle`: it landed on the handle's grab area. `at`: in the viewBox; `client`: in pixels. */
  | { readonly type: "grab"; readonly id: number; readonly button: number; readonly onHandle: boolean; readonly at: Point; readonly client: Point }
  /** A pointer move. `buttonsUp`: a mouse with no button down, so the press ended unseen. */
  | { readonly type: "move"; readonly id: number; readonly at: Point; readonly client: Point; readonly buttonsUp: boolean }
  | { readonly type: "release"; readonly id: number }
  /** pointercancel, or pointer capture lost without a release. */
  | { readonly type: "cancel"; readonly id: number }
  /** The wait for a click after a drag's release has passed. */
  | { readonly type: "clickSettled" }
  /** An animation frame at frame time `t`. */
  | { readonly type: "frame"; readonly t: number }
  | { readonly type: "near"; readonly key: "hovered" | "focused"; readonly on: boolean }
  | { readonly type: "reduced"; readonly on: boolean }
  /** The budget's answer to a `request` command: a grant token, or null when the budget is full. */
  | { readonly type: "granted"; readonly token: number | null }
  | { readonly type: "unmount" };

export type SwitchCommand =
  | { readonly kind: "thrown" }
  | { readonly kind: "go" }
  | { readonly kind: "request" }
  | { readonly kind: "release"; readonly token: number }
  /** Ask for the next animation frame (once; a pending one is kept). */
  | { readonly kind: "frame" }
  /** Cancel any pending animation frame. */
  | { readonly kind: "stopFrames" }
  | { readonly kind: "capture"; readonly id: number }
  /** Send `clickSettled` once the click that may follow this release has had its chance. */
  | { readonly kind: "clickWindow" };

export interface SwitchStep {
  readonly state: SwitchState;
  readonly commands: readonly SwitchCommand[];
}

export function switchInit(reduced: boolean): SwitchState {
  return {
    phase: "open",
    angle: OPEN_DEG,
    velocity: 0,
    target: OPEN_DEG,
    spring: "settle",
    last: null,
    sparkStart: null,
    token: null,
    drag: null,
    suppressClick: false,
    thrown: false,
    hovered: false,
    focused: false,
    near: false,
    reduced,
  };
}

const stay = (state: SwitchState): SwitchStep => ({ state, commands: [] });

/** Where the blade rests while open: leaning a little toward the jaw while hovered or focused. */
function restAngle(s: SwitchState): number {
  return !s.reduced && (s.hovered || s.focused) ? OPEN_DEG - NUDGE_DEG : OPEN_DEG;
}

/** Leaves the spark for the lab, giving back its grant. */
function finish(s: SwitchState, commands: SwitchCommand[]): SwitchStep {
  if (s.token !== null) commands.push({ kind: "release", token: s.token });
  commands.push({ kind: "stopFrames" }, { kind: "go" });
  return { state: { ...s, phase: "go", token: null, sparkStart: null, last: null }, commands };
}

/** The blade meets the clips at frame time `t`. */
function contact(s: SwitchState, t: number, commands: SwitchCommand[]): SwitchStep {
  let next: SwitchState = { ...s, phase: "spark", angle: 0, velocity: 0, target: 0, drag: null };
  if (!next.thrown) {
    next = { ...next, thrown: true };
    commands.push({ kind: "thrown" });
  }
  if (next.reduced) return finish(next, commands);
  commands.push({ kind: "request" }, { kind: "frame" });
  return { state: { ...next, sparkStart: t }, commands };
}

function settle(s: SwitchState, commands: SwitchCommand[] = []): SwitchStep {
  if (s.phase !== "open") return { state: s, commands };
  const target = restAngle(s);
  if (s.reduced) {
    commands.push({ kind: "stopFrames" });
    return { state: { ...s, target, spring: "settle", angle: target, velocity: 0, last: null }, commands };
  }
  commands.push({ kind: "stopFrames" }, { kind: "frame" });
  return { state: { ...s, target, spring: "settle", last: null }, commands };
}

function throwIt(s: SwitchState, commands: SwitchCommand[] = []): SwitchStep {
  if (s.phase !== "open") return { state: s, commands };
  commands.push({ kind: "stopFrames" });
  const base: SwitchState = { ...s, drag: null, last: null };
  if (s.reduced) return contact({ ...base, angle: 0, velocity: 0 }, 0, commands);
  commands.push({ kind: "frame" });
  return { state: { ...base, phase: "throw", target: 0, spring: "throw" }, commands };
}

function endDrag(s: SwitchState, id: number, cancelled: boolean): SwitchStep {
  const d = s.drag;
  if (d === null || d.id !== id) return stay(s);
  const open: SwitchState = { ...s, drag: null, phase: "open" };
  // A tap on the handle: the click that follows throws the switch.
  if (!d.moved && !cancelled) return stay(open);
  const commands: SwitchCommand[] = [];
  if (cancelled) return settle(open, commands);
  // The click that follows this release belongs to the drag.
  commands.push({ kind: "clickWindow" });
  const released: SwitchState = { ...open, suppressClick: true };
  return releaseTarget(released.angle) === 0 ? throwIt(released, commands) : settle(released, commands);
}

export function switchStep(state: SwitchState, event: SwitchEvent): SwitchStep {
  const s = state;
  switch (event.type) {
    case "click":
      if (s.suppressClick) return stay({ ...s, suppressClick: false });
      return throwIt(s);
    case "clickSettled":
      return s.suppressClick ? stay({ ...s, suppressClick: false }) : stay(s);
    case "grab": {
      const cleared = s.suppressClick ? { ...s, suppressClick: false } : s;
      if (s.phase !== "open" || event.button !== 0 || !event.onHandle) return stay(cleared);
      const drag: SwitchDrag = { id: event.id, grab: grabOffset(PIVOT, event.at, s.angle), start: event.client, moved: false };
      return {
        state: { ...cleared, phase: "drag", velocity: 0, last: null, drag },
        commands: [{ kind: "stopFrames" }, { kind: "capture", id: event.id }],
      };
    }
    case "move": {
      const d = s.drag;
      if (d === null || d.id !== event.id) return stay(s);
      if (event.buttonsUp) return endDrag(s, event.id, true);
      if (!d.moved && !isDrag(d.start, event.client)) return stay(s);
      return stay({ ...s, angle: dragAngle(PIVOT, event.at, d.grab), drag: d.moved ? d : { ...d, moved: true } });
    }
    case "release":
      return endDrag(s, event.id, false);
    case "cancel":
      return endDrag(s, event.id, true);
    case "frame": {
      if (s.phase === "spark") {
        const start = s.sparkStart ?? event.t;
        if (event.t - start >= SPARK_MS) return finish(s, []);
        return { state: { ...s, sparkStart: start }, commands: [{ kind: "frame" }] };
      }
      if (s.phase !== "open" && s.phase !== "throw") return stay(s);
      const dt = s.last === null ? 0 : event.t - s.last;
      const next = stepBlade(s, s.target, BLADE_SPRING[s.spring], dt);
      const stepped: SwitchState = { ...s, angle: next.angle, velocity: next.velocity, last: event.t };
      if (!next.done) return { state: stepped, commands: [{ kind: "frame" }] };
      if (s.phase === "throw") return contact(stepped, event.t, []);
      return stay({ ...stepped, last: null });
    }
    case "near": {
      const next: SwitchState =
        event.key === "hovered" ? { ...s, hovered: event.on, near: s.near || event.on } : { ...s, focused: event.on, near: s.near || event.on };
      return next.phase === "open" ? settle(next) : stay(next);
    }
    case "reduced": {
      if (event.on === s.reduced) return stay(s);
      const next: SwitchState = { ...s, reduced: event.on };
      if (!event.on) return stay(next);
      // Motion stops: the blade goes where it was heading, at once.
      if (next.phase === "throw") return contact({ ...next, angle: 0, velocity: 0 }, 0, [{ kind: "stopFrames" }]);
      if (next.phase === "spark") return finish(next, []);
      return next.phase === "open" ? settle(next) : stay(next);
    }
    case "granted":
      if (event.token === null) return stay(s);
      // A grant that comes outside the spark, or a second one, goes straight back.
      if (s.phase !== "spark" || s.token !== null) return { state: s, commands: [{ kind: "release", token: event.token }] };
      return stay({ ...s, token: event.token });
    case "unmount": {
      const commands: SwitchCommand[] = [{ kind: "stopFrames" }];
      if (s.token !== null) commands.push({ kind: "release", token: s.token });
      return { state: { ...s, token: null, drag: null, last: null }, commands };
    }
    default:
      event satisfies never;
      return stay(s);
  }
}
