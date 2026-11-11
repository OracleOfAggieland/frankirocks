// Prototype franki.html 2531-2753 (section 9: the spring channels, the expression table, blink, gaze, celebrate,
// wake and the mouth driver), ported in WP8. Allowed edits E1, E3, E4 (`T` → `clock.T` at 2577) and the contract
// edits of design note §2.3: `doze: new Chan(0, 4)` and `approve: new Chan(0, 6)` appended to CH (they join
// CH_LIST, not BODY_CH), and `pointerWin` added to `gaze` (2564). The blink, celebrate and wake playback state is
// kept as the prototype has it: it is animation, and its exact beats are part of the look.
import type * as THREE from "three";
import type { Pose } from "../../../ui/avatar/acting";
import type { CharacterPart } from "./character";
import type { ConfigPart } from "./config";
import type { HostPart } from "./context";
import { notPorted } from "./errors";
import type { Chan, RandomPart } from "./math";
import type { ProbesPart } from "./probe";
import type { StagePart } from "./stage";

export type { Pose };

/** The prototype's 52 channels (2534-2547), in its order. */
export type PrototypeChannel =
  | "up" | "lo" | "tilt" | "upAsym" | "pupil"
  | "browLA" | "browLY" | "browLAng" | "browRA" | "browRY" | "browRAng"
  | "rise" | "lean" | "roll" | "yaw" | "pitch" | "lookYaw" | "lookPitch"
  | "thinkMouth" | "glint" | "hairYaw" | "grin"
  | "bob" | "bobF" | "sway" | "rock"
  | "glow" | "rim" | "hue" | "halo" | "glowShift" | "blush"
  | "ghost" | "arc" | "boltE" | "bloom"
  | "mouthVis" | "vsq" | "hemAmp"
  | "gazeX" | "gazeY" | "headSac"
  | "nod" | "hop" | "hemY"
  | "hairRoll" | "hairY"
  | "mC" | "mO" | "mA" | "mE" | "tongue";

/** The two contract channels, appended after the prototype's (§2.3). */
export type ContractChannel = "doze" | "approve";

export type Channels = Record<PrototypeChannel | ContractChannel, Chan>;

/** A row of the expression table ST (2553-2558). brow = [left alpha, y, angle, right alpha, y, angle]. */
export interface Expression {
  up: number; lo: number; tilt: number; upAsym: number; pupil: number; brow: number[];
  rise: number; lean: number; roll: number; yaw: number;
  bob: number; bobF: number; sway: number; rock: number;
  glow: number; rim: number; hue: number; halo: number; glowShift: number; blush: number; boltE: number;
  w: number;
}

export interface Phases { bob: number; sway: number; rock: number; breath: number; hem: number }

export interface GazeState {
  next: number; micro: number; mx: number; my: number; tx: number; ty: number; ox: number; oy: number;
  /** The pointer in the canvas's own NDC, unclamped (contract edit at 3270): the gaze ray points at the real pointer. */
  pointer: THREE.Vector2;
  /** contract: the pointer normalised to the window, as the prototype's 3270 has it; read by the camera parallax (3089). */
  pointerWin: THREE.Vector2;
  lastPointer: number; thinkSide: number; ptrLook: boolean;
}

/** Blink playback: phase 0 open, 1 closing, 2 hold, 3 opening, plus a pending double (2565). */
export interface BlinkState { v: number; phase: number; t: number; next: number; slow: boolean; doubleAt: number; last: number; phraseDone: boolean }

/** Celebrate playback (2566). `fired` holds the beat names already played ('burst', 'blink'). */
export interface CelebState { active: boolean; t0: number; fired: Set<string>; cutAt: number }

/** Wake playback (2567). `fired` holds 'strike'. */
export interface WakeState { active: boolean; t0: number; fired: Set<string> }

export interface MouthDriver {
  dom: number; domT: number; overUntil: number; snapUntil: number; targets: number[];
  lastVoice: number; browLift: number; cm: number; cd: number;
}

export interface FxState { startleT: number; motePush: number; lastNod: number; nextFizzle: number; heat: number }

/** celebCurves' one reused output object (2674). */
export interface CelebOffsets {
  dy: number; sy: number; nubL: number; nubP: number; roll: number; cres: number; glow: number; halo: number;
  blush: number; brow: number; pupil: number; hue: number; up: number; bloom: number;
}

/** wakeCurves' one reused output object (2702). */
export interface WakeOffsets { closed: number; glow: number; sink: number }

export interface RigPart {
  CH: Channels;
  CH_LIST: Chan[];
  BODY_CH: string[];
  POSE_CH: Set<string>;
  ST: Record<Pose, Expression>;
  MOUTH_K: number;
  MOUTH_SHAPES: number[][];
  ph: Phases;
  gaze: GazeState;
  blink: BlinkState;
  celeb: CelebState;
  wake: WakeState;
  mouthDrv: MouthDriver;
  fxState: FxState;
  scheduleBlink(t: number, state: Pose): void;
  triggerBlink(slow?: boolean): void;
  updateBlink(t: number, dt: number, state: Pose): void;
  GAZE_MAX: number;
  gazeToward(world: THREE.Vector3, out: { x: number; y: number }): { x: number; y: number };
  headLookAt(world: THREE.Vector3 | null): void;
  updateGaze(t: number, state: Pose, muted: boolean): void;
  CELEB_RISE: number;
  celebCurves(tc: number, wgt?: number): CelebOffsets;
  startCelebrate(t: number): void;
  CELEB_CUT: number;
  wakeCurves(tw: number): WakeOffsets;
  updateMouth(t: number, dt: number, speaking: boolean, thinking: boolean): number;
}

export function createRig(rc: HostPart & ConfigPart & RandomPart & ProbesPart & StagePart & CharacterPart): RigPart {
  return notPorted("createRig", rc);
}
