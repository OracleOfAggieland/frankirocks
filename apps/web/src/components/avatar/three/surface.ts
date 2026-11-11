// Prototype franki.html 1423-1530 (section 7: the profile, the surface math and the body geometry), ported in
// WP4. Pure CPU with three.js math only: node-testable. Allowed edits E1, E3.
import type * as THREE from "three";
import { notPorted } from "./errors";

export interface SurfacePart {
  /** [r, y] pairs (1428). */
  PROFILE_PTS: number[][];
  TOP_SQUASH: number;
  profileCurve: THREE.CatmullRomCurve3;
  NP: number;
  NR: number;
  PROFILE: THREE.Vector3[];
  DENSE: THREE.Vector3[];
  DENSE_MAX: number;
  EYE_TH: number;
  profileRAtY(y: number): number;
  deform(th: number, r: number, y: number, out: THREE.Vector3, sockets: boolean): THREE.Vector3;
  surfaceAt(th: number, y: number, out?: THREE.Vector3, sockets?: boolean): THREE.Vector3;
  surfaceNormal(th: number, y: number, out?: THREE.Vector3): THREE.Vector3;
  solveXY(tx: number, ty: number): { th: number; y: number };
  solveArc(u: number, v: number): { th: number; y: number };
  arcOf(p: THREE.Vector3): THREE.Vector2;
  buildBodyGeometry(): THREE.BufferGeometry;
}

export function createSurface(): SurfacePart {
  return notPorted("createSurface");
}
