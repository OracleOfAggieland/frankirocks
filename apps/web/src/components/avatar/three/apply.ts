// Prototype franki.html 2864-3109 (section 11: applyRig, applyWorldFX, updateFX and the camera), ported in WP9.
// Allowed edits E1, E3, E5 and the contract edits of design note §2.3 (doze at 2919, 2945 and 2965; the approve nod
// at 2934 and 2938; the fizzle gate at 3078 takes `(muted || targets.overlay === 'recovery')`), plus the pointer
// edit at 3089: the camera parallax reads `gaze.pointerWin`. `_proj` (2868) is also re-declared in loop.ts (E11).
import type { Pose } from "../../../ui/avatar/acting";
import type { Rig } from "./context";
import { notPorted } from "./errors";
import type { LoopPart } from "./loop";
import type { QualityPart } from "./quality";

export interface RigOut { glow: number; bodyY: number; ghost: number; halo: number }

export interface CamState { px: number; py: number; fy: number; dist: number }

export interface ApplyPart {
  TIME_WRAP: number;
  applyRig(t: number, dt: number, base: Pose, muted: boolean): void;
  rigOut: RigOut;
  applyWorldFX(t: number, dt: number): void;
  updateFX(t: number, dt: number, base: Pose, muted: boolean): void;
  camState: CamState;
  updateCamera(t: number, dt: number): void;
}

export function createApply(rc: Omit<Rig, keyof ApplyPart | keyof QualityPart | keyof LoopPart>): ApplyPart {
  return notPorted("createApply", rc);
}
