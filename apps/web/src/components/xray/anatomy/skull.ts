// The skull (brief 051 part C), built in code from the measurements in skull-shape.ts: the cranium, cut away below
// the brow; the brow ridge; the eye sockets' rims and their cone-shaped hollows; the nose's bones and its opening
// (a real hole, with the septum and the turbinates faint inside it); the cheekbones and their arches; the upper jaw
// and its palate; both rows of teeth (enamel brighter than root); the lower jaw, which swings on its hinge; and the
// neck bones, fading out downward. Franki's marks, two neck bolts and a stitched seam across the brow, are metal.
// Everything is in the canonical head's centimetres, so XrayFace.matrix places it as it is.
import * as THREE from "three";
import type { Vec3 } from "./bone-place";
import { CUT, boneMaterial, metalMaterial, setOpacity } from "./material";
import { type Part, emptyPart, fadeFrom, lathe, loft, mirrorFrom, ovoid, sweep, toGeometry, transformFrom, vertexCount } from "./shapes";
import {
  APERTURE, BOLT, CRANIUM, JAW_OPEN, JAW_PIVOT, JAW_SLIDE, LOWER_ARCH, LOWER_TEETH, MANDIBLE, NECK, ORBIT, PHI_MAX, RAMUS, SEAM, UPPER_ARCH, UPPER_TEETH,
  type Arch, type ToothKind, apertureHalfWidth, archPoint, browY, craniumAlong, craniumFrontZ, orbitRim, orbitRimRadius, teethAlong,
} from "./skull-shape";

/** Draw Franki's marks (the neck bolts and the stitched brow). Off, the skull is a plain skull. */
export const FRANKI_MARKS = true;

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/** Points along a smooth curve through `points`, spaced evenly by keypoint (not by length). */
export function curveThrough(points: readonly Vec3[], samples: number, closed = false): Vec3[] {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)), closed, "catmullrom", 0.5);
  const n = closed ? samples : samples - 1;
  return Array.from({ length: samples }, (_, i) => {
    const p = c.getPoint(i / n);
    return V(p.x, p.y, p.z);
  });
}

/** The cranium: the ovoid, its front below the brow cut away by the shader. */
function cranium(part: Part) {
  const rows: Vec3[][] = [];
  const R = 40;
  const C = 56;
  for (let r = 0; r <= R; r++) {
    const v = -Math.PI / 2 + (r / R) * Math.PI;
    const row: Vec3[] = [];
    for (let c = 0; c < C; c++) {
      const u = (c / C) * Math.PI * 2;
      row.push(craniumAlong(V(Math.cos(v) * Math.sin(u), Math.sin(v), Math.cos(v) * Math.cos(u))));
    }
    rows.push(row);
  }
  loft(part, rows, () => 1, true);
}

/** A line laid on the cranium's front at height y, lifted a little off it. */
function onForehead(x: number, y: number, lift: number): Vec3 {
  return V(x, y, (craniumFrontZ(x, y) ?? CRANIUM.cz) + lift);
}

/** The faint seams between the cranium's plates: across the top (coronal) and front to back over it (sagittal). */
function sutures(part: Part) {
  const zig = (i: number) => (i % 2 === 0 ? 1 : -1) * 0.12;
  const coronal: Vec3[] = [];
  for (let i = 0; i <= 36; i++) {
    const s = -1 + (2 * i) / 36;
    const p = craniumAlong(V(Math.sin(s * 1.25), Math.cos(s * 1.25) * 1.1, 0.18));
    coronal.push(V(p.x * 0.995, p.y * 0.995 + zig(i) * 0.4, p.z + zig(i)));
  }
  sweep(part, coronal, () => ({ n: 0.05, b: 0.05, density: 0.55 }), { around: 5, caps: 0 });
  const sagittal: Vec3[] = [];
  for (let i = 0; i <= 30; i++) {
    const a = 0.25 + (i / 30) * 1.9;
    const p = craniumAlong(V(0, Math.sin(a), Math.cos(a)));
    sagittal.push(V(zig(i), p.y - 0.02, p.z));
  }
  sweep(part, sagittal, () => ({ n: 0.05, b: 0.05, density: 0.55 }), { around: 5, caps: 0 });
}

