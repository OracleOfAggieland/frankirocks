// The acting mapper and the one-shot edge machine for the three.js renderer (brief 013, design note
// docs/briefs/013-design.md §2.2 and §2.5). Pure. The Look_Mapper decides the look; this maps it onto the
// engine's pose, overlay, one-shot and the two audio gates. The engine decides only how to animate.
import type { AvatarLook, LookName } from "./types";

/** A row of the engine's expression table. */
export type Pose = "idle" | "listening" | "thinking" | "speaking";
/** Acting the engine adds over a pose for looks the prototype has no row for. */
export type Overlay = "none" | "dormant" | "recovery" | "awaiting";
export type OneShot = "wake" | "celebrate";

/**
 * What the engine acts, for one look. `mic` and `voice` gate the two audio reads (a closed gate reads silence).
 * `electric` is the look's; the controller ANDs it with the Electricity grant before the engine sees it.
 */
export interface Acting {
  name: LookName;
  pose: Pose;
  overlay: Overlay;
  oneShot: OneShot | null;
  ghost: boolean;
  mic: boolean;
  voice: boolean;
  electric: boolean;
}

/**
 * Pose from the name for state looks; for Presenting, Awaiting_Approval and Celebrate from `look.follows`
 * (input: listening, output: speaking, none: thinking). Overlay, one-shot and the gates as in §2.2.
 */
export function actingFor(look: AvatarLook): Acting {
  return notPorted("actingFor", look);
}

/** What the engine must do with its one-shot playback at this look change. */
export interface OneShotCommand {
  wake: "none" | "start";
  celebrate: "none" | "start" | "cut";
}

export const NO_COMMAND: Readonly<OneShotCommand> = Object.freeze({ wake: "none", celebrate: "none" });

/** The one-shot the look shows, and whether the engine missed its start. */
export interface EdgeState {
  oneShot: OneShot | null;
  skipped: boolean;
}

export const INITIAL_EDGE: Readonly<EdgeState> = Object.freeze({ oneShot: null, skipped: false });

/**
 * One pure step per look. `running` is `seesOneShots(rendererState)`: true exactly in waiting, fading-in, three
 * and fading-out. Entering a one-shot gives `start` when running, otherwise `skipped`. Leaving celebrate gives
 * `cut`, always. Staying in the same one-shot keeps `skipped`. Any non-one-shot clears it.
 */
export function oneShotStep(s: EdgeState, next: OneShot | null, running: boolean): { state: EdgeState; command: OneShotCommand } {
  return notPorted("oneShotStep", s, next, running);
}

function notPorted(name: string, ...inputs: unknown[]): never {
  throw new Error(`${name}: not ported yet (${inputs.length} inputs)`);
}
