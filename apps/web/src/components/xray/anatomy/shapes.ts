// Shape builders for the bones (brief 051 part C): tubes swept along a path with an oval section, lofted sheets,
// lathed profiles and ovoids, written as plain arrays and merged into one BufferGeometry per part. Every vertex
// carries `aDensity`, how much bone it stands for: the shader multiplies its glow by it, so enamel can be brighter
// than bone and the neck and the forearm can fade away. No model files.
import * as THREE from "three";
import type { Vec3 } from "./bone-place";

export interface Part {
  readonly position: number[];
  readonly normal: number[];
  readonly density: number[];
  readonly index: number[];
}

export const emptyPart = (): Part => ({ position: [], normal: [], density: [], index: [] });

const v3 = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

function push(part: Part, p: THREE.Vector3, n: THREE.Vector3, d: number): number {
  const i = part.position.length / 3;
  part.position.push(p.x, p.y, p.z);
  const len = n.length();
  if (len > 1e-12) part.normal.push(n.x / len, n.y / len, n.z / len);
  else part.normal.push(0, 1, 0);
  part.density.push(d);
  return i;
}

/** Joins a grid of `rows` by `cols` vertices (row major, starting at `base`) into triangles. */
function grid(part: Part, base: number, rows: number, cols: number, wrapCols: boolean, wrapRows = false) {
  const cMax = wrapCols ? cols : cols - 1;
  const rMax = wrapRows ? rows : rows - 1;
  for (let r = 0; r < rMax; r++) {
    for (let c = 0; c < cMax; c++) {
      const a = base + r * cols + c;
      const b = base + r * cols + ((c + 1) % cols);
      const d = base + ((r + 1) % rows) * cols + c;
      const e = base + ((r + 1) % rows) * cols + ((c + 1) % cols);
      part.index.push(a, d, b, b, d, e);
    }
  }
}

export interface Section {
  /** Radius along the path's normal (the `up` hint, kept square to the path). */
  readonly n: number;
  /** Radius along the binormal. */
  readonly b: number;
  readonly density?: number;
}

export interface SweepOptions {
  readonly closed?: boolean;
  /** Vertices round the section. */
  readonly around?: number;
  /** Which way the section's normal radius points; kept square to the path. Parallel transport when left out. */
  readonly up?: Vec3;
  /** Rings of a rounded end on an open tube; 0 leaves it open. */
  readonly caps?: number;
  /** Turns the section about the path, radians. */
  readonly twist?: number;
}

