// The skull's measurements (brief 051 part C), in the canonical head's centimetres (+x the person's left, +y up, +z
// out of the face; see canonical.ts). Pure numbers. They were set against MediaPipe's canonical head: the bone sits
// about half a centimetre under the forehead's skin and a centimetre or more under the cheeks and the jaw, the eye
// sockets sit round the eye corners, the nose's opening under the nose, the teeth behind the lips, and the jaw's hinge
// just in front of where the ear would be.
import type { Vec3 } from "./bone-place";

/** The cranium: an ovoid in two halves (above and below its middle, in front of and behind it). */
export const CRANIUM = { cy: 3.6, cz: -4.0, ax: 7.0, up: 9.4, down: 5.4, front: 9.0, back: 9.4 } as const;

/** A point on the cranium, straight out from its middle along `d` (any length). */
export function craniumAlong(d: Vec3): Vec3 {
  const n = Math.hypot(d.x, d.y, d.z) || 1;
  const x = d.x / n;
  const y = d.y / n;
  const z = d.z / n;
  const ay = y >= 0 ? CRANIUM.up : CRANIUM.down;
  const az = z >= 0 ? CRANIUM.front : CRANIUM.back;
  const r = 1 / Math.sqrt((x / CRANIUM.ax) ** 2 + (y / ay) ** 2 + (z / az) ** 2);
  // A little fuller at the back of the head, low down, as the occiput is.
  const bun = z < 0 ? 1 + 0.035 * Math.exp(-(((y + 0.1) / 0.45) ** 2)) * z * z : 1;
  return { x: x * r, y: CRANIUM.cy + y * r * bun, z: CRANIUM.cz + z * r * bun };
}

/** The cranium's front surface at (x, y), where it has one; else null. */
export function craniumFrontZ(x: number, y: number): number | null {
  const ay = y >= CRANIUM.cy ? CRANIUM.up : CRANIUM.down;
  const k = 1 - (x / CRANIUM.ax) ** 2 - ((y - CRANIUM.cy) / ay) ** 2;
  return k >= 0 ? CRANIUM.cz + CRANIUM.front * Math.sqrt(k) : null;
}

/** The brow line the cranium is cut along (the same function as the shader's `browY`). */
export function browY(x: number): number {
  const ax = Math.abs(x);
  const t = Math.min(1, Math.max(0, (ax - 4.2) / 1.4));
  return 3.75 + 0.75 * Math.sin((Math.PI * ax) / 6.4) - 1.6 * t * t * (3 - 2 * t);
}

/** One eye socket's rim, the person's left (+x); the right is its mirror. */
export const ORBIT = { cx: 3.2, cy: 2.5, rx: 2.0, ry: 1.72, squareness: 2.6, tilt: -0.1 } as const;

/** A point on the left eye socket's rim at angle `a` (0 the outer side, going up). */
export function orbitRim(a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const e = 2 / ORBIT.squareness;
  const x = ORBIT.cx + ORBIT.rx * Math.sign(c) * Math.abs(c) ** e;
  const yy = ORBIT.ry * Math.sign(s) * Math.abs(s) ** e;
  const y = ORBIT.cy + yy + ORBIT.tilt * (x - ORBIT.cx);
  // The outer rim sits well back of the inner one, and the top (under the brow) forward of the floor.
  const z = 3.35 - 0.52 * (x - ORBIT.cx) + 0.5 * Math.max(0, yy / ORBIT.ry);
  return { x, y, z };
}

/** The rim's thickness round the socket: heavy above and outside, thin on the nose's side. */
export function orbitRimRadius(a: number): number {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return 0.27 + 0.08 * Math.max(0, s) + 0.06 * Math.max(0, c) - 0.1 * Math.max(0, -c) * (1 - Math.max(0, s));
}

/** The nose's opening: its half width at height y, from its floor to its top. */
export const APERTURE = { bottom: -1.9, top: 1.15, width: 1.22 } as const;

