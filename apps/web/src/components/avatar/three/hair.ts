// Prototype franki.html 1729-1988 (section 7: the mop, the tufts, the hair prepass and the fur shells), ported in
// WP6. Allowed edits E1, E3, and the merge failures as EngineError("merge"). `hrand = mulberry32(4242)` is
// created inside the factory and drawn in the prototype's order: HAIR_CELLS, then the strict buildHair order.
import type * as THREE from "three";
import type { CharacterPart } from "./character";
import type { ConfigPart } from "./config";
import { notPorted } from "./errors";
import type { HairBrassMaterialsPart } from "./materials-hair-brass";
import type { SurfacePart } from "./surface";
import type { UniformsPart } from "./uniforms";

export interface HairPart {
  HAIR_CELLS: number[];
  PART_TH: number;
  hairEdge(th: number): number;
  hairTmax(ny: number): number;
  buildHairCap(cols?: number, rows?: number): THREE.BufferGeometry;
  TUFT_H: number;
  hairTufts: THREE.BufferGeometry[];
  buildHair(): THREE.BufferGeometry;
  hair: THREE.Mesh;
  hairPreMat: THREE.MeshBasicMaterial;
  hairPre: THREE.Mesh;
  FUR_MAX: number;
  FUR_LEN: number;
  furBase: THREE.BufferGeometry;
  furGeo: THREE.InstancedBufferGeometry;
  furMat: THREE.ShaderMaterial;
  fur: THREE.Mesh;
}

export function createHair(rc: ConfigPart & UniformsPart & HairBrassMaterialsPart & SurfacePart & CharacterPart): HairPart {
  return notPorted("createHair", rc);
}