/** A tube along `path`, its oval section given for each point (`t` runs 0 to 1 along the path). */
export function sweep(part: Part, path: readonly Vec3[], section: (t: number, i: number) => Section, opts: SweepOptions = {}): Part {
  const closed = opts.closed ?? false;
  const around = opts.around ?? 10;
  const caps = closed ? 0 : (opts.caps ?? 3);
  const pts = path.map(v3);
  const count = pts.length;
  if (count < 2) return part;
  const tangents: THREE.Vector3[] = pts.map((p, i) => {
    const prev = pts[closed ? (i - 1 + count) % count : Math.max(0, i - 1)]!;
    const next = pts[closed ? (i + 1) % count : Math.min(count - 1, i + 1)]!;
    const t = next.clone().sub(prev);
    return t.lengthSq() > 1e-20 ? t.normalize() : new THREE.Vector3(0, 1, 0);
  });
  const normals: THREE.Vector3[] = [];
  const up = opts.up ? v3(opts.up).normalize() : null;
  for (let i = 0; i < count; i++) {
    const t = tangents[i]!;
    let n: THREE.Vector3;
    if (up !== null && Math.abs(up.dot(t)) < 0.98) n = up.clone().sub(t.clone().multiplyScalar(up.dot(t))).normalize();
    else if (i > 0) {
      const prev = normals[i - 1]!;
      n = prev.clone().sub(t.clone().multiplyScalar(prev.dot(t)));
      n = n.lengthSq() > 1e-12 ? n.normalize() : prev.clone();
    } else {
      const seed = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      n = seed.sub(t.clone().multiplyScalar(seed.dot(t))).normalize();
    }
    normals.push(n);
  }
  const twist = opts.twist ?? 0;
  const ring = (center: THREE.Vector3, t: THREE.Vector3, n: THREE.Vector3, s: Section, shrink: number, along: number) => {
    const bn = new THREE.Vector3().crossVectors(t, n).normalize();
    const base = part.position.length / 3;
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2 + twist;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const p = center.clone().addScaledVector(n, ca * s.n * shrink).addScaledVector(bn, sa * s.b * shrink).addScaledVector(t, along);
      // The oval's own normal, tipped along the path on a rounded end.
      const nn = n.clone().multiplyScalar(ca / Math.max(s.n, 1e-6)).addScaledVector(bn, sa / Math.max(s.b, 1e-6)).normalize();
      if (shrink < 1) nn.multiplyScalar(shrink).addScaledVector(t, Math.sign(along) * Math.sqrt(Math.max(0, 1 - shrink * shrink)));
      push(part, p, nn, s.density ?? 1);
    }
    return base;
  };
  const start = part.position.length / 3;
  let rows = 0;
  const end0 = section(0, 0);
  for (let c = caps; c >= 1; c--) {
    const a = (c / (caps + 1)) * (Math.PI / 2);
    ring(pts[0]!, tangents[0]!, normals[0]!, end0, Math.cos(a), -Math.sin(a) * Math.min(end0.n, end0.b));
    rows++;
  }
  for (let i = 0; i < count; i++) {
    ring(pts[i]!, tangents[i]!, normals[i]!, section(count === 1 ? 0 : i / (count - 1), i), 1, 0);
    rows++;
  }
  const end1 = section(1, count - 1);
  for (let c = 1; c <= caps; c++) {
    const a = (c / (caps + 1)) * (Math.PI / 2);
    ring(pts[count - 1]!, tangents[count - 1]!, normals[count - 1]!, end1, Math.cos(a), Math.sin(a) * Math.min(end1.n, end1.b));
    rows++;
  }
  grid(part, start, rows, around, true, closed);
  return part;
}

/**
 * A sheet through `rows`, each a line of points (all rows the same length). Normals from the sheet's own slopes; the
 * shader draws both sides. `wrap` closes each row into a loop.
 */
export function loft(part: Part, rows: readonly (readonly Vec3[])[], density: (r: number, c: number) => number = () => 1, wrap = false): Part {
  const R = rows.length;
  const C = rows[0]?.length ?? 0;
  if (R < 2 || C < 2) return part;
  const P = rows.map((row) => row.map(v3));
  const at = (r: number, c: number) => P[Math.min(R - 1, Math.max(0, r))]![wrap ? (c + C) % C : Math.min(C - 1, Math.max(0, c))]!;
  const start = part.position.length / 3;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const du = at(r, c + 1).clone().sub(at(r, c - 1));
      const dv = at(r + 1, c).clone().sub(at(r - 1, c));
      const n = new THREE.Vector3().crossVectors(du, dv);
      push(part, P[r]![c]!, n, density(r / (R - 1), c / (wrap ? C : C - 1)));
    }
  }
  grid(part, start, R, C, wrap);
  return part;
}

/** A closed ovoid at `center` with three radii, turned by `turn` (Euler, radians). */
export function ovoid(part: Part, center: Vec3, radii: Vec3, density = 1, turn: Vec3 = { x: 0, y: 0, z: 0 }, segs = 14): Part {
  const rows = Math.max(4, Math.round(segs * 0.7));
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(turn.x, turn.y, turn.z));
  const start = part.position.length / 3;
  for (let r = 0; r <= rows; r++) {
    const v = (r / rows) * Math.PI - Math.PI / 2;
    for (let c = 0; c < segs; c++) {
      const u = (c / segs) * Math.PI * 2;
      const d = new THREE.Vector3(Math.cos(v) * Math.sin(u), Math.sin(v), Math.cos(v) * Math.cos(u));
      const p = new THREE.Vector3(d.x * radii.x, d.y * radii.y, d.z * radii.z).applyMatrix4(m).add(v3(center));
      const n = new THREE.Vector3(d.x / radii.x, d.y / radii.y, d.z / radii.z).applyMatrix4(m);
      push(part, p, n, density);
    }
  }
  grid(part, start, rows + 1, segs, true);
  return part;
}

