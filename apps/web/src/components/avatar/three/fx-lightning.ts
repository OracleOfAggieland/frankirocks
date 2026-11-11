// Prototype franki.html 2312-2445 (section 8: the arc buffer, jag, the `arcs` object, writeRibbons), ported in
// WP7. Allowed edits E1, E3. `arcs` keeps its `this` methods. `arcPrevI` is a closure `let` of this factory.
// `_view` (2409) is also re-declared in fx-catch.ts (E11). Draws from the one `rnd` stream in the prototype's order.
import type * as THREE from "three";
import type { BrassPart } from "./brass";
import type { CharacterPart } from "./character";
import type { ConfigPart } from "./config";
import { notPorted } from "./errors";
import type { RandomPart } from "./math";
import type { StagePart } from "./stage";

/** One polyline of the standing arc (2371-2393). */
export interface Strip {
  pts: THREE.Vector3[];
  w: number;
  k: number;
  root?: boolean;
}

/** A one-shot arc (celebrate, wake), alive for `dur` seconds (2402-2405). */
export interface ArcShot {
  from: THREE.Vector3;
  to: THREE.Vector3;
  born: number;
  dur: number;
  w: number;
  pts: THREE.Vector3[];
  next: number;
}

export interface Arcs {
  main: Strip[];
  prev: Strip[];
  fx: ArcShot[];
  lastRegen: number;
  nextRegen: number;
  env: number;
  mid: THREE.Vector3;
  ctrl(): THREE.Vector3[];
  regen(t: number, smoothOnly: boolean): void;
  shot(from: THREE.Vector3, to: THREE.Vector3, dur: number, t: number, w?: number): void;
}

/** A ribbon descriptor from updateFX's reused pool (3049, 3062-3065). Its first `pts` is written `null!` (E1). */
export interface Ribbon {
  pts: THREE.Vector3[];
  w: number;
  k: number;
  root?: boolean;
}

export interface LightningPart {
  ARC_MAXP: number;
  arcGeo: THREE.BufferGeometry;
  arcMat: THREE.ShaderMaterial;
  arcMesh: THREE.Mesh;
  jag(a: THREE.Vector3, b: THREE.Vector3, gens: number, rough: number): THREE.Vector3[];
  UPV: THREE.Vector3;
  arcs: Arcs;
  writeRibbons(list: readonly Ribbon[]): void;
}

export function createLightning(rc: ConfigPart & RandomPart & StagePart & CharacterPart & BrassPart): LightningPart {
  return notPorted("createLightning", rc);
}
