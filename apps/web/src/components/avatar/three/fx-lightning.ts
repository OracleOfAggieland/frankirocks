// Prototype franki.html 2312-2445 (section 8: the arc buffer, jag, the `arcs` object, writeRibbons), ported in
// WP7. Allowed edits E1, E3. `arcs` keeps its `this` methods. `arcPrevI` is a closure `let` of this factory.
// `_view` (2409) is also re-declared in fx-catch.ts (E11). Draws from the one `rnd` stream in the prototype's order.
import * as THREE from "three";
import type { BrassPart } from "./brass";
import type { CharacterPart } from "./character";
import { C, COL, type ConfigPart } from "./config";
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
  const { STILL, REDUCED, rnd, scene, camera, headInner, bolts } = rc;

/* Lightning: midpoint-displaced polylines in head space, written each frame as camera-facing HDR ribbons into one buffer. */
const ARC_MAXP = 1800;
const arcGeo = new THREE.BufferGeometry();
const arcPos = new Float32Array(ARC_MAXP * 2 * 3), arcUv = new Float32Array(ARC_MAXP * 2 * 2), arcI = new Float32Array(ARC_MAXP * 2), arcIdx = new Uint16Array(ARC_MAXP * 6);
arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3).setUsage(THREE.DynamicDrawUsage));
arcGeo.setAttribute('aUV', new THREE.BufferAttribute(arcUv, 2).setUsage(THREE.DynamicDrawUsage));
arcGeo.setAttribute('aI', new THREE.BufferAttribute(arcI, 1).setUsage(THREE.DynamicDrawUsage));
arcGeo.setIndex(new THREE.BufferAttribute(arcIdx, 1).setUsage(THREE.DynamicDrawUsage));
arcGeo.setDrawRange(0, 0);
const arcMat = new THREE.ShaderMaterial({
  uniforms: { uCore: { value: C(COL.spark) }, uMid: { value: C(COL.gold) }, uOuter: { value: C(COL.arcOuter) }, uEdge: { value: C(COL.arcEdge) } },
  vertexShader: 'attribute vec2 aUV; attribute float aI; varying vec2 vUv; varying float vI; void main(){ vUv = aUV; vI = aI; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform vec3 uCore, uMid, uOuter, uEdge; varying vec2 vUv; varying float vI;
    void main(){
      float d = abs(vUv.y - 0.5) * 2.0;                                      // 0 at the centre line, 1 at the ribbon edge
      float core = exp(-pow(d / 0.085, 2.0));                                // white-hot core (~2 px at the default framing)
      float mid = exp(-pow(d / 0.30, 2.0));                                  // gold mid
      float outer = exp(-d * d * 3.0) * (1.0 - smoothstep(0.8, 1.0, d));    // amber glow (~0.07)
      float ends = smoothstep(0.0, 0.03, vUv.x) * (1.0 - smoothstep(0.97, 1.0, vUv.x));
      vec3 c = uCore * core * 3.0 + uMid * mid * 1.0 + mix(uOuter, uEdge, d) * outer * 0.14;   // wider but cooler than before: crisp plasma, and its bloom no longer fogs the face
      gl_FragColor = vec4(c * vI * ends, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const arcMesh = new THREE.Mesh(arcGeo, arcMat);
arcMesh.frustumCulled = false; arcMesh.renderOrder = 20;
scene.add(arcMesh);

const _jd = new THREE.Vector3(), _jr = new THREE.Vector3();
function jag(a: THREE.Vector3, b: THREE.Vector3, gens: number, rough: number) {
  let pts = [a.clone(), b.clone()], amp = a.distanceTo(b) * rough;
  for (let g = 0; g < gens; g++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1], mid = p0.clone().lerp(p1, 0.5);
      _jd.subVectors(p1, p0).normalize();
      _jr.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5); _jr.addScaledVector(_jd, -_jr.dot(_jd));   // perpendicular jitter
      if (_jr.lengthSq() > 1e-8) mid.addScaledVector(_jr.normalize(), (rnd() * 2 - 1) * amp);
      next.push(mid, p1);
    }
    pts = next; amp *= 0.5;
  }
  return pts;
}
const UPV = new THREE.Vector3(0, 1, 0);
const arcs: Arcs = {
  main: [], prev: [], fx: [], lastRegen: -9, nextRegen: 0, env: 0, mid: new THREE.Vector3(),
  ctrl() {
    const [L, R] = bolts;
    const lt = L.tip.clone(), rt = R.tip.clone();
    return [lt, lt.clone().addScaledVector(L.axis, 0.11).addScaledVector(UPV, 0.30), new THREE.Vector3(0, 2.13, 0.06),   // hugs the hair, so its light reaches the fringe
      rt.clone().addScaledVector(R.axis, 0.11).addScaledVector(UPV, 0.30), rt];
  },
  regen(t, smoothOnly) {
    this.prev = this.main;
    const curve = new THREE.CatmullRomCurve3(this.ctrl(), false, 'catmullrom', 0.5);
    const strips: Strip[] = [];
    if (smoothOnly) {
      strips.push({ pts: curve.getPoints(48), w: 0.03, k: 0.8 });
    } else {
      const base = curve.getPoints(8);
      const main: THREE.Vector3[] = [];
      for (let i = 0; i < base.length - 1; i++) { const seg = jag(base[i], base[i + 1], 3, 0.35); if (i) seg.shift(); main.push(...seg); }
      strips.push({ pts: main, w: 0.05, k: 1 });
      for (let b = 0; b < 2; b++) {                                         // branches
        const i = 6 + Math.floor(rnd() * (main.length - 12));
        const dir = _jd.subVectors(main[i + 1], main[i - 1]).normalize().add(_jr.set(rnd() - 0.5, rnd() * 0.6, rnd() - 0.5).multiplyScalar(1.8)).normalize();
        const end = main[i].clone().addScaledVector(dir, 0.12 + rnd() * 0.18);
        const br = jag(main[i], end, 3, 0.45);
        strips.push({ pts: br, w: 0.03, k: 0.65 });
        for (let tw = 0; tw < 2; tw++) {                                    // twigs
          const j = 1 + Math.floor(rnd() * (br.length - 2));
          const e2 = br[j].clone().add(_jr.set(rnd() - 0.5, rnd() - 0.2, rnd() - 0.5).normalize().multiplyScalar(0.04 + rnd() * 0.06));
          strips.push({ pts: jag(br[j], e2, 2, 0.5), w: 0.018, k: 0.5 });
        }
      }
      for (const B of bolts) {                                              // crawls off each cap into the air
        const n = 1 + (rnd() < 0.5 ? 1 : 0);
        for (let c = 0; c < n; c++) {
          const end = B.tip.clone().addScaledVector(B.axis, 0.10 + rnd() * 0.14).add(_jr.set(rnd() - 0.5, rnd() - 0.3, rnd() - 0.5).multiplyScalar(0.18));
          strips.push({ pts: jag(B.rim.clone().lerp(B.tip, rnd()), end, 3, 0.4), w: 0.026, k: 0.65, root: true });
        }
      }
    }
    this.main = strips;
    this.mid.copy(curve.getPoint(0.5));
    this.lastRegen = t;
  },
  /** One-shot arcs (celebrate, wake): from `from` to `to` in head space, alive for `dur` seconds. */
  shot(from, to, dur, t, w = 0.022) {
    if (this.fx.length >= 4) this.fx.shift();
    this.fx.push({ from: from.clone(), to: to.clone(), born: t, dur, w, pts: jag(from, to, 4, 0.3), next: t });
  },
};

const _ra = Array.from({ length: ARC_MAXP }, () => new THREE.Vector3());
const _side = new THREE.Vector3(), _tan = new THREE.Vector3(), _view = new THREE.Vector3(), _jit = new THREE.Vector3();
function writeRibbons(list: readonly Ribbon[]) {
  let v = 0, ii = 0;
  for (const s of list) {
    const n = s.pts.length;
    if (n < 2 || s.k <= 0.002 || v + n * 2 > ARC_MAXP * 2) continue;
    for (let i = 0; i < n; i++) {
      _jit.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(i && i < n - 1 && !STILL && !REDUCED ? 0.008 : 0);   // buzzing crawl
      headInner.localToWorld(_ra[i].copy(s.pts[i]).add(_jit));
    }
    for (let i = 0; i < n; i++) {
      _tan.subVectors(_ra[Math.min(i + 1, n - 1)], _ra[Math.max(i - 1, 0)]);
      _view.subVectors(camera.position, _ra[i]);
      _side.crossVectors(_tan, _view);
      if (_side.lengthSq() < 1e-12) _side.set(0, 1, 0);
      const u = i / (n - 1);
      const taper = s.root ? Math.pow(1 - u, 0.5) * 0.9 + 0.1 : Math.max(0.12, Math.pow(Math.sin(Math.PI * u), 0.35));
      _side.normalize().multiplyScalar(s.w * taper);
      const o = v * 3;
      arcPos[o] = _ra[i].x - _side.x; arcPos[o + 1] = _ra[i].y - _side.y; arcPos[o + 2] = _ra[i].z - _side.z;
      arcPos[o + 3] = _ra[i].x + _side.x; arcPos[o + 4] = _ra[i].y + _side.y; arcPos[o + 5] = _ra[i].z + _side.z;
      arcUv[v * 2] = u; arcUv[v * 2 + 1] = 0; arcUv[v * 2 + 2] = u; arcUv[v * 2 + 3] = 1;
      arcI[v] = arcI[v + 1] = s.k;
      if (i < n - 1) { arcIdx[ii++] = v; arcIdx[ii++] = v + 1; arcIdx[ii++] = v + 3; arcIdx[ii++] = v; arcIdx[ii++] = v + 3; arcIdx[ii++] = v + 2; }
      v += 2;
    }
  }
  arcGeo.setDrawRange(0, ii);
  if (ii === 0 && arcPrevI === 0) return;                            // no arc now or last frame: skip the upload entirely
  arcPrevI = ii;
  for (const name of ['position', 'aUV', 'aI']) {                  // upload only the part that was written
    const a = arcGeo.attributes[name] as THREE.BufferAttribute;
    a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, v) * a.itemSize); a.needsUpdate = true;
  }
  arcGeo.index!.clearUpdateRanges(); arcGeo.index!.addUpdateRange(0, Math.max(1, ii)); arcGeo.index!.needsUpdate = true;
}
let arcPrevI = -1;

  return { ARC_MAXP, arcGeo, arcMat, arcMesh, jag, UPV, arcs, writeRibbons };
}
