// Prototype franki.html 1590-1727 (section 7: bolts, staples, the merged brass mesh) and 1990-1993 (the brass
// prepass, built after the fur as in the prototype), ported in WP5. Allowed edits E1, E3, and the merge failure
// as EngineError("merge"). Writes U.uBoltC (1696) and U.uHoles (1720); adds the two bolt lights to headInner.
// The `aPart` ids stay as numbered.
import type * as THREE from "three";
import type { CharacterPart } from "./character";
import type { ConfigPart } from "./config";
import { notPorted } from "./errors";
import type { HairBrassMaterialsPart } from "./materials-hair-brass";
import type { SurfacePart } from "./surface";
import type { UniformsPart } from "./uniforms";

export interface Bolt {
  side: number;
  base: THREE.Vector3;
  axis: THREE.Vector3;
  tip: THREE.Vector3;
  rim: THREE.Vector3;
  light: THREE.PointLight;
  flash: number;
}

export interface BrassPart {
  bolts: Bolt[];
  BOLT_R: number;
  BOLT_L: number;
  STAPLE_ARC: number;
  STAPLE_R: number;
  STAPLE_TUBE: number;
  boltGeometry(): THREE.BufferGeometry;
  stapleGeometry(): THREE.BufferGeometry;
  scarAt(t: number): THREE.Vector2;
  brassGeo: THREE.BufferGeometry;
  brass: THREE.Mesh;
}

export function createBrass(rc: ConfigPart & UniformsPart & HairBrassMaterialsPart & SurfacePart & CharacterPart): BrassPart {
  return notPorted("createBrass", rc);
}

export interface BrassPrePart {
  brassPreMat: THREE.MeshBasicMaterial;
  brassPre: THREE.Mesh;
}

/** 1990-1993: built after the fur, as in the prototype. */
export function createBrassPre(rc: CharacterPart & BrassPart): BrassPrePart {
  return notPorted("createBrassPre", rc);
}
