// Prototype franki.html 2076-2201 (section 8: the backdrop, the ground and the dust motes), ported in WP7.
// Allowed edits E1, E3. `mulberry32(909)` for the motes is created inside the factory, as in the prototype's
// block scope. `groundU` is one shared object, never cloned (map A finding 2).
import * as THREE from "three";
import { C, COL, type ConfigPart, TURN } from "./config";
import { mulberry32 } from "./math";
import type { StagePart } from "./stage";
import type { UniformsPart } from "./uniforms";

export type GroundUniform = "uShC" | "uShR" | "uShA" | "uTurn" | "uPoolI" | "uPoolC" | "uPoolC2";

export interface WorldFxPart {
  bgMat: THREE.ShaderMaterial;
  bg: THREE.Mesh;
  groundU: Record<GroundUniform, THREE.IUniform>;
  groundMat: THREE.MeshStandardMaterial;
  ground: THREE.Mesh;
  MOTES: number;
  moteGeo: THREE.BufferGeometry;
  moteMat: THREE.ShaderMaterial;
  motes: THREE.Points;
}

export function createWorldFx(rc: ConfigPart & StagePart & UniformsPart): WorldFxPart {
  const { scene, U, V3 } = rc;

/* =====================================================================
   8. FX: background, ground, motes, sparks, lightning, catch-lights
   ===================================================================== */
const bgMat = new THREE.ShaderMaterial({
  uniforms: {
    uRes: { value: new THREE.Vector2(1, 1) }, uPar: { value: new THREE.Vector2() }, uHalo: { value: new THREE.Vector3(0.5, 0.55, 1) }, uHaloI: { value: 1 },
    uN0: { value: C(COL.night0) }, uN1: { value: C(COL.night1) }, uN2: { value: C(COL.night2) }, uLamp: { value: C(COL.lamp) }, uEcto: { value: C(COL.ecto) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
  fragmentShader: /* glsl */`
    uniform vec2 uRes, uPar; uniform vec3 uHalo; uniform float uHaloI; uniform vec3 uN0, uN1, uN2, uLamp, uEcto; varying vec2 vUv;
    float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
    float disc(vec2 p, vec2 c, float r, float soft){ return 1.0 - smoothstep(r * (1.0 - soft), r, length(p - c)); }
    void main(){
      float asp = uRes.x / uRes.y;
      vec3 col = mix(uN2, uN1, smoothstep(0.0, 0.45, vUv.y));
      col = mix(col, uN0, smoothstep(0.45, 1.0, vUv.y));
      vec2 p = (vUv - 0.5) * 2.0 * vec2(asp, 1.0);
      vec2 pf = p + uPar * 0.25, pn = p + uPar * 0.6;                       // far and near parallax layers
      vec2 lc = vec2(-0.35 * asp, 0.65);
      col += uLamp * 0.45 * exp(-dot(p - lc, p - lc) / 0.36);              // warm spill from an off-screen brass lamp
      vec2 hc = (uHalo.xy - 0.5) * 2.0 * vec2(asp, 1.0);
      float hd = length(p - hc) / (0.9 * uHalo.z);
      col += uEcto * 0.10 * uHaloI * exp(-hd * hd * 2.2);                  // ecto halo behind the ghost
      float bottle = max(1.0 - smoothstep(0.02, 0.2, segD(pf, vec2(0.78 * asp, -0.55), vec2(0.78 * asp, 0.12)) - 0.09),
                         1.0 - smoothstep(0.01, 0.12, segD(pf, vec2(0.78 * asp, 0.12), vec2(0.78 * asp, 0.42)) - 0.03));
      col += vec3(0.30, 0.46, 0.40) * 0.012 * bottle;                     // a tall bottle, out of focus
      float coilX = -0.82 * asp + 0.06 * sin(pf.y * 17.0);
      float coil = (1.0 - smoothstep(0.015, 0.07, abs(pf.x - coilX))) * smoothstep(-0.45, -0.25, pf.y) * (1.0 - smoothstep(0.3, 0.5, pf.y));
      col += vec3(0.42, 0.32, 0.18) * 0.008 * coil;                       // a copper coil
      float shelf = (1.0 - smoothstep(0.01, 0.05, abs(pf.y - 0.30))) * (1.0 - smoothstep(-0.35 * asp, -0.15 * asp, pf.x));
      col *= 1.0 - 0.07 * shelf;                                          // a shelf line
      col += vec3(1.0, 0.70, 0.38) * 0.030 * disc(pn, vec2(-0.58 * asp, 0.47), 0.085, 0.35);   // warm bokeh
      col += vec3(1.0, 0.76, 0.45) * 0.022 * disc(pn, vec2(0.64 * asp, 0.63), 0.060, 0.4);
      col += vec3(1.0, 0.66, 0.34) * 0.026 * disc(pn, vec2(-0.20 * asp, 0.80), 0.045, 0.45);
      gl_FragColor = vec4(col, 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
bg.frustumCulled = false; bg.renderOrder = -100;
scene.add(bg);

/* Ground: lit by the real lights (glow pool from the ghost's own point light, arc flicker), plus a soft contact shadow; fades out, no horizon. */
const groundU = {
  uShC: { value: new THREE.Vector2() }, uShR: { value: new THREE.Vector2(0.78, 0.62) }, uShA: { value: 0.55 }, uTurn: { value: TURN },
  uPoolI: { value: 0.25 }, uPoolC: { value: C(COL.ecto) }, uPoolC2: { value: C(COL.sss) },
};
const groundMat = new THREE.MeshStandardMaterial({ color: 0x0C1513, roughness: 0.9, metalness: 0, envMapIntensity: 0.25, transparent: true, depthWrite: false });
groundMat.onBeforeCompile = (s) => {
  Object.assign(s.uniforms, groundU);
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec2 uShC, uShR; uniform float uShA, uTurn, uPoolI; uniform vec3 uPoolC, uPoolC2; varying vec3 vGW;')
    .replace('#include <opaque_fragment>', /* glsl */`
      {
        vec2 d = vGW.xz - uShC;
        float cs = cos(uTurn), sn = sin(uTurn);
        vec2 dr = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y) / uShR;
        float sh = 1.0 - smoothstep(0.0, 1.0, length(dr));
        outgoingLight *= 1.0 - sh * sh * uShA;
        float pr = length(d) / 0.85;
        outgoingLight += mix(uPoolC, uPoolC2, smoothstep(0.0, 1.0, pr)) * pow(1.0 - smoothstep(0.0, 1.0, pr), 2.0) * uPoolI;
        diffuseColor.a = (1.0 - smoothstep(1.4, 2.5, length(vGW.xz))) * (1.0 - smoothstep(0.2, 1.6, -vGW.z));   // the far side melts into the dark: no horizon line
      }
      #include <opaque_fragment>`);
};
groundMat.customProgramCacheKey = () => 'fk-ground-1';
const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 96), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.renderOrder = -50;
scene.add(ground);

/* Dust motes: soft additive sprites; near Franki they take his colour and brighten. 5% are out-of-focus foreground bokeh. */
const MOTES = 231;
const moteGeo = new THREE.BufferGeometry();
{
  const p = new Float32Array(MOTES * 3), sd = new Float32Array(MOTES * 4), kd = new Float32Array(MOTES), r = mulberry32(909);
  for (let i = 0; i < MOTES; i++) {
    const fg = i % 20 === 19;
    p[i * 3] = (r() - 0.5) * (fg ? 3.0 : 4.0);
    p[i * 3 + 1] = r() * 3.0 - 1.5;
    p[i * 3 + 2] = fg ? 2.4 + r() * 2.0 : (r() - 0.5) * 3.0;
    for (let k = 0; k < 4; k++) sd[i * 4 + k] = r();
    kd[i] = fg ? 1 : 0;
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4));
  moteGeo.setAttribute('aKind', new THREE.BufferAttribute(kd, 1));
}
const moteMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uPR: { value: 1 }, uGlow: U.uGlow, uPush: { value: 0 }, uGhost: { value: V3() }, uWarm: { value: C(COL.mote) }, uEcto: { value: C(COL.ecto) } },
  vertexShader: /* glsl */`
    uniform float uTime, uPR, uPush; uniform vec3 uGhost; attribute vec4 aSeed; attribute float aKind; varying float vNear; varying float vA; varying float vKind;
    void main(){
      vec3 p = position;
      p.y = mod(p.y + uTime * 0.02 * (0.6 + aSeed.x) + 1.5, 3.0) - 1.5 + 1.4;   // slow upward current, wrapping
      p += vec3(sin(uTime * 0.13 * (0.5 + aSeed.y) + aSeed.z * 6.28), sin(uTime * 0.11 * (0.5 + aSeed.z) + aSeed.w * 6.28) * 0.6,
                cos(uTime * 0.09 * (0.5 + aSeed.w) + aSeed.x * 6.28)) * 0.18;     // brownian-ish drift
      vec3 toG = p - uGhost;
      float dg = length(toG / vec3(0.85, 1.05, 0.75));
      p += normalize(toG + vec3(1e-4)) * uPush * 0.3 * exp(-max(dg - 1.0, 0.0) * 1.5);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float px = aKind > 0.5 ? mix(6.0, 14.0, aSeed.x) : mix(1.0, 3.0, aSeed.y);
      gl_PointSize = px * uPR * clamp(5.5 / -mv.z, 0.4, 3.0);
      vNear = 1.0 - smoothstep(0.0, 0.9, dg - 1.0);
      vA = aKind > 0.5 ? 0.06 : mix(0.15, 0.35, aSeed.w);
      vKind = aKind;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uGlow; uniform vec3 uWarm, uEcto; varying float vNear; varying float vA; varying float vKind;
    void main(){
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float a = vKind > 0.5 ? (1.0 - smoothstep(0.6, 1.0, r)) * (0.75 + 0.25 * smoothstep(0.5, 0.9, r)) : pow(1.0 - smoothstep(0.0, 1.0, r), 2.0);
      vec3 col = mix(uWarm * 0.6, uEcto * 1.5 * uGlow, vNear);
      gl_FragColor = vec4(col * a * (vA + 0.4 * vNear * uGlow) * 0.5, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const motes = new THREE.Points(moteGeo, moteMat);
motes.frustumCulled = false; motes.renderOrder = 22;
scene.add(motes);

  return { bgMat, bg, groundU, groundMat, ground, MOTES, moteGeo, moteMat, motes };
}