/** The brow ridge, along the cut's edge. */
function brow(part: Part) {
  const path = Array.from({ length: 21 }, (_, i) => {
    const x = -5.5 + (11 * i) / 20;
    const y = browY(x) + 0.22;
    return onForehead(x, y, -0.08);
  });
  sweep(part, path, (t) => {
    const x = -5.5 + 11 * t;
    const over = Math.exp(-(((Math.abs(x) - 2.9) / 1.4) ** 2));
    return { n: 0.32 + 0.14 * over, b: 0.42 + 0.1 * over, density: 1.05 };
  }, { up: V(0, 0, 1), caps: 2 });
}

/** One eye socket (the person's left; mirrored after): its rim and its hollow cone back into the head. */
function orbit(part: Part) {
  const N = 40;
  const rim = Array.from({ length: N }, (_, i) => orbitRim((i / N) * Math.PI * 2));
  sweep(part, rim, (t) => {
    const r = orbitRimRadius(t * Math.PI * 2);
    return { n: r * 1.15, b: r, density: 1.1 };
  }, { closed: true, up: V(0, 0, 1), around: 9 });
  // The hollow: from just inside the rim back to its apex, narrowing, and fainter the deeper it goes.
  const apex = V(1.45, 2.15, -1.3);
  const centre = V(ORBIT.cx, ORBIT.cy, 3.1);
  const rows: Vec3[][] = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    const c = lerp3(centre, apex, t);
    const shrink = 0.93 * (1 - t) ** 0.85 + 0.04;
    rows.push(rim.map((p) => V(c.x + (p.x - ORBIT.cx) * shrink, c.y + (p.y - ORBIT.cy) * shrink, p.z - 0.3 + (c.z - centre.z))));
  }
  loft(part, rows, (r) => 0.55 - 0.35 * r, true);
}

/** The nose: the two nasal bones, the rim of the pear-shaped opening, the spine at its foot, and inside it the septum and the turbinates. */
function nose(part: Part) {
  // Nasal bones: an arched strip from between the eyes down to the opening's top.
  const rows: Vec3[][] = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    const y = 3.35 + (APERTURE.top + 0.05 - 3.35) * t;
    const w = 0.48 + 0.3 * t;
    const zc = 4.85 + 0.62 * t;
    rows.push(Array.from({ length: 9 }, (_, j) => {
      const s = -1 + (2 * j) / 8;
      return V(s * w, y, zc - 0.5 * s * s);
    }));
  }
  loft(part, rows, () => 0.9);
  // The frontal processes beside them, up to the eye sockets' inner rims.
  const process = [V(1.0, 0.95, 4.95), V(1.08, 2.1, 4.75), V(1.12, 3.3, 4.5)];
  const from = vertexCount(part);
  sweep(part, process, () => ({ n: 0.22, b: 0.3, density: 0.8 }), { up: V(0, 0, 1) });
  mirrorFrom(part, from);
  // The opening's rim, a closed pear.
  const loop: Vec3[] = [];
  const M = 18;
  for (let i = 0; i <= M; i++) {
    const y = APERTURE.bottom + ((APERTURE.top - APERTURE.bottom) * i) / M;
    const w = Math.max(0.12, apertureHalfWidth(y));
    loop.push(V(w, y, 4.82 + 0.4 * ((y - APERTURE.bottom) / (APERTURE.top - APERTURE.bottom)) - 0.22 * (w / APERTURE.width)));
  }
  const pear = [...loop, ...loop.slice(1, -1).reverse().map((p) => V(-p.x, p.y, p.z))];
  sweep(part, pear, (t) => {
    const low = Math.max(0, Math.cos(t * Math.PI * 2));
    return { n: 0.15 + 0.07 * low, b: 0.17, density: 1 };
  }, { closed: true, up: V(0, 0, 1), around: 7 });
  sweep(part, [V(0, -1.95, 5.0), V(0, -1.97, 5.45), V(0, -2.0, 5.75)], (t) => ({ n: 0.16 * (1 - t) + 0.03, b: 0.16 * (1 - t) + 0.03, density: 0.9 }), { caps: 2 });
  // The septum: a thin plate down the middle of the opening, back into the head (edge on, a bright line).
  const septum: Vec3[][] = [];
  for (let k = 0; k <= 4; k++) {
    const y = -1.75 + (2.75 * k) / 4;
    septum.push([V(0, y, 4.75 - 0.15 * (k / 4)), V(0, y, 3.1), V(0, y, 1.5)]);
  }
  loft(part, septum, (_, c) => 0.5 - 0.25 * c);
  const turbinates = vertexCount(part);
  ovoid(part, V(0.62, -0.95, 3.2), V(0.32, 0.42, 1.55), 0.32);
  ovoid(part, V(0.55, 0.0, 2.9), V(0.27, 0.32, 1.35), 0.28);
  mirrorFrom(part, turbinates);
}

