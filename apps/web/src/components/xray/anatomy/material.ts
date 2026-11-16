// The look of bone and metal on the film (brief 051 part C). One shader for bone: a surface that turns its edge to
// the viewer glows and one that faces it stays nearly clear, as a radiograph shows bone where the ray runs along it,
// in a pale ghost green-white, added over the picture. Both sides of every surface are drawn and nothing hides
// anything, so the skull's walls and the face's bones sum the way film sums them. Metal (Franki's bolts and the
// stitches) is solid and brighter, as metal shows on film.
// Cuts: the cranium and the upper jaw's front plate drop the fragments inside a shape (the face below the brow; the
// nose's opening) and glow along the cut's edge, so the holes are real holes with bright rims.
// Colours are COL's values as given, written straight to the screen: these shaders do no colour conversion.
import * as THREE from "three";
import { COL } from "../../avatar/three/config";

/** Which cut a bone material makes. */
export const CUT = { none: 0, cranium: 1, aperture: 2 } as const;

export interface BoneLook {
  /** How bright the bone is overall. */
  gain: number;
  /** How much of the glow a flat face keeps, 0 to 1. */
  base?: number;
  cut?: (typeof CUT)[keyof typeof CUT];
  /** True for the hands' camera, which looks straight down -z from everywhere. */
  ortho?: boolean;
  /** True for meshes drawn as an InstancedMesh. */
  instanced?: boolean;
}

/** The pale ghost green-white of bone on the film, and the near white of metal. */
export const BONE_COLOUR = COL.sheen;
export const METAL_COLOUR = COL.spark;

const raw = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

const BONE_VERTEX = /* glsl */ `
attribute float aDensity;
uniform bool uOrtho;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
varying float vDensity;
void main() {
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  // A bone is stretched along its length, so its normals are divided by the stretch twice over.
  vec3 s2 = vec3(dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz), dot(instanceMatrix[1].xyz, instanceMatrix[1].xyz), dot(instanceMatrix[2].xyz, instanceMatrix[2].xyz));
  n = mat3(instanceMatrix) * (n / max(s2, vec3(1e-12)));
  local = instanceMatrix * local;
#endif
  vLocal = position;
  vDensity = aDensity;
  vec4 mv = modelViewMatrix * local;
  vNormal = normalize(mat3(modelViewMatrix) * n);
  vView = uOrtho ? vec3(0.0, 0.0, 1.0) : -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const BONE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uGain;
uniform float uBase;
uniform float uOpacity;
uniform int uCut;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
varying float vDensity;

// The brow line, centimetres in the canonical head: highest over the middle of each eye, dropping at the temples.
float browY(float ax) {
  return 3.75 + 0.75 * sin(3.14159265 * ax / 6.4) - 1.6 * smoothstep(4.2, 5.6, ax);
}

// Signed distance to the cut, centimetres: below zero is inside, and dropped.
float cutDistance(vec3 p) {
  float ax = abs(p.x);
  if (uCut == 1) {
    // The cranium's front below the brow, where the face's own bones are.
    return -min(min(browY(ax) - p.y, 5.3 - ax), p.z + 1.5);
  }
  if (uCut == 2) {
    // The nose's pear-shaped opening, wide at the bottom; only on the front of the upper jaw.
    float s = clamp((p.y + 1.9) / 3.05, 0.0, 1.0);
    float w = 1.22 * pow(sin(3.14159265 * pow(s, 0.72)), 0.75) * (1.0 - 0.42 * s);
    float d = max(max(ax - w, -1.9 - p.y), p.y - 1.15);
    return p.z > 3.0 ? d : 1.0;
  }
  return 1.0;
}

void main() {
  float rim = 0.0;
  if (uCut > 0) {
    float d = cutDistance(vLocal);
    if (d < 0.0) discard;
    rim = 1.0 - smoothstep(0.0, 0.32, d);
  }
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float edge = pow(1.0 - facing, 2.4);
  float glow = vDensity * (uBase + (1.0 - uBase) * edge + 0.85 * rim) * uGain * uOpacity;
  gl_FragColor = vec4(uColor * glow, 0.0);
}
`;

const METAL_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
varying float vDensity;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  // Bright and solid, with a faint darker line where its edges turn away.
  float shade = mix(0.72, 1.0, smoothstep(0.05, 0.6, facing));
  float a = uOpacity * clamp(vDensity, 0.0, 1.0);
  gl_FragColor = vec4(uColor * shade * a, a);
}
`;

/** Added over the picture; the canvas's alpha (the veil) is left as it is. */
function additive(m: THREE.ShaderMaterial) {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquationAlpha = THREE.AddEquation;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
}

/** A bone material. Every one runs the same shader; only its uniforms differ. */
export function boneMaterial(look: BoneLook): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: BONE_VERTEX,
    fragmentShader: BONE_FRAGMENT,
    uniforms: {
      uColor: { value: raw(BONE_COLOUR) },
      uGain: { value: look.gain },
      uBase: { value: look.base ?? 0.07 },
      uOpacity: { value: 1 },
      uCut: { value: look.cut ?? CUT.none },
      uOrtho: { value: look.ortho ?? false },
    },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  additive(m);
  return m;
}

/** Metal: solid, drawn over the bone. */
export function metalMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: BONE_VERTEX,
    fragmentShader: METAL_FRAGMENT,
    uniforms: { uColor: { value: raw(METAL_COLOUR) }, uOpacity: { value: 1 }, uOrtho: { value: false } },
    // Both sides: the screen's mirror turns every triangle's winding round.
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.NormalBlending,
  });
}

/** Sets how much of a part shows, 0 to 1 (a lost face fading out). */
export function setOpacity(m: THREE.ShaderMaterial, opacity: number) {
  m.uniforms.uOpacity!.value = opacity;
}
