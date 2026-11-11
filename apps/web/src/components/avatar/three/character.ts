// Prototype franki.html 1532-1588 (section 7: the scene graph, the body meshes, glowLight and the eyes), ported in
// WP4. Allowed edits E1, E3. Per eye, the bead material is made before the lid material, left eye first.
// Writes U.uEyeC (1588). Keeps the uEyeO line exactly as the prototype has it: inside the comment, never run
// (map A finding 1).
import type * as THREE from "three";
import type { ConfigPart } from "./config";
import { notPorted } from "./errors";
import type { BodyMaterialsPart } from "./materials-body";
import type { StagePart } from "./stage";
import type { SurfacePart } from "./surface";
import type { UniformsPart } from "./uniforms";

export interface Eye {
  side: number;
  socket: THREE.Group;
  ball: THREE.Group;
  bead: THREE.Mesh;
  beadMat: THREE.MeshPhysicalMaterial;
  lidMat: THREE.MeshPhysicalMaterial;
  center: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface CharacterPart {
  root: THREE.Group;
  tiltG: THREE.Group;
  tiltIn: THREE.Group;
  squashG: THREE.Group;
  content: THREE.Group;
  head: THREE.Group;
  headInner: THREE.Group;
  bodyGeo: THREE.BufferGeometry;
  bodyPre: THREE.Mesh;
  body: THREE.Mesh;
  glowLight: THREE.PointLight;
  sphereGeo: THREE.SphereGeometry;
  BEAD: THREE.Vector3;
  eyes: Eye[];
}

export function createCharacter(rc: ConfigPart & StagePart & UniformsPart & BodyMaterialsPart & SurfacePart): CharacterPart {
  return notPorted("createCharacter", rc);
}
