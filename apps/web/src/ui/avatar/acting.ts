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

/** The §2.2 table for the state looks. `null` pose: the look is an event look, whose pose comes from `follows`. */
const ROWS: Record<LookName, { pose: Pose | null; overlay: Overlay; oneShot: OneShot | null }> = {
  // The wake's own start pose, held: lids shut, glow dim, body sunk (the engine's doze channel).
  Dormant: { pose: "idle", overlay: "dormant", oneShot: null },
  // The wake plays out under the idle base, as the prototype's boot wake does.
  Waking: { pose: "idle", overlay: "none", oneShot: "wake" },
  // The prototype's own mapping: a connecting call acts thinking.
  Connecting: { pose: "thinking", overlay: "none", oneShot: null },
  Listening: { pose: "listening", overlay: "none", oneShot: null },
  Thinking: { pose: "thinking", overlay: "none", oneShot: null },
  Speaking: { pose: "speaking", overlay: "none", oneShot: null },
  // Worried lids and the muted fizzle over idle (art direction §4).
  Recovery: { pose: "idle", overlay: "recovery", oneShot: null },
  // No acting of its own yet: the underlying state's acting.
  Presenting: { pose: null, overlay: "none", oneShot: null },
  // Expectant lids and the nod loop over the underlying state (art direction §5).
  Awaiting_Approval: { pose: null, overlay: "awaiting", oneShot: null },
  Celebrate: { pose: null, overlay: "none", oneShot: "celebrate" },
};

/** The event looks' pose: the state rule `look.ts` already applied, read back from `follows`. */
const FOLLOWS_POSE: Record<AvatarLook["follows"], Pose> = { input: "listening", output: "speaking", none: "thinking" };

/**
 * Pose from the name for state looks; for Presenting, Awaiting_Approval and Celebrate from `look.follows`
 * (input: listening, output: speaking, none: thinking). Overlay, one-shot and the gates as in §2.2.
 */
export function actingFor(look: AvatarLook): Acting {
  const row = ROWS[look.name];
  return {
    name: look.name,
    pose: row.pose ?? FOLLOWS_POSE[look.follows],
    overlay: row.overlay,
    oneShot: row.oneShot,
    ghost: look.ghost,
    // The gates mirror `look.drive`: it is the mic level only when follows is input, the output level only when
    // follows is output. A reply that admission held never opens the voice gate, so it never moves the body.
    mic: look.follows === "input",
    voice: look.follows === "output",
    electric: look.electric,
  };
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
  // Leaving celebrate always cuts; the engine ignores a cut when nothing is playing. The wake has no cut: its
  // tail is a glow multiplier of 1.05 to 1 and no sink, so leaving it early shows nothing.
  const cut = s.oneShot === "celebrate" && next !== "celebrate";
  const command: OneShotCommand = { wake: "none", celebrate: cut ? "cut" : "none" };
  if (next === null) return { state: { oneShot: null, skipped: false }, command };
  if (next === s.oneShot) return { state: { oneShot: next, skipped: s.skipped }, command };
  if (!running) return { state: { oneShot: next, skipped: true }, command };
  if (next === "wake") command.wake = "start";
  else command.celebrate = "start";
  return { state: { oneShot: next, skipped: false }, command };
}