/** The cheekbone (the person's left): its body below the eye socket and the arch running back toward the ear. */
function cheek(part: Part) {
  ovoid(part, V(4.95, 0.95, 2.45), V(1.05, 1.0, 0.85), 0.95, V(0, 0.55, 0.15), 16);
  sweep(part, curveThrough([V(5.4, 1.0, 2.0), V(6.3, 1.05, 0.2), V(6.45, 0.95, -1.7), V(6.1, 0.7, -3.3)], 14), (t) => ({ n: 0.43 - 0.1 * t, b: 0.22, density: 1 }), { up: V(0, 1, 0), caps: 2 });
  // Behind the ear, the mastoid.
  ovoid(part, V(5.0, -1.3, -5.2), V(0.7, 1.1, 0.9), 0.85, V(0.25, 0, 0));
}

/** The upper jaw's front plate (the nose's opening cut in it by its shader), from the eye sockets down to the teeth. */
function maxillaPlate(part: Part) {
  const topKeys = [V(-5.1, 0.55, 0.9), V(-4.4, 0.8, 2.75), V(-2.7, 0.85, 3.45), V(-1.25, 1.0, 4.6), V(0, 1.05, 5.0), V(1.25, 1.0, 4.6), V(2.7, 0.85, 3.45), V(4.4, 0.8, 2.75), V(5.1, 0.55, 0.9)];
  const U = 25;
  const top = curveThrough(topKeys, U);
  const bottom = Array.from({ length: U }, (_, i) => {
    const phi = (-1 + (2 * i) / (U - 1)) * PHI_MAX;
    const p = archPoint({ ...UPPER_ARCH, rx: UPPER_ARCH.rx + 0.32, rz: UPPER_ARCH.rz + 0.3 }, phi);
    return V(p.x, -3.3, p.z);
  });
  const rows: Vec3[][] = [];
  const Vn = 9;
  for (let k = 0; k < Vn; k++) {
    const t = k / (Vn - 1);
    rows.push(top.map((tp, i) => {
      const b = bottom[i]!;
      const p = lerp3(b, tp, t);
      // A gentle fullness over the roots and the cheek, outward from the head's middle.
      const out = Math.hypot(p.x, p.z + 1) || 1;
      const bulge = 0.28 * Math.sin(Math.PI * t);
      return V(p.x + (p.x / out) * bulge, p.y, p.z + ((p.z + 1) / out) * bulge);
    }));
  }
  loft(part, rows, (r) => 0.7 + 0.15 * (1 - r));
}

/** The palate: the roof of the mouth, inside the upper teeth. */
function palate(part: Part) {
  const rows: Vec3[][] = [];
  const centre = V(0, -2.75, 1.4);
  for (let k = 0; k <= 4; k++) {
    const t = k / 4;
    rows.push(Array.from({ length: 17 }, (_, i) => {
      const phi = (-1 + (2 * i) / 16) * PHI_MAX;
      const p = archPoint({ ...UPPER_ARCH, rx: UPPER_ARCH.rx - 0.45, rz: UPPER_ARCH.rz - 0.5 }, phi);
      return V(centre.x + (p.x - centre.x) * t, centre.y + (-3.25 - centre.y) * t * t, centre.z + (p.z - centre.z) * t);
    }));
  }
  loft(part, rows, () => 0.45);
}

