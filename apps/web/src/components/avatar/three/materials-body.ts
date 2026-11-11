// Prototype franki.html 1036-1304 (section 6: injectCommon, body, prepass, depth, lid, bead and cornea
// materials), ported in WP3. Allowed edits E1, E3, E9. Construction order is part of the look (material ids
// break ties in the opaque sort): bodyMat, bodyPreMat, bodyDepthMat, then the factories, then corneaMat.
// No renderer: node-testable.
import type * as THREE from "three";
import type { ConfigPart } from "./config";
import { notPorted } from "./errors";
import type { UniformsPart } from "./uniforms";

export interface BodyMaterialsPart {
  injectCommon(s: THREE.WebGLProgramParametersWithUniforms, extraVert?: string): void;
  bodyMat: THREE.MeshPhysicalMaterial;
  bodyPreMat: THREE.MeshBasicMaterial;
  bodyDepthMat: THREE.MeshDepthMaterial;
  /** Read by fx-catch.ts at 2516 as well. */
  BEAD_LID: { x: number; y: number; z: number };
  makeLidMat(outer: number): THREE.MeshPhysicalMaterial;
  makeBeadMat(outer: number): THREE.MeshPhysicalMaterial;
  corneaMat: THREE.MeshPhysicalMaterial;
}

export function createBodyMaterials(rc: ConfigPart & UniformsPart): BodyMaterialsPart {
  return notPorted("createBodyMaterials", rc);
}
