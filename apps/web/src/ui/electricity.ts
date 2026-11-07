// Electricity paths (lab-ui-foundation R10.3). Pure: a seeded PRNG, no random source.

export interface Point {
  x: number;
  y: number;
}

/** mulberry32: a small seeded PRNG returning numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Largest first displacement as a share of the segment length; the sum over all levels stays below 1/2. */
const ROUGHNESS = 0.24;

/**
 * A jagged path from `a` to `b` by midpoint displacement: `2^depth + 1` points, each midpoint pushed
 * perpendicular to the a-b line by up to half the previous amount. Same seed, same path.
 */
export function boltPath(a: Point, b: Point, seed: number, depth: number): Point[] {
  const d = Math.max(0, Math.min(10, Math.floor(depth)));
  const rand = mulberry32(seed);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const nx = length === 0 ? 0 : -dy / length;
  const ny = length === 0 ? 0 : dx / length;
  let points: Point[] = [{ ...a }, { ...b }];
  let amplitude = length * ROUGHNESS;
  for (let level = 0; level < d; level++) {
    const next: Point[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1];
      const q = points[i];
      const offset = (rand() * 2 - 1) * amplitude;
      next.push({ x: (p.x + q.x) / 2 + nx * offset, y: (p.y + q.y) / 2 + ny * offset }, q);
    }
    points = next;
    amplitude /= 2;
  }
  return points;
}

/** Frame_Time gap before the next regeneration: an integer from 60 to 90 ms. */
export function regenGapMs(seed: number): number {
  return 60 + Math.floor(mulberry32(seed)() * 31);
}

/** SVG `points` attribute text for a path. */
export function toPolyline(points: readonly Point[]): string {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}
