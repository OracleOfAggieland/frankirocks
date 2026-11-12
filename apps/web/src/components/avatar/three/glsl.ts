// Prototype franki.html 904-952 and 971-1034 (section 6: the shared GLSL strings), ported in WP2. Byte-identical
// after interpolation (GLSL_BODY_FRAG interpolates EYE_X.toFixed(3) at 1028, as the prototype does). Allowed
// edits E1, E3 only: each top-level `const` is exported, and nothing else changes. 953-970 (`V3`, `U`) are in
// uniforms.ts (WP3). glsl.test.ts pins the SHA-256 of each string against the goldens taken from the prototype.
import { EYE_X } from "./config";

export const GLSL_NOISE = /* glsl */`
float fk_sq(float x){ return x * x; }   // pow(x, 2.0) is undefined for x < 0 in GLSL ES (NaN on Metal and some GL drivers)
float fk_h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float fk_vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fk_h13(i), fk_h13(i + vec3(1,0,0)), f.x), mix(fk_h13(i + vec3(0,1,0)), fk_h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fk_h13(i + vec3(0,0,1)), fk_h13(i + vec3(1,0,1)), f.x), mix(fk_h13(i + vec3(0,1,1)), fk_h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fk_fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a * fk_vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.875; }
float fk_angD(float a, float b){ return abs(mod(a - b + PI, 2.0 * PI) - PI); }
vec3 fk_hue(vec3 c, float h){ const vec3 k = vec3(0.57735027); float a = h * 6.2831853; float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }   // Rodrigues rotation about the grey axis
// Surface-gradient bump from screen derivatives (no UVs needed).
vec3 fk_bump(vec3 sp, vec3 n, float h){
  vec3 dpx = dFdx(sp), dpy = dFdy(sp);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = (det < 0.0 ? -1.0 : 1.0) * (dFdx(h) * r1 + dFdy(h) * r2);
  vec3 r = abs(det) * n - g;
  return dot(r, r) > 1e-20 ? normalize(r) : n; }
// Eyelid edges in bead-local unit coordinates. L = (upper cover, lower rise, tilt slope, smile arch).
float fk_lidTop(float x, vec4 L, float outer){ return 1.1 - 2.05 * L.x + 0.18 * (1.0 - L.x) * (1.0 - x * x) - L.z * x * outer; }
float fk_lidBot(float x, vec4 L){ return -1.1 + 1.6 * L.y + L.w * (1.0 - x * x); }
`;

/* Live body deformation, identical in the colour pass, the depth prepass and the shadow pass. */
export const GLSL_DISPLACE = /* glsl */`
uniform float uTime, uHemAmp, uHemPhase, uHemLag, uBreath, uHeadPivot;
uniform vec4 uNub;          // x,y: lift/push of the nub at -X; z,w: at +X
uniform mat3 uHeadRot;
float fk_sq(float x){ return x * x; }
float fk_aD(float a, float b){ return abs(mod(a - b + PI, 2.0 * PI) - PI); }
vec3 fk_displace(vec3 p){
  float th = atan(p.x, p.z / 0.86);
  vec2 rd = normalize(p.xz + vec2(1e-5));
  float w = 1.0 - smoothstep(0.02, 0.34, p.y);                          // hem weight
  float wave = 0.6 * sin(3.0 * th + uHemPhase * 1.7) + 0.4 * sin(5.0 * th - uHemPhase);
  p.xz += rd * w * uHemAmp * wave;
  p.y += w * (uHemAmp * 0.7 * cos(5.0 * th - uHemPhase) + uHemLag * w);  // the hem trails the body's vertical motion
  float dy = p.y - 0.60;
  float sy = dy < 0.0 ? 0.13 : 0.21;                                    // the nub's underside is sharper: a hanging blob
  float ny = exp(-(dy * dy) / (sy * sy));
  float nR = exp(-pow(fk_aD(th, -1.75) / 0.30, 2.0)) * ny;
  float nL = exp(-pow(fk_aD(th, 1.75) / 0.30, 2.0)) * ny;
  p.xz += rd * (nR * uNub.y + nL * uNub.w);
  p.y += nR * uNub.x + nL * uNub.z;
  p.z += uBreath * 0.01 * exp(-fk_sq((p.y - 0.45) / 0.2)) * max(cos(th), 0.0);
  float hw = smoothstep(0.2, 0.78, p.y);                                 // the head bends as one from the mouth up
  vec3 pv = vec3(0.0, uHeadPivot, 0.0);
  return mix(p, uHeadRot * (p - pv) + pv, hw);
}`;

