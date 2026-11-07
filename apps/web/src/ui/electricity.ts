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
 * perpendicular to the a-b line by between half and all of the level's amplitude, which halves each
 * level. The floor of half keeps every midpoint a visible kink (Brief 004 item 5). Same seed, same path.
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
      const sign = rand() < 0.5 ? -1 : 1;
      const offset = sign * (0.5 + 0.5 * rand()) * amplitude;
      next.push({ x: (p.x + q.x) / 2 + nx * offset, y: (p.y + q.y) / 2 + ny * offset }, q);
    }
    points = next;
    amplitude /= 2;
  }
  return points;
}

/** Side branches: how many, how long (a share of the bolt's mean leg), how far they turn off the trunk. */
export const BRANCH = { min: 1, max: 2, minShare: 0.16, maxShare: 0.3, minTurn: 0.45, maxTurn: 0.85, depth: 2 } as const;

/** A bolt: the jagged trunk through every waypoint, and its short side branches. */
export interface Bolt {
  trunk: Point[];
  branches: Point[][];
}

/**
 * One or two short side branches off interior trunk points. Each starts exactly on a trunk point,
 * turns 26 to 49 degrees off the trunk's local direction, and is a small jagged path of its own.
 */
export function boltBranches(trunk: readonly Point[], seed: number, scale: number): Point[][] {
  if (trunk.length < 3 || !(scale > 0)) return [];
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const count = rand() < 0.5 ? BRANCH.min : BRANCH.max;
  const branches: Point[][] = [];
  for (let k = 0; k < count; k++) {
    const i = 1 + Math.floor(rand() * (trunk.length - 2));
    const p = trunk[i];
    const prev = trunk[i - 1];
    const next = trunk[i + 1];
    const dir = Math.atan2(next.y - prev.y, next.x - prev.x);
    const turn = (rand() < 0.5 ? -1 : 1) * (BRANCH.minTurn + (BRANCH.maxTurn - BRANCH.minTurn) * rand());
    const len = scale * (BRANCH.minShare + (BRANCH.maxShare - BRANCH.minShare) * rand());
    const end = { x: p.x + Math.cos(dir + turn) * len, y: p.y + Math.sin(dir + turn) * len };
    branches.push(boltPath(p, end, (seed * 31 + k + 1) >>> 0, BRANCH.depth));
  }
  return branches;
}

/**
 * A bolt through `waypoints` (at least two): a boltPath per leg, joined so each waypoint appears
 * once, at index k * 2^depth. Branch length scales with the mean leg length.
 */
export function bolt(waypoints: readonly Point[], seed: number, depth: number): Bolt {
  if (waypoints.length < 2) return { trunk: waypoints.map((p) => ({ ...p })), branches: [] };
  const trunk: Point[] = [];
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const leg = boltPath(waypoints[i - 1], waypoints[i], (seed + i * 101) >>> 0, depth);
    trunk.push(...(i === 1 ? leg : leg.slice(1)));
    total += Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].y - waypoints[i - 1].y);
  }
  return { trunk, branches: boltBranches(trunk, seed, total / (waypoints.length - 1)) };
}

/** Frame_Time gap before the next regeneration: an integer from 60 to 90 ms. */
export function regenGapMs(seed: number): number {
  return 60 + Math.floor(mulberry32(seed)() * 31);
}

/** SVG `points` attribute text for a path. */
export function toPolyline(points: readonly Point[]): string {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}