export function apertureHalfWidth(y: number): number {
  const s = Math.min(1, Math.max(0, (y - APERTURE.bottom) / (APERTURE.top - APERTURE.bottom)));
  return APERTURE.width * Math.sin(Math.PI * s ** 0.72) ** 0.75 * (1 - 0.42 * s);
}

/** The teeth, from the middle back: central and side incisor, canine, two premolars, three molars. */
export interface ToothKind {
  /** Across, labio-lingual, crown height and root length, cm. */
  readonly width: number;
  readonly thickness: number;
  readonly crown: number;
  readonly root: number;
  /** How thin the biting edge is, 0 (a molar's table) to 1 (a blade). */
  readonly edge: number;
}

const tooth = (width: number, thickness: number, crown: number, root: number, edge: number): ToothKind => ({ width, thickness, crown, root, edge });

export const UPPER_TEETH: readonly ToothKind[] = [
  tooth(0.86, 0.7, 1.05, 1.3, 0.65), tooth(0.66, 0.62, 0.9, 1.3, 0.6), tooth(0.76, 0.8, 1.0, 1.7, 0.35), tooth(0.7, 0.9, 0.82, 1.4, 0.1),
  tooth(0.66, 0.9, 0.75, 1.4, 0.1), tooth(1.02, 1.1, 0.72, 1.25, 0), tooth(0.9, 1.05, 0.68, 1.2, 0), tooth(0.85, 1.0, 0.62, 1.05, 0),
];

export const LOWER_TEETH: readonly ToothKind[] = [
  tooth(0.54, 0.6, 0.9, 1.25, 0.65), tooth(0.6, 0.62, 0.92, 1.35, 0.6), tooth(0.7, 0.75, 1.0, 1.6, 0.35), tooth(0.7, 0.8, 0.82, 1.45, 0.1),
  tooth(0.72, 0.85, 0.78, 1.45, 0.1), tooth(1.12, 1.05, 0.75, 1.3, 0), tooth(1.05, 1.0, 0.72, 1.25, 0), tooth(1.0, 0.95, 0.68, 1.1, 0),
];

/** A dental arch: half an ellipse, x = rx sin(phi), z = z0 + rz cos(phi), out to phi = PHI_MAX each side. */
export interface Arch {
  readonly rx: number;
  readonly rz: number;
  readonly z0: number;
  /** The biting edge's height at the front, and how much it rises toward the back. */
  readonly edgeY: number;
  readonly rise: number;
  /** How far the crowns lean forward of their roots, radians. */
  readonly lean: number;
}

export const PHI_MAX = 1.75;
/** The upper teeth's necks; the biting edge is below them. */
export const UPPER_ARCH: Arch = { rx: 2.65, rz: 4.1, z0: 0.15, edgeY: -4.3, rise: 0.22, lean: 0.3 };
/** The lower teeth's necks, a little inside the upper's (the bite), the edges a little above the upper's. */
export const LOWER_ARCH: Arch = { rx: 2.5, rz: 3.85, z0: 0.05, edgeY: -4.1, rise: 0.24, lean: 0.38 };

export function archPoint(a: Arch, phi: number): { x: number; z: number } {
  return { x: a.rx * Math.sin(phi), z: a.z0 + a.rz * Math.cos(phi) };
}

