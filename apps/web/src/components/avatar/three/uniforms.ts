// Prototype franki.html 954-969 (`V3`, `U`), 1307-1310 (`hairU`) and 1384 (`brassU`), ported in WP3. Moved ahead
// of the materials unchanged: they hold no object with a three.js id, so the move changes no sort order. The
// bags are shared by reference with every material that reads them (map A finding 2): never clone or rebuild them.
// Allowed edits E1, E3.
import * as THREE from "three";
import { C, COL, HEAD_PIVOT } from "./config";

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
  const V3 = () => new THREE.Vector3();
  const U = {
    uTime: { value: 0 }, uHemAmp: { value: 0.012 }, uHemPhase: { value: 0 }, uHemLag: { value: 0 }, uBreath: { value: 0 },
    uNub: { value: new THREE.Vector4() }, uHeadRot: { value: new THREE.Matrix3() }, uHeadPivot: { value: HEAD_PIVOT },
    uGlow: { value: 1 }, uRim: { value: 1 }, uHue: { value: 0 }, uGhost: { value: 0 }, uGlowShift: { value: 0 },
    uNoiseAmt: { value: 0.0025 }, uBlush: { value: 0 }, uThink: { value: 0 }, uLidCover: { value: 0 }, uLidShut: { value: 0 },
    uBrowL: { value: V3() }, uBrowR: { value: V3() },
    uEyeC: { value: [V3(), V3()] }, uBoltC: { value: [V3(), V3()] },
    uHoles: { value: Array.from({ length: 6 }, () => new THREE.Vector2()) },
    uScarA: { value: new THREE.Vector2(0.12, 1.585) }, uScarB: { value: new THREE.Vector2(0.33, 1.53) }, uScarC: { value: new THREE.Vector2(0.52, 1.40) },   // clear of the fringe, slanting down toward the bolt
    uKeyDirV: { value: V3() }, uRimDirV: { value: V3() },
    uSssCol: { value: C(COL.sss) }, uCoreCol: { value: C(COL.core) }, uRimHem: { value: C(COL.rimHem) }, uRimTop: { value: C(COL.rimTop) },
    uThinkCol: { value: C(COL.gold) }, uGhostCol: { value: C(COL.ghostCool) }, uShadowCol: { value: C(COL.shadow) },
    uBlushCol: { value: C(COL.blush) }, uBrowCol: { value: C(COL.brow) },
    uScarCut: { value: C(COL.scarCut) }, uScarGroove: { value: C(COL.scarGroove) }, uWeltCol: { value: C(COL.welt) }, uHoleCol: { value: C(COL.hole) },
  };
  const hairU = {
    uHairLag: { value: V3() }, uHairA: { value: 1 }, uKeyI: { value: 1 },
    uHairRoot: { value: C(COL.hairRoot) }, uHairMid: { value: C(COL.hairMid) }, uHairTip: { value: C(COL.hairTip) }, uBounce: { value: C(COL.hairBounce) },
  };
  const brassU = { uBrassA: { value: 1 }, uGlint: { value: 0 }, uGlintPhase: { value: 0 }, uBrassHi: { value: C(COL.brassHi) } };
  return { V3, U, hairU, brassU };
}
