// Prototype franki.html 954-969 (`V3`, `U`), 1307-1310 (`hairU`) and 1384 (`brassU`), ported in WP3. Moved ahead
// of the materials unchanged: they hold no object with a three.js id, so the move changes no sort order. The
// bags are shared by reference with every material that reads them (map A finding 2): never clone or rebuild them.
// Allowed edits E1, E3.
import type * as THREE from "three";
import { notPorted } from "./errors";

/** The 41 names of `U`, in the prototype's order. */
export type BodyUniform =
  | "uTime" | "uHemAmp" | "uHemPhase" | "uHemLag" | "uBreath"
  | "uNub" | "uHeadRot" | "uHeadPivot"
  | "uGlow" | "uRim" | "uHue" | "uGhost" | "uGlowShift"
  | "uNoiseAmt" | "uBlush" | "uThink" | "uLidCover" | "uLidShut"
  | "uBrowL" | "uBrowR"
  | "uEyeC" | "uBoltC"
  | "uHoles"
  | "uScarA" | "uScarB" | "uScarC"
  | "uKeyDirV" | "uRimDirV"
  | "uSssCol" | "uCoreCol" | "uRimHem" | "uRimTop"
  | "uThinkCol" | "uGhostCol" | "uShadowCol"
  | "uBlushCol" | "uBrowCol"
  | "uScarCut" | "uScarGroove" | "uWeltCol" | "uHoleCol";

export type HairUniform = "uHairLag" | "uHairA" | "uKeyI" | "uHairRoot" | "uHairMid" | "uHairTip" | "uBounce";
export type BrassUniform = "uBrassA" | "uGlint" | "uGlintPhase" | "uBrassHi";

export interface UniformsPart {
  V3(): THREE.Vector3;
  U: Record<BodyUniform, THREE.IUniform>;
  hairU: Record<HairUniform, THREE.IUniform>;
  brassU: Record<BrassUniform, THREE.IUniform>;
}

/** Needs only module constants (COL, HEAD_PIVOT, C). */
export function createUniforms(): UniformsPart {
  return notPorted("createUniforms");
}