/** One tooth, standing on its neck: crown toward the biting edge, root into the bone. */
function toothPart(part: Part, kind: ToothKind) {
  const c = kind.crown;
  const L = kind.root;
  const profile = [
    { y: -c, r: 0.0, d: 1.5 },
    { y: -c + 0.04, r: 0.3, d: 1.5 },
    { y: -0.78 * c, r: 0.45, d: 1.55 },
    { y: -0.45 * c, r: 0.5, d: 1.55 },
    { y: -0.1 * c, r: 0.44, d: 1.25 },
    { y: 0, r: 0.4, d: 1.0 },
    { y: 0.3 * L, r: 0.36, d: 0.78 },
    { y: 0.65 * L, r: 0.28, d: 0.7 },
    { y: 0.92 * L, r: 0.15, d: 0.55 },
    { y: L, r: 0.0, d: 0.4 },
  ];
  const taper = (y: number) => (y < 0 ? 1 - kind.edge * Math.min(1, -y / c) ** 1.6 : 1);
  lathe(part, profile, 10, kind.width, kind.thickness, taper);
}

/** A row of teeth along an arch, both sides. `down` is true for the lower row, whose roots point down. */
function teeth(part: Part, arch: Arch, kinds: readonly ToothKind[], down: boolean) {
  const side = teethAlong(arch, kinds);
  for (const mirror of [1, -1]) {
    for (const { phi, kind, edgeY } of side) {
      const from = vertexCount(part);
      toothPart(part, kind);
      const a = archPoint(arch, phi);
      const d = archPoint(arch, phi + 1e-3);
      const tangent = new THREE.Vector3((d.x - a.x) * mirror, 0, d.z - a.z).normalize();
      const outward = new THREE.Vector3(Math.sin(phi) * mirror * arch.rz, 0, Math.cos(phi) * arch.rx).normalize();
      // Front teeth lean their crowns out; the lean fades toward the molars.
      const lean = arch.lean * Math.max(0, 1 - phi / (PHI_MAX * 0.6));
      const rootDir = new THREE.Vector3(0, down ? -1 : 1, 0).multiplyScalar(Math.cos(lean)).addScaledVector(outward, -Math.sin(lean));
      const across = new THREE.Vector3().crossVectors(tangent, rootDir).normalize();
      const neckY = down ? edgeY - kind.crown : edgeY + kind.crown;
      const m = new THREE.Matrix4().makeBasis(tangent, rootDir, across);
      m.setPosition(a.x * mirror, neckY, a.z);
      transformFrom(part, from, m);
    }
  }
}

/** The lower jaw, built closed in head space: its body round from angle to angle, the chin, and each side's ramus. */
function mandible(part: Part) {
  const keys = [...MANDIBLE.map((k) => ({ ...k, p: V(-k.p.x, k.p.y, k.p.z) })), ...MANDIBLE.slice(0, -1).reverse()];
  const S = 44;
  const path = curveThrough(keys.map((k) => k.p), S);
  sweep(part, path, (t) => {
    const f = t * (keys.length - 1);
    const i = Math.min(keys.length - 2, Math.floor(f));
    const u = f - i;
    const a = keys[i]!;
    const b = keys[i + 1]!;
    return { n: a.n + (b.n - a.n) * u, b: a.b + (b.b - a.b) * u, density: 1.05 };
  }, { up: V(0, 1, 0), around: 12, caps: 2 });
  ovoid(part, V(0, -8.0, 3.5), V(1.3, 0.72, 0.5), 0.8);
  const side = vertexCount(part);
  sweep(part, curveThrough(RAMUS.back, 12), (t) => ({ n: 0.34 - 0.08 * t, b: 0.3, density: 1.05 }), { up: V(1, 0, 0), caps: 1 });
  sweep(part, curveThrough(RAMUS.front, 12), (t) => ({ n: 0.26 - 0.13 * t, b: 0.22 - 0.08 * t, density: 1 }), { up: V(1, 0, 0), caps: 2 });
  sweep(part, curveThrough(RAMUS.notch, 9), () => ({ n: 0.13, b: 0.16, density: 0.85 }), { up: V(1, 0, 0), caps: 1 });
  const back = curveThrough(RAMUS.back, 7);
  const front = curveThrough(RAMUS.front, 7);
  loft(part, back.map((b, i) => Array.from({ length: 5 }, (_, j) => lerp3(b, front[i]!, j / 4))), () => 0.38);
  ovoid(part, RAMUS.condyle, V(0.95, 0.42, 0.52), 1.1, V(0, 0.3, 0));
  mirrorFrom(part, side);
}

