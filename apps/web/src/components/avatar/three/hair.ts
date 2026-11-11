// Prototype franki.html 1729-1988 (section 7: the mop, the tufts, the hair prepass and the fur shells), ported in
// WP6. Allowed edits E1, E3, and the merge failures as EngineError("merge"). `hrand = mulberry32(4242)` is
// created inside the factory and drawn in the prototype's order: HAIR_CELLS, then the strict buildHair order.
// `bodyAtIdx`, `bodyNormalAtIdx`, their scratch vectors and `buildTuft` stay private to the factory: nothing outside
// 1729-1988 reads them. The shader template strings keep the prototype's own indentation byte for byte.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CharacterPart } from "./character";
import type { ConfigPart } from "./config";
import { EngineError } from "./errors";
import type { HairBrassMaterialsPart } from "./materials-hair-brass";
import { clamp, gauss, lerp, mulberry32, smooth } from "./math";
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
  const { U, hairU, hairMat, DENSE, DENSE_MAX, deform, surfaceAt, surfaceNormal, headInner } = rc;

/* --- hair: a thick, rounded mop grown out of the head along its normals (no overhanging rim), plus chunky fringe tufts and side locks --- */
const hrand = mulberry32(4242);
const HAIR_CELLS = Array.from({ length: 26 }, () => hrand());
const PART_TH = -0.16;                                                  // the parting, just viewer-left of centre

/** Hairline height (profile space) at angle th: low across the forehead, dipping to the bolts at the sides, lowest behind them. */
function hairEdge(th: number) {
  const a = Math.abs(th);
  let y = a < 1.2 ? 1.73 : a < 1.75 ? lerp(1.73, 1.62, smooth(1.2, 1.6, a)) : lerp(1.62, 1.555, smooth(1.75, 2.6, a));
  y += 0.035 * gauss(a, Math.PI / 2, 0.22);                            // clears the bolt washers
  const f = (th / (2 * Math.PI) + 0.5) * HAIR_CELLS.length, cell = Math.floor(f) % HAIR_CELLS.length, fr = f - Math.floor(f);
  const nearBolt = 1 - 0.85 * gauss(a, Math.PI / 2, 0.2);
  const len = (0.025 + 0.055 * HAIR_CELLS[cell]) * (a > 1.2 ? 1 : 0.45) * nearBolt;
  return y - len * Math.pow(1 - Math.abs(2 * fr - 1), 1.6);            // pointed clumps hanging from the edge
}

const _hs = new THREE.Vector3(), _ht = new THREE.Vector3(), _hu = new THREE.Vector3();
/** Body surface point at angle th and dense-profile index i (walks over the top pole, where y alone cannot). */
const bodyAtIdx = (th: number, i: number, out: THREE.Vector3) => deform(th, DENSE[i].x, DENSE[i].y, out, false);
function bodyNormalAtIdx(th: number, i: number, out: THREE.Vector3) {
  const e = 1e-3, i0 = Math.max(DENSE_MAX, i - 1), i1 = Math.min(DENSE.length - 1, i + 1);
  bodyAtIdx(th + e, i, _hs); bodyAtIdx(th - e, i, _ht); _hs.sub(_ht);
  bodyAtIdx(th, i1, _ht); bodyAtIdx(th, i0, _hu); _ht.sub(_hu);
  out.crossVectors(_hs, _ht);
  const l = out.length();
  if (l < 1e-9) return out.set(0, 1, 0);
  out.divideScalar(l);
  return out.lerp(_hu.set(0, 1, 0), 1 - smooth(0.0, 0.06, DENSE[i].x)).normalize();   // steady at the pole
}
/** Mop thickness: thin at the sides, thick on top; Tmax for a surface normal with this y. */
const hairTmax = (ny: number) => 0.07 + 0.16 * Math.pow(clamp(ny), 0.95);       // fuller at mid-latitudes: a rounder mop top