/** A profile turned about +y: each step a height, a radius, and a density. The section is scaled by `sx` and `sz`. */
export function lathe(part: Part, profile: readonly { y: number; r: number; d: number }[], around = 12, sx = 1, sz = 1, zTaper?: (y: number) => number): Part {
  const start = part.position.length / 3;
  profile.forEach((s, i) => {
    const prev = profile[Math.max(0, i - 1)]!;
    const next = profile[Math.min(profile.length - 1, i + 1)]!;
    const dy = next.y - prev.y;
    const dr = next.r - prev.r;
    const zk = zTaper ? zTaper(s.y) : 1;
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const p = new THREE.Vector3(ca * s.r * sx, s.y, sa * s.r * sz * zk);
      // The profile's normal (dy, -dr) turned round, through the section's scale.
      const n = new THREE.Vector3((ca * dy) / Math.max(sx, 1e-6), -dr, (sa * dy) / Math.max(sz * zk, 1e-6));
      push(part, p, n, s.d);
    }
  });
  grid(part, start, profile.length, around, true);
  return part;
}

/** Moves every vertex added to `part` from `from` onward by `m`. */
export function transformFrom(part: Part, from: number, m: THREE.Matrix4): Part {
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const p = new THREE.Vector3();
  for (let i = from; i < part.position.length / 3; i++) {
    p.set(part.position[i * 3]!, part.position[i * 3 + 1]!, part.position[i * 3 + 2]!).applyMatrix4(m);
    part.position[i * 3] = p.x;
    part.position[i * 3 + 1] = p.y;
    part.position[i * 3 + 2] = p.z;
    p.set(part.normal[i * 3]!, part.normal[i * 3 + 1]!, part.normal[i * 3 + 2]!).applyMatrix3(nm).normalize();
    part.normal[i * 3] = p.x;
    part.normal[i * 3 + 1] = p.y;
    part.normal[i * 3 + 2] = p.z;
  }
  return part;
}

/** Multiplies the density of every vertex added from `from` onward by `f(position)`. */
export function fadeFrom(part: Part, from: number, f: (p: Vec3) => number): Part {
  for (let i = from; i < part.position.length / 3; i++) {
    part.density[i] = part.density[i]! * f({ x: part.position[i * 3]!, y: part.position[i * 3 + 1]!, z: part.position[i * 3 + 2]! });
  }
  return part;
}

/** Copies every vertex added from `from` onward, mirrored across x = 0 (the head's own left and right). */
export function mirrorFrom(part: Part, from: number): Part {
  const vFrom = from;
  const vTo = part.position.length / 3;
  const iFrom = part.index.findIndex((i) => i >= vFrom);
  const offset = vTo - vFrom;
  for (let i = vFrom; i < vTo; i++) {
    part.position.push(-part.position[i * 3]!, part.position[i * 3 + 1]!, part.position[i * 3 + 2]!);
    part.normal.push(-part.normal[i * 3]!, part.normal[i * 3 + 1]!, part.normal[i * 3 + 2]!);
    part.density.push(part.density[i]!);
  }
  if (iFrom < 0) return part;
  const tris = part.index.slice(iFrom);
  for (let k = 0; k < tris.length; k += 3) part.index.push(tris[k]! + offset, tris[k + 2]! + offset, tris[k + 1]! + offset);
  return part;
}

export const vertexCount = (part: Part) => part.position.length / 3;

/** The part as a BufferGeometry with `position`, `normal` and `aDensity`. */
export function toGeometry(part: Part): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(part.position, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(part.normal, 3));
  g.setAttribute("aDensity", new THREE.Float32BufferAttribute(part.density, 1));
  g.setIndex(part.index);
  g.computeBoundingSphere();
  return g;
}
