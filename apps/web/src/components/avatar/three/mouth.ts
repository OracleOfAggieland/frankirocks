// Prototype franki.html 1995-2074 (section 7: the mouth), ported in WP6. Allowed edits E1, E3.
// The body keeps the prototype's own indentation, so the shader template string stays byte for byte.
import * as THREE from "three";
import type { CharacterPart } from "./character";
import { C, COL, SHOW_MOUTH } from "./config";
import type { ConfigPart } from "./config";
import type { SurfacePart } from "./surface";
import type { UniformsPart } from "./uniforms";

export interface MouthPart {
  buildMouthGeometry(): THREE.BufferGeometry;
  mouthMat: THREE.ShaderMaterial;
  mouth: THREE.Mesh;
}

export function createMouth(rc: ConfigPart & UniformsPart & SurfacePart & CharacterPart): MouthPart {
  const { U, solveXY, surfaceAt, surfaceNormal, headInner } = rc;

/* --- mouth: an SDF cavity on a patch conformed to the face; hidden at rest, a faint slit while thinking, full while speaking --- */
function buildMouthGeometry() {
  const g = new THREE.PlaneGeometry(0.42, 0.32, 40, 40);
  const p = g.attributes.position, aM = new Float32Array(p.count * 2), S = new THREE.Vector3(), Nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i);
    aM[i * 2] = px; aM[i * 2 + 1] = py;
    const { th, y } = solveXY(px, 0.86 + py);
    surfaceAt(th, y, S); surfaceNormal(th, y, Nn);
    S.addScaledVector(Nn, 0.004);
    p.setXYZ(i, S.x, S.y, S.z);
  }
  g.setAttribute('aMouth', new THREE.BufferAttribute(aM, 2));
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  return g;
}
const mouthMat = new THREE.ShaderMaterial({
  uniforms: {
    uShape: { value: new THREE.Vector4(0.10, 0, 0.01, 0.5) }, uVis: { value: 0 }, uTongue: { value: 0 }, uGlow: U.uGlow,
    uIn: { value: C(COL.mouthIn) }, uDeep: { value: C(COL.mouthDeep) }, uTongueC: { value: C(COL.tongue) }, uTongueHi: { value: C(COL.tongueHi) },
    uSkin: { value: C(COL.body) }, uGhost: U.uGhost,
  },
  vertexShader: 'attribute vec2 aMouth; varying vec2 vM; void main(){ vM = aMouth; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  // Premultiplied output: rgb is added, alpha darkens what is under it. So one pass can both shade the skin around the mouth
  // (the lip crease, the chin shadow) and add light (the lip highlights) without painting a flat colour over the face.
  fragmentShader: /* glsl */`
    uniform vec4 uShape; uniform float uVis, uTongue, uGlow, uGhost; uniform vec3 uIn, uDeep, uTongueC, uTongueHi, uSkin; varying vec2 vM;
    float fk_sq(float x){ return x * x; }
    void main(){
      float vis = clamp(uVis, 0.0, 1.0);
      float w = max(uShape.x, 0.02) * 0.5 * mix(0.82, 1.0, vis);
      float h = max(uShape.y * mix(0.25, 1.0, smoothstep(0.0, 0.8, vis)), 0.004) * 0.5;   // fading in, the mouth grows from a crease: never an olive half-tone
      vec2 p = vM;
      float xn = clamp(p.x / w, -1.4, 1.4);
      float yc = p.y - uShape.z * xn * xn;                                   // corners lift into a smile
      float pe = yc > 0.0 ? mix(5.0, 2.0, uShape.w) : 2.0;                     // low roundness flattens the top lip (a D shape)
      float f = pow(pow(abs(p.x / w), pe) + pow(abs(yc / h), pe), 1.0 / pe);
      float sd = (f - 1.0) * min(w, h);
      float aa = fwidth(sd) * 1.2 + 1e-4;
      float inside = 1.0 - smoothstep(-aa, aa, sd);
      float depth = clamp(1.0 - f, 0.0, 1.0);
      float slit = 1.0 - smoothstep(0.004, 0.012, h * 2.0);                  // a closed or resting mouth: one dark crease, never a painted decal
      float yt = yc / h;                                                     // -1 lower lip .. +1 upper lip
      // Cavity: lit a little at the lower lip, falling off fast into the throat, and in the top lip's shadow under the upper edge.
      vec3 col = mix(uIn * 1.25, uDeep, smoothstep(0.0, 0.55, depth));
      col *= mix(1.0, 0.35, smoothstep(-0.1, 0.85, yt));                      // the upper lip overhangs: its shadow fills the top of the cavity
      col *= 1.0 - 0.35 * smoothstep(0.75, 1.0, abs(p.x) / w);                // corners tuck in
      col += vec3(0.05, 0.016, 0.02) * uGlow * (1.0 - smoothstep(-1.0, -0.2, yt)) * (1.0 - slit);   // warm light falling in over the lower lip
      vec2 tq = (p - vec2(0.0, -h * 0.70)) / vec2(w * 0.58, h * 0.50);
      float tongue = (1.0 - smoothstep(0.75, 1.0, length(tq))) * uTongue * (1.0 - slit);
      vec3 tc = mix(uTongueC, uTongueHi, smoothstep(-0.2, 0.8, tq.y) * (1.0 - smoothstep(0.2, 0.9, abs(tq.x))));
      tc *= mix(0.45, 1.0, smoothstep(-0.9, 0.6, tq.y)) * (1.0 - 0.25 * exp(-fk_sq(tq.x / 0.08)) * smoothstep(-0.6, 0.4, tq.y));   // rounded, with a soft centre groove
      tc *= mix(1.0, 0.45, smoothstep(0.1, 0.95, yt));                        // still under the top lip's shadow
      col = mix(col, tc, tongue);
      col = mix(col, vec3(0.085, 0.035, 0.05), slit);
      // Lips: a soft crease shadow hugging the opening, a lit roll on the lower lip, a faint catch on the upper lip's crest.
      float o = max(sd, 0.0);
      float edgeX = 1.0 - smoothstep(0.9, 1.15, abs(p.x) / w);
      float up = smoothstep(-0.2, 0.2, yt), lowS = 1.0 - up;
      float crease = exp(-o / mix(0.006, 0.0035, slit)) * (1.0 - inside) * edgeX;
      float chin = exp(-fk_sq((o - 0.022) / 0.010)) * lowS * edgeX * (1.0 - slit) * smoothstep(0.02, 0.06, h * 2.0);
      float lipLow = exp(-fk_sq((o - 0.0055) / 0.0032)) * lowS * edgeX * (1.0 - inside);
      float lipUp = exp(-fk_sq((o - 0.011) / 0.004)) * up * edgeX * (1.0 - inside) * (1.0 - slit);
      vec2 cn = vec2(abs(p.x) - w * 0.97, yc);
      float dimple = exp(-dot(cn, cn) / fk_sq(0.009)) * (1.0 - inside);       // the corners press in
      float shadeA = clamp(crease * mix(0.42, 0.55, slit) + chin * 0.16 + dimple * 0.35, 0.0, 0.85);
      vec3 hiC = uSkin * (lipLow * 0.16 + lipUp * 0.08) * (1.0 - slit * 0.6);
      float a = inside + shadeA * (1.0 - inside);
      vec3 rgb = col * inside + hiC * (1.0 - inside);
      float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
      rgb = mix(rgb, vec3(lum) * vec3(0.8, 1.0, 0.95), uGhost * 0.5);         // ghost mode: the mouth cools and thins with the body
      float k = smoothstep(0.0, 0.25, vis) * mix(1.0, 0.6, uGhost);
      gl_FragColor = vec4(rgb * k, a * k);
    }`,
  transparent: true, premultipliedAlpha: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
});
const mouth = new THREE.Mesh(buildMouthGeometry(), mouthMat);
mouth.renderOrder = 11;
mouth.visible = SHOW_MOUTH;
headInner.add(mouth);

  return { buildMouthGeometry, mouthMat, mouth };
}
