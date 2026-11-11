// Prototype franki.html 1995-2074 (section 7: the mouth), ported in WP6. Allowed edits E1, E3.
import type * as THREE from "three";
import type { CharacterPart } from "./character";
import type { ConfigPart } from "./config";
import { notPorted } from "./errors";
import type { SurfacePart } from "./surface";
import type { UniformsPart } from "./uniforms";

export interface MouthPart {
  buildMouthGeometry(): THREE.BufferGeometry;
  mouthMat: THREE.ShaderMaterial;
  mouth: THREE.Mesh;
}

export function createMouth(rc: ConfigPart & UniformsPart & SurfacePart & CharacterPart): MouthPart {
  return notPorted("createMouth", rc);
}