function buildHairCap(cols = 220, rows = 46) {
  const pos: number[] = [], strand: number[] = [], flow: number[] = [], idx: number[] = [];
  const S = new THREE.Vector3(), N = new THREE.Vector3(), prev = new THREE.Vector3();
  const last = DENSE.length - 1;
  const grid: { th: number; colPts: number[][] }[] = [];
  for (let j = 0; j <= cols; j++) {
    const th = (j / cols) * 2 * Math.PI - Math.PI;
    const ye = hairEdge(th);
    let i0 = DENSE_MAX;
    while (i0 < last - 2 && DENSE[i0].y < ye) i0++;
    const colPts: number[][] = [];
    let d = 0;
    for (let k = 0; k <= rows; k++) {
      const u = k / (rows + 1);
      const di = Math.min(last - 1, Math.round(lerp(i0, last - 1, Math.pow(u, 1.45))));   // rows crowd toward the lip
      bodyAtIdx(th, di, S); bodyNormalAtIdx(th, di, N);
      if (k) d += S.distanceTo(prev);
      prev.copy(S);
      const Tm = hairTmax(N.y), B = 0.85 * Tm;
      const bev = Math.sqrt(Math.max(0, 1 - (1 - Math.min(d / B, 1)) ** 2));   // a quarter-round lip: soft and full, never a ledge
      const tip = 1 - u;
      const clump = (0.012 * (0.5 + 0.5 * Math.cos(th * 34 + u * 5.0 + Math.sin(th * 7) * 1.4)) * (0.35 + 0.65 * tip)
        + 0.004 * Math.sin(th * 81 + u * 13)                            // strand clumps following the flow
        + 0.016 * Math.sin(th * 5 + 1.3) * Math.sin(u * 5 + th * 3)) * bev;   // a few big soft lumps across the mop
      const off = -0.004 + (Tm + 0.004) * bev + clump;
      colPts.push([S.x + N.x * off, S.y + N.y * off, S.z + N.z * off, 0.45 + 0.55 * bev, tip]);
    }
    grid.push({ th, colPts });
  }
  for (let j = 0; j <= cols; j++) {
    const { th, colPts } = grid[j];
    for (let k = 0; k < colPts.length; k++) {
      const p = colPts[k], q = colPts[Math.min(k + 1, colPts.length - 1)], pr = colPts[Math.max(k - 1, 0)];
      pos.push(p[0], p[1], p[2]);
      const fx = pr[0] - q[0], fy = pr[1] - q[1], fz = pr[2] - q[2], fl = Math.hypot(fx, fy, fz) || 1;
      flow.push(fx / fl, fy / fl, fz / fl);
      strand.push(th * 64, p[4], p[3]);
    }
  }
  const per = rows + 1;
  for (let j = 0; j < cols; j++) {
    for (let k = 0; k < per - 1; k++) {
      const a = j * per + k, b = (j + 1) * per + k, c = a + 1, d = b + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const pole = pos.length / 3;
  bodyAtIdx(0, last, S);
  pos.push(0, S.y + hairTmax(1), 0); flow.push(0, 0, 1); strand.push(0, 0, 1);
  for (let j = 0; j < cols; j++) idx.push(j * per + per - 1, (j + 1) * per + per - 1, pole);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 3));
  g.setAttribute('aStrand', new THREE.Float32BufferAttribute(strand, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A chunky, tapered, twisted wedge lying on the skin from (th0, rootY), buried in the mop at the root, curling by `curl` to tipY. */
const TUFT_H = 0.08;                                                    // thick clumps with volume, not flat thorns
function buildTuft(th0: number, rootY: number, tipY: number, curl: number, width: number, seed: number) {
  const RINGS = 18, SIDES = 12, pos: number[] = [], strand: number[] = [], flow: number[] = [], idx: number[] = [];
  const halfH = (t: number) => (TUFT_H * Math.pow(1 - t, 0.8) + 0.004) * 0.5;
  const P = new THREE.Vector3(), N = new THREE.Vector3(), Pn = new THREE.Vector3(), T = new THREE.Vector3(), Bn = new THREE.Vector3();
  const pathAt = (t: number, out: THREE.Vector3, nOut: THREE.Vector3) => {
    const th = th0 + curl * Math.pow(t, 1.6), y = lerp(rootY, tipY, t);
    surfaceAt(th, Math.min(y, 1.785), out);
    surfaceNormal(th, Math.min(y, 1.785), nOut);
    return out.addScaledVector(nOut, halfH(t) * 0.8 + 0.004 + 0.012 * Math.sin(Math.PI * t));   // resting on the skin, a little fuller mid-length
  };
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    pathAt(t, P, N);
    pathAt(Math.min(1, t + 0.02), Pn, Bn);
    T.subVectors(Pn, P); if (i === RINGS) { pathAt(t - 0.02, Pn, Bn); T.subVectors(P, Pn); }
    T.normalize();
    Bn.crossVectors(N, T).normalize();
    const Nn = new THREE.Vector3().crossVectors(T, Bn).normalize();
    const tw = 0.35 * t * (seed > 0.5 ? 1 : -1);
    const cb = Math.cos(tw), sb = Math.sin(tw);
    const W = (width * Math.pow(1 - t, 0.75) + 0.003) * 0.5, H = halfH(t);
    if (i === RINGS) {
      pos.push(P.x, P.y, P.z); flow.push(T.x, T.y, T.z); strand.push(seed * 50, 1, 0.9);
      break;
    }
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
      const lx = ca * W, ly = sa * H * (1 + 0.25 * (1 - ca * ca));            // lens section with a soft ridge
      const ox = lx * cb - ly * sb, oy = lx * sb + ly * cb;
      pos.push(P.x + Bn.x * ox + Nn.x * oy, P.y + Bn.y * ox + Nn.y * oy, P.z + Bn.z * ox + Nn.z * oy);
      flow.push(T.x, T.y, T.z);
      strand.push(seed * 50 + ca * W * 130, t, lerp(0.55, 1.0, smooth(-0.6, 0.6, sa)) * lerp(0.6, 1.0, smooth(0, 0.3, t)));
    }
  }
  for (let i = 0; i < RINGS - 1; i++) {
    for (let k = 0; k < SIDES; k++) {
      const a = i * SIDES + k, b = i * SIDES + ((k + 1) % SIDES), c = a + SIDES, d = b + SIDES;
      idx.push(a, d, c, a, b, d);                                      // outward-facing: k runs counter-clockwise about the flow
    }
  }
  const tipI = RINGS * SIDES, last = (RINGS - 1) * SIDES;
  for (let k = 0; k < SIDES; k++) idx.push(last + k, last + ((k + 1) % SIDES), tipI);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 3));
  g.setAttribute('aStrand', new THREE.Float32BufferAttribute(strand, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const hairTufts: THREE.BufferGeometry[] = [];
function buildHair() {
  const parts = [buildHairCap()];
  // Fringe tips (profile y), viewer-left to viewer-right: the big V-dip sits just left of centre; the scar side stays short.
  const TIPS = [1.66, 1.62, 1.632, 1.565, 1.655, 1.69, 1.70, 1.665, 1.64];
  TIPS.forEach((tipY, i) => {
    const th = lerp(-1.3, 1.3, i / 8) + (hrand() - 0.5) * 0.06;
    const dir = th < PART_TH ? -1 : 1;
    const curl = dir * (0.10 + 0.07 * Math.abs(th) / 1.3);
    parts.push(buildTuft(th, 1.80, tipY, curl, 0.29 + hrand() * 0.07, hrand()));   // broad overlapping clumps, as in the art, not thorns
  });
  // Smaller points between the big clumps, of varied length, so the fringe edge is a ragged run of clumped tips, not one spike.
  [[-0.98, 1.675], [-0.33, 1.645], [0.33, 1.672], [0.98, 1.655]].forEach(([th, tipY]) => {
    const dir = th < PART_TH ? -1 : 1;
    parts.push(buildTuft(th + (hrand() - 0.5) * 0.05, 1.79, tipY, dir * 0.12, 0.17 + hrand() * 0.05, hrand()));
  });
  for (let s = -1; s <= 1; s += 2) {
    parts.push(buildTuft(s * 1.22, 1.78, 1.565, s * 0.05, 0.17, hrand()));          // side lock in front of the bolt
    parts.push(buildTuft(s * 1.95, 1.75, 1.53, s * 0.08, 0.20, hrand()));           // the mop wraps down behind the bolt
  }
  hairTufts.push(...parts.slice(1));
  const g = mergeGeometries(parts);
  if (!g) throw new EngineError('merge', 'hair geometry merge failed');   // contract: EngineError("merge") in place of the prototype's Error
  return g;
}
const hair = new THREE.Mesh(buildHair(), hairMat);
hair.castShadow = true; hair.receiveShadow = true;
hair.renderOrder = 12;
headInner.add(hair);

/* Ghost-mode depth prepasses for the self-overlapping hair and brass, so their faded colour passes never show inner faces.
   Only switched on while the ghost is visible (visibility changes never recompile). */
const hairPreMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
hairPreMat.onBeforeCompile = (s) => {
  Object.assign(s.uniforms, { uHairLag: hairU.uHairLag });
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aStrand; uniform vec3 uHairLag;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += uHairLag * aStrand.y * aStrand.y;');
};
hairPreMat.customProgramCacheKey = () => 'fk-hair-pre-1';
const hairPre = new THREE.Mesh(hair.geometry, hairPreMat);
hairPre.renderOrder = 11.5; hairPre.visible = false;
headInner.add(hairPre);
/* Fur shells: the mop and tufts redrawn a few times, pushed out along their normals, with strands cut by alpha-to-coverage.
   One instanced draw. Strands lean along the comb flow and thin toward their tips, so the silhouette and the fringe edge go soft
   and furry, as in the art, while the solid mop underneath keeps the flat-top shape. */
const FUR_MAX = 5, FUR_LEN = 0.017;
const furBase = mergeGeometries([buildHairCap(150, 32), ...hairTufts]);   // a lighter cap under the shells: the fuzz hides its facets
if (!furBase) throw new EngineError('merge', 'fur geometry merge failed');   // contract: EngineError("merge") in place of the prototype's Error
const furGeo = new THREE.InstancedBufferGeometry();
furGeo.index = furBase.index;
for (const name of ['position', 'normal', 'aFlow', 'aStrand']) furGeo.setAttribute(name, furBase.attributes[name]);
furGeo.setAttribute('aShell', new THREE.InstancedBufferAttribute(new Float32Array(Array.from({ length: FUR_MAX }, (_, k) => (k + 1) / FUR_MAX)), 1));
furGeo.instanceCount = FUR_MAX;
const furMat = new THREE.ShaderMaterial({
  uniforms: {
    uFurN: { value: FUR_MAX }, uHairLag: hairU.uHairLag, uHairA: hairU.uHairA, uKeyI: hairU.uKeyI, uGlow: U.uGlow, uKeyDirV: U.uKeyDirV, uRimDirV: U.uRimDirV,
    uHairRoot: hairU.uHairRoot, uHairMid: hairU.uHairMid, uHairTip: hairU.uHairTip, uBounce: hairU.uBounce, uThink: U.uThink, uThinkCol: U.uThinkCol,
  },
  vertexShader: /* glsl */`
    attribute vec3 aStrand, aFlow; attribute float aShell; uniform vec3 uHairLag; uniform float uFurN;
    varying vec3 vBase; varying vec3 vN; varying vec3 vFlowV; varying vec3 vV; varying vec3 vStrand; varying float vShell; varying vec3 vNW; varying vec3 vFlowO;
    void main(){
      vFlowO = aFlow;
      float aShellN = aShell * ${FUR_MAX.toFixed(1)} / uFurN;                    // spread over however many shells the tier draws (it draws the first uFurN)
      float tipW = 0.55 + 0.45 * aStrand.y;                                  // longer fur toward the fringe edge, shorter at the crown
      vec3 p = position + normal * (0.0012 + ${FUR_LEN.toFixed(4)} * aShellN * tipW);
      p += aFlow * ${FUR_LEN.toFixed(4)} * 0.55 * aShellN * aShellN;            // strands lean with the comb
      p += uHairLag * (aStrand.y * aStrand.y + 0.6 * aShellN);                // and trail the head a little more than the mop
      vBase = position - aFlow * 0.0035 * aShellN;                            // the strand's sample point drifts with its lean, so shells stack into strands
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vN = normalize(normalMatrix * normal);
      vNW = normalize(mat3(modelMatrix) * normal);
      vFlowV = normalize(normalMatrix * aFlow + vec3(1e-6));
      vV = -mv.xyz; vStrand = aStrand; vShell = aShellN;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uHairA, uKeyI, uGlow, uThink; uniform vec3 uKeyDirV, uRimDirV, uHairRoot, uHairMid, uHairTip, uBounce, uThinkCol;
    varying vec3 vBase; varying vec3 vN; varying vec3 vFlowV; varying vec3 vV; varying vec3 vStrand; varying float vShell; varying vec3 vNW; varying vec3 vFlowO;
    float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
    void main(){
      vec3 q = vBase * 290.0;                                                // ~0.0034-unit strand cells
      vec3 c = floor(q);
      float r = h13(c), r2 = h13(c + 17.3);
      vec3 jp = c + 0.5 + (vec3(r, r2, h13(c + 41.7)) - 0.5) * 0.5;
      vec3 dq = q - jp, fo = normalize(vFlowO + vec3(1e-6));
      float d = length(dq - fo * dot(dq, fo) * 0.8);                          // strands, not dots: stretched along the comb
      vec3 cq = vBase * 38.0; vec3 ci = floor(cq), cf = fract(cq); cf = cf * cf * (3.0 - 2.0 * cf);
      float clump = mix(mix(mix(h13(ci), h13(ci + vec3(1,0,0)), cf.x), mix(h13(ci + vec3(0,1,0)), h13(ci + vec3(1,1,0)), cf.x), cf.y),
                        mix(mix(h13(ci + vec3(0,0,1)), h13(ci + vec3(1,0,1)), cf.x), mix(h13(ci + vec3(0,1,1)), h13(ci + vec3(1,1,1)), cf.x), cf.y), cf.z);
      float keep = step(vShell * 0.92, r * (0.55 + 0.45 * vStrand.y) + 0.12 + 0.3 * clump);   // fewer strands reach the outer shells, in soft clumps
      float rad = mix(0.62, 0.18, vShell);                                    // strands taper to their tips
      float aa = fwidth(d) + 0.02;
      float a = (1.0 - smoothstep(rad - aa, rad + aa, d)) * keep * smoothstep(0.6, 0.95, uHairA);   // a ghost has no fuzz: dithered fur read as static
      if (a < 0.02) discard;
      vec3 N = normalize(vN), V = normalize(vV);
      vec3 T = normalize(vFlowV - N * dot(vFlowV, N) + vec3(1e-6));
      vec3 hc = mix(uHairRoot, uHairMid, smoothstep(0.0, 0.55, vStrand.y));
      hc = mix(hc, uHairTip, smoothstep(0.62, 1.0, vStrand.y) * 0.6 + 0.2 * vShell);
      hc *= (0.8 + 0.4 * r2) * (0.85 + 0.3 * clump);
      float occ = mix(0.5, 1.0, vShell) * mix(0.5, 1.0, vStrand.z);
      float wrap = clamp(dot(N, uKeyDirV) * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = hc * (0.16 + 0.72 * wrap * wrap) * occ * mix(0.55, 1.0, uKeyI);
      vec3 H1 = normalize(uKeyDirV + V), H2 = normalize(uRimDirV + V);
      float d1 = dot(T, H1), d3 = dot(T, H2);
      col += vec3(0.85, 0.9, 1.0) * pow(sqrt(max(1.0 - d1 * d1, 0.0)), 70.0) * 0.10 * occ * uKeyI;
      col += vec3(0.55, 1.0, 0.75) * pow(sqrt(max(1.0 - d3 * d3, 0.0)), 50.0) * 0.12 * occ * clamp(dot(N, uRimDirV) * 0.5 + 0.5, 0.0, 1.0);
      col += uBounce * clamp(-vNW.y, 0.0, 1.0) * uGlow * 0.3;               // the ghost's glow under the fringe
      col += uThinkCol * uThink * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0) * 0.12 * vShell;   // the arcs catch the fur tips
      gl_FragColor = vec4(col, a);
    }`,
  alphaToCoverage: true,
});
const fur = new THREE.Mesh(furGeo, furMat);
fur.frustumCulled = false;
headInner.add(fur);

  return {
    HAIR_CELLS, PART_TH, hairEdge, hairTmax, buildHairCap, TUFT_H, hairTufts, buildHair, hair, hairPreMat, hairPre,
    FUR_MAX, FUR_LEN, furBase, furGeo, furMat, fur,
  };
}
