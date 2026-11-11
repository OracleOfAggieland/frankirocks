// Prototype franki.html 224-256 (section 2, UTILS), ported in WP0. Allowed edits: E1, E3 (design note §1.3).
// `rnd` and `rr` (245-246) become per-engine fields from createRandom, so every engine has its own seeded stream.
// Not ported: `boot`, `recordError` and `$` (258-260, page), and the reduced-motion query (262-264).
// No three.js import: node tests read this file directly.

/* =====================================================================
   2. UTILS
   ===================================================================== */
export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };   // JS-only: e0 > e1 inverts
export const gauss = (x: number, m: number, s: number) => Math.exp(-(((x - m) / s) ** 2));
export const angDist = (a: number, b: number) => Math.abs(((a - b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInQuad = (t: number) => t * t;
export const easeInOut = (t: number) => t * t * (3 - 2 * t);

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RandomPart {
  rnd: () => number;
  rr: (a: number, b: number) => number;
}

export function createRandom(): RandomPart {
  const rnd = mulberry32(0xF2A4C1);               // one seeded stream for behaviour, so ?still=1 is repeatable
  const rr = (a: number, b: number) => a + (b - a) * rnd();
  return { rnd, rr };
}

/** Spring-driven channel. Critically damped by default; every pose change goes through these. */
export class Chan {
  v: number; t: number; vel: number; w: number; z: number;
  constructor(v: number, w = 9, z = 1) { this.v = v; this.t = v; this.vel = 0; this.w = w; this.z = z; }
  step(dt: number) {
    const a = this.w * this.w * (this.t - this.v) - 2 * this.z * this.w * this.vel;
    this.vel += a * dt; this.v += this.vel * dt;
  }
  snap(v: number) { this.v = this.t = v; this.vel = 0; }
}