/** Where each tooth of one side stands along an arch: its angle, its kind, and its turn along the arch. */
export function teethAlong(a: Arch, kinds: readonly ToothKind[]): { phi: number; kind: ToothKind; edgeY: number }[] {
  // Arc length along the arch, sampled finely, to space the teeth by their widths.
  const steps = 400;
  const lengths = [0];
  for (let i = 1; i <= steps; i++) {
    const p = archPoint(a, ((i - 1) / steps) * PHI_MAX);
    const q = archPoint(a, (i / steps) * PHI_MAX);
    lengths.push(lengths[i - 1]! + Math.hypot(q.x - p.x, q.z - p.z));
  }
  const total = lengths[steps]!;
  const widths = kinds.reduce((s, k) => s + k.width, 0);
  const k = total / widths;
  const phiAt = (len: number) => {
    let i = 1;
    while (i < steps && lengths[i]! < len) i++;
    const t = (len - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]! || 1);
    return ((i - 1 + t) / steps) * PHI_MAX;
  };
  let along = 0;
  return kinds.map((kind) => {
    const phi = phiAt((along + kind.width / 2) * k);
    along += kind.width;
    const f = phi / PHI_MAX;
    return { phi, kind, edgeY: a.edgeY + a.rise * f * f };
  });
}

/** The jaw's hinge: the middle of the line between the two condyles. */
export const JAW_PIVOT: Vec3 = { x: 0, y: 0.15, z: -3.85 };
/** How far the jaw swings open at XrayFace.jaw = 1, radians, and how far the condyles slide forward as it does. */
export const JAW_OPEN = 0.45;
export const JAW_SLIDE = 0.45;

/** The jaw's body, keypoints from its left angle to the chin: centre, height (radius) and thickness (radius). */
export const MANDIBLE: readonly { p: Vec3; n: number; b: number }[] = [
  { p: { x: 4.75, y: -6.45, z: -3.1 }, n: 0.62, b: 0.42 },
  { p: { x: 3.65, y: -6.1, z: -1.85 }, n: 1.1, b: 0.58 },
  { p: { x: 3.05, y: -6.15, z: -0.55 }, n: 1.28, b: 0.68 },
  { p: { x: 2.7, y: -6.45, z: 1.0 }, n: 1.42, b: 0.62 },
  { p: { x: 1.85, y: -6.7, z: 2.45 }, n: 1.6, b: 0.6 },
  { p: { x: 0, y: -6.95, z: 3.25 }, n: 1.85, b: 0.7 },
];

/** The jaw's upright part, the person's left: its back edge up to the condyle, its front edge up to the coronoid. */
export const RAMUS = {
  back: [{ x: 4.75, y: -6.45, z: -3.1 }, { x: 4.95, y: -4.2, z: -3.95 }, { x: 5.05, y: -1.8, z: -4.15 }, { x: 5.05, y: -0.4, z: -3.95 }],
  front: [{ x: 3.8, y: -5.2, z: -1.55 }, { x: 4.25, y: -3.4, z: -1.7 }, { x: 4.45, y: -1.4, z: -1.95 }, { x: 4.55, y: -0.2, z: -2.2 }],
  notch: [{ x: 4.55, y: -0.2, z: -2.2 }, { x: 4.75, y: -1.2, z: -3.0 }, { x: 5.0, y: -0.45, z: -3.85 }],
  condyle: { x: 5.05, y: 0.15, z: -3.85 },
} as const;

/**
 * The neck bones' heights (the middle of each body), about 1.9 cm apart. The top four hide behind the jaw from the
 * front; the ones below the chin (the canonical chin is at y -9.4) show, fading out downward from fadeFrom to fadeTo.
 * Nothing below the neck is drawn.
 */
export const NECK = { z: -4.7, levels: [-1.75, -3.5, -5.4, -7.3, -9.2, -11.1, -13.0, -14.9], fadeFrom: -10.6, fadeTo: -16.6 } as const;

/**
 * Franki's bolts: two short bolts, one each side of the neck, from just outside the neck bones' wings (inner) out past
 * the skin (outer, where the head is). Set 2.8 cm below the chin's level and back near the spine, so from the front
 * they never cross the teeth or the chin, turned or nodded. The gap between them is the neck.
 */
export const BOLT = { y: -12.2, z: -4.4, inner: 2.0, outer: 5.3, nut: 4.3 } as const;
/** The stitched seam across the brow. */
export const SEAM = { y: 6.15, halfWidth: 5.0, stitches: 11, stitchLength: 0.95 } as const;
