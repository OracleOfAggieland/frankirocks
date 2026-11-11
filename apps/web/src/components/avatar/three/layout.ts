// Where the ghost lands inside the canvas (new code, ported in WP10). Pure three.js math, node-testable. The
// canvas box itself is CANVAS_FRAME in ../canvas-frame.ts, which imports nothing, so ThreeGhost can read it at
// first render without pulling three.js into the page.
//
// The silhouette is sampled, not measured from a render: the body comes from the ported surface math (the
// profile 1428 through deform 1449-1473, nubs and hem lobes included), and the mop is the body above its
// hairline pushed out along the surface normal by the cap's largest thickness (hairTmax 1759 plus the largest
// clump terms 1782-1784, as `off` at 1785). The framing is the prototype's at rest: resize() (3424-3426) with no dock, and
// updateCamera (3095-3105) with no pointer, no drift and no hop. The bolts stick out past the nubs and are left
// out, as is the electricity. It is an estimate for I3's calibration, not a pixel measurement.
import * as THREE from "three";
import type { CanvasFrame } from "../canvas-frame";
import { DEG, HOVER, TURN } from "./config";
import { clamp, gauss, lerp, smooth } from "./math";
import { createSurface } from "./surface";

export type { CanvasFrame };

/** Fractions of the canvas, top-left origin. */
export interface GhostBounds { top: number; bottom: number; left: number; right: number }

/** The prototype camera (822-826): fov 30, CAM_BASE (0.35, 1.52, 6.4), CAM_LOOK (0, 1.30, 0). */
const FOV = 30;
const CAM_BASE = new THREE.Vector3(0.35, 1.52, 6.4);
const CAM_LOOK = new THREE.Vector3(0, 1.30, 0);

/** The base of hairEdge (1737-1738) without its clumps: the highest the hairline sits at angle th. */
function hairlineBase(th: number): number {
  const a = Math.abs(th);
  const y = a < 1.2 ? 1.73 : a < 1.75 ? lerp(1.73, 1.62, smooth(1.2, 1.6, a)) : lerp(1.62, 1.555, smooth(1.75, 2.6, a));
  return y + 0.035 * gauss(a, Math.PI / 2, 0.22);
}

/** The mop's largest offset along the normal: hairTmax (1759) plus the three clump terms (1782-1784) at their peaks. */
const hairThickness = (ny: number) => 0.07 + 0.16 * Math.pow(clamp(ny), 0.95) + 0.012 + 0.004 + 0.016;

const TH_STEPS = 144;
const Y_STRIDE = 8;

/**
 * The rest silhouette (hem tip to hair top, nub to nub) projected through the prototype camera at this aspect, in
 * fractions of the canvas. I3 uses it with CANVAS_FRAME to land the 3D silhouette on the SVG silhouette.
 */
export function ghostBounds(aspect: number): GhostBounds {
  const { DENSE, DENSE_MAX, deform, surfaceNormal } = createSurface();
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 60);
  camera.aspect = aspect;
  const fit = 1.25 / (Math.tan((camera.fov * DEG) / 2) * camera.aspect);
  const dist = Math.max(CAM_BASE.z, fit * 1.12);
  camera.updateProjectionMatrix();
  camera.position.set(CAM_BASE.x, CAM_BASE.y, dist);
  camera.lookAt(CAM_LOOK.x, CAM_LOOK.y, CAM_LOOK.z);
  camera.updateMatrixWorld();

  const root = new THREE.Matrix4().makeRotationY(TURN).setPosition(0, HOVER, 0);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const take = (v: THREE.Vector3) => {
    v.applyMatrix4(root).project(camera);
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  };
  const last = DENSE.length - 1;
  for (let j = 0; j < TH_STEPS; j++) {
    const th = (j / TH_STEPS) * 2 * Math.PI - Math.PI;
    const ye = hairlineBase(th);
    for (let i = 0; ; i = Math.min(i + Y_STRIDE, last)) {
      const d = DENSE[i];
      deform(th, d.x, d.y, p, false);
      take(p);
      if (i >= DENSE_MAX && d.y >= ye) {
        deform(th, d.x, d.y, p, false);
        // The hair cap grows along the body normal (buildHairCap 1761-1786); near the pole it is straight up.
        if (d.y >= 1.79) n.set(0, 1, 0);
        else surfaceNormal(th, d.y, n);
        p.addScaledVector(n, hairThickness(n.y));
        take(p);
      }
      if (i === last) break;
    }
  }
  return {
    top: (1 - maxY) * 0.5,
    bottom: (1 - minY) * 0.5,
    left: (minX + 1) * 0.5,
    right: (maxX + 1) * 0.5,
  };
}
