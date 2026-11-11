// Prototype franki.html 2447-2529 (section 8: the catch-lights), ported in WP7. Allowed edits E1, E3, and E11:
// `_view` (declared at 2409 in fx-lightning.ts) is re-declared here, because every use writes it before reading
// it. Reads BEAD_LID (2516). Its JS copy of fk_lidTop/fk_lidBot (2517) stays in step with glsl.ts (map A
// finding 5). updateCatchLights runs after the frame's one scene.updateMatrixWorld().
import type * as THREE from "three";
import type { CharacterPart } from "./character";
import { notPorted } from "./errors";
import type { BodyMaterialsPart } from "./materials-body";
import type { StagePart } from "./stage";

export interface CatchPart {
  CATCH_N: number;
  catchGeo: THREE.BufferGeometry;
  catchMat: THREE.ShaderMaterial;
  catchMesh: THREE.Mesh;
  CORNEA: THREE.Vector3;
  updateCatchLights(): void;
}

export function createCatch(rc: StagePart & BodyMaterialsPart & CharacterPart): CatchPart {
  return notPorted("createCatch", rc);
}
