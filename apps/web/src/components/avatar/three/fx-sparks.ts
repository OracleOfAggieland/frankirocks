// Prototype franki.html 2203-2310 (section 8: the spark pool, its instanced mesh, emitSparks, updateSparks),
// ported in WP7. Allowed edits E1, E3. The scratch vectors (_w1.._w4) live in this factory. Draws from the one
// `rnd` stream in the prototype's order.
import type * as THREE from "three";
import type { Bolt } from "./brass";
import type { CharacterPart } from "./character";
import type { ConfigPart } from "./config";
import { notPorted } from "./errors";
import type { RandomPart } from "./math";
import type { StagePart } from "./stage";

/** The CPU spark pool (2205-2209). */
export interface SparkPool {
  n: number;
  cap: number;
  prevN: number;
  pos: Float32Array<ArrayBuffer>;
  vel: Float32Array<ArrayBuffer>;
  life: Float32Array<ArrayBuffer>;
  bounce: Uint8Array<ArrayBuffer>;
  /** Per spark: brightness, size. */
  look: Float32Array<ArrayBuffer>;
}

export interface SparksPart {
  SPARK_MAX: number;
  spark: SparkPool;
  sparkGeo: THREE.InstancedBufferGeometry;
  sparkMat: THREE.ShaderMaterial;
  sparks: THREE.Mesh;
  UP_AXIS: THREE.Vector3;
  RIGHT_AXIS: THREE.Vector3;
  emitSparks(b: Bolt, count: number, power?: number, dim?: number, size?: number): void;
  updateSparks(dt: number): void;
}

export function createSparks(rc: ConfigPart & RandomPart & StagePart & CharacterPart): SparksPart {
  return notPorted("createSparks", rc);
}
