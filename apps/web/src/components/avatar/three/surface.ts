// Prototype franki.html 1423-1530 (section 7: the profile, the surface math and the body geometry), ported in
// WP4. Pure CPU with three.js math only: node-testable. Allowed edits E1, E3.
// The scratch vectors `_sa`, `_sb` and `_sc` live inside the factory, one set per engine. `_sc` is shared by
// surfaceNormal, solveXY and solveArc exactly as in the prototype.
import * as THREE from "three";
import { EYE_X, EYE_Y } from "./config";
import { angDist, clamp, gauss, lerp, smooth } from "./math";

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
  /* =====================================================================
     7. CHARACTER BUILD (all procedural, built once)
     ===================================================================== */
  /* Body profile (radius, height), bottom pole to top pole; Catmull-Rom smoothed, then lathed by hand. */
  // A taller gumdrop than a block: walls lean in gently toward a domed head with round shoulders (height:width about 1.35 with the hair).
  const PROFILE_PTS = [[0.001, 0.12], [0.16, 0.085], [0.30, 0.03], [0.48, 0.04], [0.63, 0.10], [0.72, 0.18], [0.755, 0.30], [0.752, 0.50],
    [0.725, 0.75], [0.69, 1.00], [0.662, 1.25], [0.632, 1.45], [0.585, 1.60], [0.50, 1.705], [0.35, 1.77], [0.001, 1.80]];
  const TOP_SQUASH = 0.75;                                          // the flat top, softened
  const profileCurve = new THREE.CatmullRomCurve3(PROFILE_PTS.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'catmullrom', 0.5);
  const NP = 200, NR = 160;
  const PROFILE = profileCurve.getSpacedPoints(NP - 1);
  const DENSE = profileCurve.getSpacedPoints(2400);
  const DENSE_MAX = DENSE.reduce((best, p, i) => (p.x > DENSE[best].x ? i : best), 0);

  /** Radius of the undeformed profile at height y (upper, monotonic part), by binary search. */
  function profileRAtY(y: number) {
    let lo = DENSE_MAX, hi = DENSE.length - 1;
    if (y <= DENSE[lo].y) return DENSE[lo].x;
    if (y >= DENSE[hi].y) return 0.001;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (DENSE[mid].y < y) lo = mid; else hi = mid; }
    const a = DENSE[lo], b = DENSE[hi];
    return lerp(a.x, b.x, (y - a.y) / Math.max(1e-6, b.y - a.y));
  }

  const EYE_TH = Math.asin(EYE_X / 0.69);
  /** Static sculpt: flat top, hem lobes, arm nubs, eye sockets, elliptic section, flatter face panel, soft brow. */
  function deform(th: number, r: number, y: number, out: THREE.Vector3, sockets: boolean) {
    const y0 = y;
    if (y > 1.70) y = 1.70 + (y - 1.70) * TOP_SQUASH;
    const w = (1 - smooth(0.02, 0.30, y)) * smooth(0.15, 0.6, r);
    if (w > 0) {
      const lobe = 0.5 + 0.5 * Math.cos(5 * th);                   // five lobes; the one facing the camera hangs lowest
      const depth = 1 - 0.3 * Math.exp(-((angDist(th, 2.51) / 0.5) ** 2));
      y -= w * 0.15 * lobe * depth;                                // the art's hem: round lobes with real notches between them
      r *= 1 + w * (0.09 * lobe - 0.04);
    }
    for (let s = -1; s <= 1; s += 2) {                             // stubby arm lobes; the viewer-left one (-X) is the big one, as in the art
      r += (s < 0 ? 0.24 : 0.11) * Math.exp(-((angDist(th, s * 1.75) / (s < 0 ? 0.34 : 0.30)) ** 2)) * gauss(y, 0.60, y < 0.60 ? 0.13 : 0.21);
    }
    if (sockets) {
      for (let s = -1; s <= 1; s += 2) {
        const e = Math.hypot(((th - s * EYE_TH) * 0.69) / 0.12, (y - EYE_Y) / 0.21);
        r -= 0.012 * (1 - smooth(0.55, 1.25, e));
      }
    }
    const c = Math.cos(th), sn = Math.sin(th);
    let z = r * c * 0.86;
    z += 0.05 * smooth(1.0, 1.5, y) * Math.max(0, c) * (1 - smooth(1.70, 1.80, y0));
    z += 0.011 * gauss(y, 1.43, 0.10) * smooth(0.9, 0.2, Math.abs(th) / 1.2);   // a broad soft brow: fullness, never a crease
    return out.set(r * sn, y, z);
  }

  const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sc = new THREE.Vector3();
  const surfaceAt = (th: number, y: number, out = new THREE.Vector3(), sockets = false) => deform(th, profileRAtY(y), y, out, sockets);
  function surfaceNormal(th: number, y: number, out = new THREE.Vector3()) {
    const e = 1e-3;
    surfaceAt(th + e, y, _sa); surfaceAt(th - e, y, _sb); _sa.sub(_sb);
    surfaceAt(th, y + e, _sb); surfaceAt(th, y - e, _sc); _sb.sub(_sc);
    return out.crossVectors(_sa, _sb).normalize();                 // d/dtheta x d/dy points outward
  }
  /** (theta, y) of the front surface point whose object-space x, y match. */
  function solveXY(tx: number, ty: number) {
    let th = Math.asin(clamp(tx / 0.69, -1, 1)), y = ty;
    for (let k = 0; k < 14; k++) {
      surfaceAt(th, y, _sc);
      th += (tx - _sc.x) / Math.max(0.2, Math.hypot(_sc.x, _sc.z / 0.86) * Math.cos(th));
      y += ty - _sc.y;
    }
    return { th, y };
  }
  /** (theta, y) of the surface point with the arc coordinates the body shader uses: (atan(x, z/0.86) * 0.69, y). */
  function solveArc(u: number, v: number) {
    let th = u / 0.69, y = v;
    for (let k = 0; k < 14; k++) {
      surfaceAt(th, y, _sc);
      th += (u - Math.atan2(_sc.x, _sc.z / 0.86) * 0.69) / 0.69;
      y += v - _sc.y;
    }
    return { th, y };
  }
  const arcOf = (p: THREE.Vector3) => new THREE.Vector2(Math.atan2(p.x, p.z / 0.86) * 0.69, p.y);

  function buildBodyGeometry() {
    const rings = NP - 2, count = rings * NR + 2;
    const pos = new Float32Array(count * 3), v = new THREE.Vector3();
    let k = 0;
    const put = () => { pos[k++] = v.x; pos[k++] = v.y; pos[k++] = v.z; };
    v.set(0, PROFILE[0].y, 0); put();
    for (let i = 1; i <= rings; i++) {
      for (let j = 0; j < NR; j++) { deform((j / NR) * 2 * Math.PI - Math.PI, PROFILE[i].x, PROFILE[i].y, v, true); put(); }
    }
    v.set(0, 1.70 + (PROFILE[NP - 1].y - 1.70) * TOP_SQUASH, 0); put();
    const ring = (i: number, j: number) => 1 + (i - 1) * NR + (((j % NR) + NR) % NR);
    const top = count - 1, idx = [] as number[];
    for (let j = 0; j < NR; j++) idx.push(0, ring(1, j + 1), ring(1, j));
    for (let i = 1; i < rings; i++) {
      for (let j = 0; j < NR; j++) {
        const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j), d = ring(i + 1, j + 1);
        idx.push(a, b, d, a, d, c);
      }
    }
    for (let j = 0; j < NR; j++) idx.push(top, ring(rings, j), ring(rings, j + 1));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  return {
    PROFILE_PTS, TOP_SQUASH, profileCurve, NP, NR, PROFILE, DENSE, DENSE_MAX, EYE_TH,
    profileRAtY, deform, surfaceAt, surfaceNormal, solveXY, solveArc, arcOf, buildBodyGeometry,
  };
}
