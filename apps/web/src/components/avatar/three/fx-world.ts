// Prototype franki.html 2076-2201 (section 8: the backdrop, the ground and the dust motes), ported in WP7.
// Allowed edits E1, E3. `mulberry32(909)` for the motes is created inside the factory, as in the prototype's
// block scope. `groundU` is one shared object, never cloned (map A finding 2).
import type * as THREE from "three";
import type { ConfigPart } from "./config";
import { notPorted } from "./errors";
import type { StagePart } from "./stage";
import type { UniformsPart } from "./uniforms";

export type GroundUniform = "uShC" | "uShR" | "uShA" | "uTurn" | "uPoolI" | "uPoolC" | "uPoolC2";

export interface WorldFxPart {
  bgMat: THREE.ShaderMaterial;
  bg: THREE.Mesh;
  groundU: Record<GroundUniform, THREE.IUniform>;
  groundMat: THREE.MeshStandardMaterial;
  ground: THREE.Mesh;
  MOTES: number;
  moteGeo: THREE.BufferGeometry;
  moteMat: THREE.ShaderMaterial;
  motes: THREE.Points;
}

export function createWorldFx(rc: ConfigPart & StagePart & UniformsPart): WorldFxPart {
  return notPorted("createWorldFx", rc);
}
