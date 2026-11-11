// Prototype franki.html 2755-2862 without 2760-2778 (listenState, startle and the cheer are not ported), ported in
// WP8. Allowed edits E1, E3, E5 and the contract edits of design note §2.3: resolveState takes the base from
// `targets.pose` (the call, sim, Listen and voice-gate branches and `ui.setTag` are removed), still mode mirrors the
// prototype's `?state=` paths through stillOverride, and a block is appended after the verbatim setTargets body.
// applyTargets and endOneShots are new. `targets` is a holder: written only by applyTargets, in place.
import type { Acting, OneShotCommand, Pose } from "../../../ui/avatar/acting";
import type { ConfigPart } from "./config";
import type { HostPart } from "./context";
import { notPorted } from "./errors";
import type { LightningPart } from "./fx-lightning";
import type { ProbesPart } from "./probe";
import type { RigPart } from "./rig";

/** What the badge would read: a pose or one of the two overlays. */
export type Shown = Pose | "muted" | "celebrate";

export interface StateMemo {
  /** Null in the app. In still mode, stillOverride(targets) each frame, so still frames take the prototype's paths. */
  override: Shown | null;
  /** A memo of targets.pose: a change retunes the spring omegas and fires the change blink. */
  base: Pose;
  shown: Shown;
  since: number;
  lastCelebLoop: number;
}

export interface StatePart {
  sm: StateMemo;
  /** contract: 'muted' for ghost, 'celebrate' for the celebrate one-shot, otherwise the pose. Read only when STILL. */
  stillOverride(acting: Acting): Shown;
  resolveState(t: number): { base: Pose; muted: boolean };
  /** Verbatim 2816-2862, then the appended contract block (§2.3). */
  setTargets(t: number, dt: number, base: Pose, muted: boolean): void;
  /** contract: Object.assign(targets, next), then the one-shot command at clock.T. Commands are ignored when STILL. */
  applyTargets(next: Acting, command: OneShotCommand): void;
  /** contract: ends celebrate and wake playback at once (settle only): `celeb.active = false; celeb.cutAt = -1; wake.active = false`. */
  endOneShots(): void;
}

export function createState(rc: HostPart & ConfigPart & ProbesPart & RigPart & LightningPart): StatePart {
  return notPorted("createState", rc);
}
