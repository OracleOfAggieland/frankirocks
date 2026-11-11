// Prototype franki.html 1306-1421 without `hairU` (1307-1310) and `brassU` (1384), which live in uniforms.ts:
// hairMat, makeBrushTexture, brushTex, brassMat. Ported in WP3. Allowed edits E1, E3, E9. The brush texture
// draws on a 2D canvas and reads renderer.capabilities, so this factory needs the stage.
import type * as THREE from "three";
import type { ConfigPart } from "./config";
import { notPorted } from "./errors";
import type { StagePart } from "./stage";
import type { UniformsPart } from "./uniforms";

export interface HairBrassMaterialsPart {
  hairMat: THREE.MeshPhysicalMaterial;
  makeBrushTexture(): THREE.CanvasTexture;
  brushTex: THREE.CanvasTexture;
  brassMat: THREE.MeshPhysicalMaterial;
}

export function createHairBrassMaterials(rc: ConfigPart & UniformsPart & StagePart): HairBrassMaterialsPart {
  return notPorted("createHairBrassMaterials", rc);
}