export const GLSL_SKIN = /* glsl */`
uniform float uTime, uGlow, uRim, uHue, uGhost, uGlowShift, uNoiseAmt, uBlush, uThink, uLidCover, uLidShut;
uniform vec3 uKeyDirV, uRimDirV, uSssCol, uCoreCol, uRimHem, uRimTop, uThinkCol, uGhostCol, uShadowCol;
// Emissive skin terms: inner glow brightest toward the hem, thin edges glowing more, wrap/back scatter, fresnel rim.
vec3 fk_skinAdd(vec3 N, vec3 Vv, float y, float ao, out float fres){
  float NdV = saturate(dot(N, Vv));
  float thin = 1.0 - NdV;
  fres = pow(thin, 2.6);
  float lowW = 1.0 - smoothstep(0.05, 0.9, y - uGlowShift);
  vec3 glowC = uSssCol * (0.095 + 0.21 * lowW) * (0.6 + 0.4 * thin) + uCoreCol * NdV * NdV * NdV * 0.11;   // a whiter core facing the viewer, as in the art
  float ndl = dot(N, uKeyDirV);
  float wrapT = saturate((ndl + 0.5) / 1.5) - saturate(ndl);             // lit-through band past the terminator
  float back = pow(saturate(dot(Vv, -normalize(uRimDirV + N * 0.4 + vec3(1e-4)))), 3.0);
  float hemT = smoothstep(0.3, 1.5, y);
  vec3 rimC = mix(uRimHem * 0.8, uRimTop * 0.5, hemT);
  vec3 add = (glowC * mix(1.0, ao, 0.5) + uSssCol * (wrapT * 0.42 + back * 0.35)) * uGlow;   // lit through, never grey on the shadow side
  add += rimC * fres * uRim;
  add += uThinkCol * uThink * fres * (0.55 + 0.45 * sin(uTime * 9.0 + y * 7.0));
  // The art's long vertical gloss streak down the lit (viewer-left) side of head and belly: a narrow band in view-space normal x.
  float sx = N.x + 0.6 - 0.05 * N.y;                                     // the band leans with the head's curve, as in the art
  float streak = (exp(-fk_sq(sx / 0.042)) + 0.35 * exp(-fk_sq(sx / 0.11))) * smoothstep(-0.35, 0.35, N.y + 0.25) * (1.0 - smoothstep(0.55, 0.85, N.y)) * smoothstep(0.12, 0.5, y);
  add += vec3(0.95, 1.0, 0.94) * streak * 0.42 * (1.0 - uGhost);          // a crisp core inside a soft sheen
  return add;
}`;

export const GLSL_BODY_FRAG = /* glsl */`
uniform vec3 uBrowL, uBrowR, uEyeC[2], uBoltC[2], uBlushCol, uBrowCol, uScarCut, uScarGroove, uWeltCol, uHoleCol;
uniform vec2 uHoles[6], uScarA, uScarB, uScarC;
varying vec3 vObjPos;
varying vec3 vObjN;
float fk_dot2(vec2 v){ return dot(v, v); }
// Exact distance to a quadratic Bezier (closed-form cubic solve).
float fk_sdBezier(vec2 pos, vec2 A, vec2 B, vec2 Cc){
  vec2 a = B - A, b = A - 2.0 * B + Cc, c = a * 2.0, d = A - pos;
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float p = ky - kx * kx, q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p * p * p, res;
  if (h >= 0.0){
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    res = fk_dot2(d + (c + b * t) * t);
  } else {
    float z = sqrt(-p);
    float v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0;
    float m = cos(v), n = sin(v) * 1.732050808;
    vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
    res = min(fk_dot2(d + (c + b * t.x) * t.x), fk_dot2(d + (c + b * t.y) * t.y));
  }
  return sqrt(res);
}
float fk_brow(vec2 P, float side, vec3 B){
  if (B.x < 0.003) return 0.0;
  vec2 q = P - vec2(side * ${EYE_X.toFixed(3)}, 1.41 + B.y);
  vec2 dir = vec2(cos(B.z), side * sin(B.z));                            // positive angle lifts the outer end
  float xl = dot(q, dir), yl = dot(q, vec2(-dir.y, dir.x)) - 0.008 * (1.0 - fk_sq(clamp(xl / 0.075, -1.0, 1.0)));
  float halfW = 0.018 * (1.0 - 0.45 * smoothstep(-0.075, 0.075, xl * side));    // thinner toward the outer end
  float d = length(vec2(max(abs(xl) - 0.075, 0.0), yl));
  return B.x * (1.0 - smoothstep(halfW * 0.55, halfW + 0.004, d));
}`;