/** One neck bone at height y: its body, the ring behind it, its spine and its wings. The top two are the atlas and the axis. */
function vertebra(part: Part, level: number, y: number) {
  const z = NECK.z;
  if (level === 0) {
    // The atlas: a ring with no body, wide wings, and the two masses the skull rests on.
    const ring = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return V(Math.sin(a) * 1.55, y, z - 1.0 + Math.cos(a) * 1.35);
    });
    sweep(part, ring, () => ({ n: 0.22, b: 0.26, density: 1 }), { closed: true, up: V(0, 1, 0), around: 7 });
    const masses = vertexCount(part);
    ovoid(part, V(1.35, y, z - 0.75), V(0.55, 0.5, 0.75), 0.95);
    sweep(part, [V(1.7, y, z - 0.85), V(2.6, y + 0.05, z - 0.95), V(3.1, y - 0.05, z - 1.05)], () => ({ n: 0.26, b: 0.3, density: 0.9 }), { caps: 2 });
    mirrorFrom(part, masses);
    return;
  }
  lathe(part, [
    { y: -0.6, r: 0.0, d: 1 }, { y: -0.58, r: 0.75, d: 1 }, { y: -0.45, r: 0.9, d: 1 }, { y: 0, r: 0.8, d: 1 }, { y: 0.45, r: 0.9, d: 1 }, { y: 0.58, r: 0.75, d: 1 }, { y: 0.6, r: 0.0, d: 1 },
  ], 14, 1.2, 0.95);
  const body = vertexCount(part) - 14 * 7;
  transformFrom(part, body, new THREE.Matrix4().makeTranslation(0, y, z));
  if (level === 1) {
    // The axis's peg, up through the atlas's ring.
    sweep(part, [V(0, y + 0.5, z - 0.2), V(0, y + 1.1, z - 0.25), V(0, y + 1.55, z - 0.3)], () => ({ n: 0.4, b: 0.4, density: 1 }), { caps: 3 });
  }
  const ring = Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2;
    return V(Math.sin(a) * 1.05, y + 0.1, z - 1.65 + Math.cos(a) * 0.85);
  });
  sweep(part, ring, () => ({ n: 0.2, b: 0.24, density: 0.95 }), { closed: true, up: V(0, 1, 0), around: 7 });
  sweep(part, [V(0, y + 0.05, z - 2.45), V(0, y - 0.3, z - 3.3), V(0, y - 0.75, z - 3.9)], (t) => ({ n: 0.3 - 0.12 * t, b: 0.2, density: 0.95 }), { caps: 2, up: V(0, 1, 0) });
  const wings = vertexCount(part);
  sweep(part, [V(0.95, y + 0.1, z - 0.85), V(1.75, y + 0.05, z - 1.0), V(2.35, y - 0.05, z - 1.05)], (t) => ({ n: 0.24 - 0.06 * t, b: 0.26, density: 0.9 }), { caps: 2 });
  mirrorFrom(part, wings);
}

function neck(part: Part) {
  const from = vertexCount(part);
  NECK.levels.forEach((y, i) => vertebra(part, i, y));
  fadeFrom(part, from, (p) => {
    const t = Math.min(1, Math.max(0, (p.y - NECK.fadeTo) / (NECK.fadeFrom - NECK.fadeTo)));
    return t * t * (3 - 2 * t);
  });
}

/** A hexagonal prism along x, from x0 to x1. */
function hexAlongX(part: Part, x0: number, x1: number, r: number, y: number, z: number, sides = 6) {
  const from = vertexCount(part);
  lathe(part, [{ y: 0, r: 0, d: 1 }, { y: 0.001, r, d: 1 }, { y: x1 - x0 - 0.001, r, d: 1 }, { y: x1 - x0, r: 0, d: 1 }], sides);
  const m = new THREE.Matrix4().makeRotationZ(-Math.PI / 2).setPosition(x0, y, z);
  transformFrom(part, from, m);
}

/** Franki's bolts, through each side of the neck, and the stitched seam across the brow. */
function marks(part: Part) {
  const bolt = vertexCount(part);
  hexAlongX(part, BOLT.inner, BOLT.outer, 0.3, BOLT.y, BOLT.z, 12);
  hexAlongX(part, BOLT.nut - 0.28, BOLT.nut + 0.28, 0.66, BOLT.y, BOLT.z, 6);
  hexAlongX(part, BOLT.outer - 0.05, BOLT.outer + 0.38, 0.58, BOLT.y, BOLT.z, 6);
  mirrorFrom(part, bolt);
  // The seam: a fine wire across the brow, with stitches over it.
  const line = Array.from({ length: 25 }, (_, i) => {
    const x = -SEAM.halfWidth + (2 * SEAM.halfWidth * i) / 24;
    return onForehead(x, SEAM.y + 0.12 * Math.sin(i * 0.9), 0.06);
  });
  sweep(part, line, () => ({ n: 0.045, b: 0.045 }), { around: 5, caps: 1 });
  for (let k = 0; k < SEAM.stitches; k++) {
    const x = -SEAM.halfWidth + 0.35 + ((2 * SEAM.halfWidth - 0.7) * k) / (SEAM.stitches - 1);
    const h = SEAM.stitchLength / 2;
    const slant = 0.12 * (k % 2 === 0 ? 1 : -1);
    const a = onForehead(x - slant, SEAM.y - h, 0.02);
    const b = onForehead(x + slant, SEAM.y + h, 0.02);
    const m = onForehead(x, SEAM.y, 0.2);
    sweep(part, [a, lerp3(lerp3(a, m, 0.5), m, 0.5), m, lerp3(lerp3(b, m, 0.5), m, 0.5), b], () => ({ n: 0.075, b: 0.075 }), { around: 6, caps: 2 });
  }
}

export interface SkullModel {
  /** Place this with XrayFace.matrix. */
  readonly root: THREE.Group;
  /** Opens the jaw, 0 (shut) to 1. */
  setJaw(open: number): void;
  setOpacity(opacity: number): void;
  dispose(): void;
}

export function buildSkull(marksOn = FRANKI_MARKS): SkullModel {
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  const mesh = (part: Part, material: THREE.ShaderMaterial, parent: THREE.Object3D, order: number) => {
    const g = toGeometry(part);
    geometries.push(g);
    if (!materials.includes(material)) materials.push(material);
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    m.renderOrder = order;
    parent.add(m);
    return m;
  };

  const craniumMat = boneMaterial({ gain: 0.62, cut: CUT.cranium });
  const plateMat = boneMaterial({ gain: 0.6, cut: CUT.aperture });
  const boneMat = boneMaterial({ gain: 0.78 });
  const jawMat = boneMaterial({ gain: 0.78 });

  const c = emptyPart();
  cranium(c);
  mesh(c, craniumMat, root, 1);

  const face = emptyPart();
  sutures(face);
  brow(face);
  const orbits = vertexCount(face);
  orbit(face);
  mirrorFrom(face, orbits);
  nose(face);
  const cheeks = vertexCount(face);
  cheek(face);
  mirrorFrom(face, cheeks);
  palate(face);
  teeth(face, UPPER_ARCH, UPPER_TEETH, false);
  neck(face);
  mesh(face, boneMat, root, 2);

  const plate = emptyPart();
  maxillaPlate(plate);
  mesh(plate, plateMat, root, 2);

  // The jaw is built closed in head space, then moved so its hinge is its own origin.
  const jaw = emptyPart();
  mandible(jaw);
  teeth(jaw, LOWER_ARCH, LOWER_TEETH, true);
  transformFrom(jaw, 0, new THREE.Matrix4().makeTranslation(-JAW_PIVOT.x, -JAW_PIVOT.y, -JAW_PIVOT.z));
  const hinge = new THREE.Group();
  hinge.position.set(JAW_PIVOT.x, JAW_PIVOT.y, JAW_PIVOT.z);
  root.add(hinge);
  mesh(jaw, jawMat, hinge, 2);

  let metalMat: THREE.ShaderMaterial | null = null;
  if (marksOn) {
    metalMat = metalMaterial();
    const metal = emptyPart();
    marks(metal);
    mesh(metal, metalMat, root, 3);
  }

  return {
    root,
    setJaw(open) {
      const o = Math.min(1, Math.max(0, Number.isFinite(open) ? open : 0));
      hinge.rotation.x = o * JAW_OPEN;
      hinge.position.z = JAW_PIVOT.z + o * JAW_SLIDE;
    },
    setOpacity(opacity) {
      for (const m of materials) setOpacity(m, opacity);
      root.visible = opacity > 0.001;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
