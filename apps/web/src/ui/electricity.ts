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

/**
 * Midpoint displacement shape. The first displacement is at most ROUGHNESS of the a-b length and each
 * level's amplitude is DECAY of the last, so the sum over all levels, ROUGHNESS / (1 - DECAY), stays
 * below 1/2. A DECAY a little over a half keeps the fine levels as rough, for their size, as the coarse
 * ones without fuzzing a long arc at avatar size.
 */
export const ROUGHNESS = 0.23;
export const DECAY = 0.52;

/**
 * How far an interior waypoint may move outward (away from the middle of the waypoints) each time the
 * bolt regenerates, as a share of its shorter neighbouring leg. It makes a long arc wander as a whole
 * instead of vibrating along one fixed outline, and only ever outward, so it never cuts into the head.
 */
export const WANDER = 0.22;

/**
 * A jagged path from `a` to `b` by midpoint displacement: `2^depth + 1` points. Each level splits every
 * segment near its middle (35 to 65 percent along it, so the pieces come out uneven) and pushes the new
 * point off that segment's own direction by between half and all of the level's amplitude. The floor
 * of half keeps every split a visible kink (Brief 004 item 5). Every point stays within the summed
 * amplitudes, under half the a-b length, of the segment a-b. Same seed, same path.
 */
export function boltPath(a: Point, b: Point, seed: number, depth: number): Point[] {
  const d = Math.max(0, Math.min(10, Math.floor(depth)));
  const rand = mulberry32(seed);
  let points: Point[] = [{ ...a }, { ...b }];
  let amplitude = Math.hypot(b.x - a.x, b.y - a.y) * ROUGHNESS;
  for (let level = 0; level < d; level++) {
    const next: Point[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1];
      const q = points[i];
      const sx = q.x - p.x;
      const sy = q.y - p.y;
      const seg = Math.hypot(sx, sy);
      const t = 0.35 + 0.3 * rand();
      const sign = rand() < 0.5 ? -1 : 1;
      const offset = seg === 0 ? 0 : (sign * (0.5 + 0.5 * rand()) * amplitude) / seg;
      next.push({ x: p.x + sx * t - sy * offset, y: p.y + sy * t + sx * offset }, q);
    }
    points = next;
    amplitude *= DECAY;
  }
  return points;
}

/**
 * Side branches. One to `max` primaries come off the trunk (one fewer on a bolt of one or two legs).
 * Each is `share` of the bolt's scale (its length over the square root of its leg count) times 0.55
 * to 1, so a long arc gets long branches without a short spark's branches swallowing it. Each turns
 * `minTurn` to `maxTurn` radians off the trunk's local direction. A primary forks once with
 * probability `fork`, into a twig of `twig` of its length.
 */
export const BRANCH = {
  min: 1,
  max: 3,
  share: 0.32,
  minTurn: 0.35,
  maxTurn: 0.8,
  fork: 0.65,
  twig: { min: 0.4, max: 0.65 },
  depth: 3,
  twigDepth: 2,
} as const;

/** A bolt: the jagged trunk through every waypoint, its side branches, and the twigs forking off those. */
export interface Bolt {
  trunk: Point[];
  branches: Point[][];
  twigs: Point[][];
}

function along(p: Point, angle: number, length: number): Point {
  return { x: p.x + Math.cos(angle) * length, y: p.y + Math.sin(angle) * length };
}

/** The local direction of a path at index i. */
function directionAt(path: readonly Point[], i: number): number {
  const prev = path[Math.max(0, i - 1)];
  const next = path[Math.min(path.length - 1, i + 1)];
  return Math.atan2(next.y - prev.y, next.x - prev.x);
}

/**
 * Where an offshoot from `p` ends: `len` away, turned `minTurn` to `maxTurn` off the parent's direction
 * `dir`, to a random side, or with `away` to whichever side ends farther from that point.
 */
function offshoot(p: Point, dir: number, len: number, rand: () => number, away?: Point): Point {
  const turn = BRANCH.minTurn + (BRANCH.maxTurn - BRANCH.minTurn) * rand();
  const coin = rand() < 0.5 ? -1 : 1;
  const l = along(p, dir - turn, len);
  const r = along(p, dir + turn, len);
  if (!away) return coin < 0 ? l : r;
  return Math.hypot(l.x - away.x, l.y - away.y) > Math.hypot(r.x - away.x, r.y - away.y) ? l : r;
}

/**
 * Branches off interior trunk points (kept out of the first and last tenth), each a small jagged path
 * that starts exactly on its trunk point, and twigs that start exactly on an interior point of their
 * branch. With `away`, a branch turns to whichever side ends farther from that point (the middle of
 * the waypoints), so an arc over the head branches outward, not into the face.
 */
export function boltBranches(
  trunk: readonly Point[],
  seed: number,
  scale: number,
  legs = 1,
  away?: Point,
): { branches: Point[][]; twigs: Point[][] } {
  if (trunk.length < 3 || !(scale > 0)) return { branches: [], twigs: [] };
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const most = legs >= 3 ? BRANCH.max : BRANCH.max - 1;
  const count = BRANCH.min + Math.floor(rand() * (most - BRANCH.min + 1));
  const lo = Math.max(1, Math.floor(trunk.length * 0.1));
  const hi = Math.max(lo, Math.min(trunk.length - 2, Math.ceil(trunk.length * 0.9) - 1));
  const branches: Point[][] = [];
  const twigs: Point[][] = [];
  for (let k = 0; k < count; k++) {
    const i = lo + Math.floor(rand() * (hi - lo + 1));
    const p = trunk[i];
    const dir = directionAt(trunk, i);
    const len = scale * BRANCH.share * (0.55 + 0.45 * rand());
    const branch = boltPath(p, offshoot(p, dir, len, rand, away), (seed * 31 + k + 1) >>> 0, BRANCH.depth);
    branches.push(branch);
    if (rand() < BRANCH.fork) {
      const j = 2 + Math.floor(rand() * (branch.length - 4));
      const q = branch[j];
      const twigLen = len * (BRANCH.twig.min + (BRANCH.twig.max - BRANCH.twig.min) * rand());
      twigs.push(boltPath(q, offshoot(q, directionAt(branch, j), twigLen, rand, away), (seed * 37 + k + 7) >>> 0, BRANCH.twigDepth));
    }
  }
  return { branches, twigs };
}

/**
 * The waypoints this bolt passes through: the ends exactly, each interior waypoint moved outward from
 * `middle` by up to WANDER of its shorter neighbouring leg.
 */
export function wander(waypoints: readonly Point[], seed: number, middle: Point): Point[] {
  const rand = mulberry32((seed ^ 0x85ebca6b) >>> 0);
  return waypoints.map((w, i) => {
    if (i === 0 || i === waypoints.length - 1) return { ...w };
    const prev = waypoints[i - 1];
    const next = waypoints[i + 1];
    const reach = WANDER * Math.min(Math.hypot(w.x - prev.x, w.y - prev.y), Math.hypot(next.x - w.x, next.y - w.y)) * rand();
    const dx = w.x - middle.x;
    const dy = w.y - middle.y;
    const d = Math.hypot(dx, dy);
    return d === 0 ? { ...w } : { x: w.x + (dx / d) * reach, y: w.y + (dy / d) * reach };
  });
}

/**
 * A bolt through `waypoints` (at least two): a boltPath per leg, joined so each waypoint appears once,
 * at index k * 2^depth (the interior ones moved outward a little by `wander`), then branches and twigs
 * off it.
 */
export function bolt(waypoints: readonly Point[], seed: number, depth: number): Bolt {
  if (waypoints.length < 2) return { trunk: waypoints.map((p) => ({ ...p })), branches: [], twigs: [] };
  const legs = waypoints.length - 1;
  const middle = centroid(waypoints);
  const through = wander(waypoints, seed, middle);
  const trunk: Point[] = [];
  let total = 0;
  for (let i = 1; i < through.length; i++) {
    const leg = boltPath(through[i - 1], through[i], (seed + i * 101) >>> 0, depth);
    trunk.push(...(i === 1 ? leg : leg.slice(1)));
    total += Math.hypot(through[i].x - through[i - 1].x, through[i].y - through[i - 1].y);
  }
  return { trunk, ...boltBranches(trunk, seed, total / Math.sqrt(legs), legs, legs >= 2 ? middle : undefined) };
}

/** Share of a multi-leg trunk kept at each end by `crackle`. */
export const CRACKLE_SHARE = 0.26;

/** A crackle: arms that each start at an end of a bolt and run inward, and the offshoots on them. */
export interface Crackle {
  arms: Point[][];
  branches: Point[][];
  twigs: Point[][];
}

/**
 * The calm stand-in for a bolt: only the stretch of trunk near each end, as arms that start on the end
 * and run inward, with the branches that start on an arm and the twigs on those. A one-leg bolt (a
 * spark off a neck bolt) is short already and keeps its whole trunk as one arm from its start.
 */
export function crackle(shape: Bolt, legs: number): Crackle {
  const n = shape.trunk.length;
  let arms: Point[][];
  if (legs <= 1 || n < 4) arms = [shape.trunk];
  else {
    const k = Math.max(1, Math.round(CRACKLE_SHARE * (n - 1)));
    arms = [shape.trunk.slice(0, k + 1), shape.trunk.slice(n - 1 - k).reverse()];
  }
  const on = (paths: readonly Point[][], p: Point) => paths.some((path) => path.some((q) => q.x === p.x && q.y === p.y));
  const branches = shape.branches.filter((br) => on(arms, br[0]));
  return { arms, branches, twigs: shape.twigs.filter((tw) => on(branches, tw[0])) };
}

function centroid(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * A tapered ribbon along `path`, as a closed outline: down one side and back up the other. The half
 * width runs from `start` at the first point, swells to `peak` at `peakAt` (0 to 1 along the path) and
 * falls to `end` at the last point. Offsets use the mean of the neighbouring segment normals, so a
 * sharp kink pinches a little instead of spiking.
 */
export function ribbon(path: readonly Point[], start: number, peak: number, end: number, peakAt = 0.5): Point[] {
  const n = path.length;
  if (n < 2) return path.map((p) => ({ ...p }));
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const w =
      t <= peakAt
        ? start + (peak - start) * Math.sin((Math.PI / 2) * (peakAt === 0 ? 1 : t / peakAt))
        : end + (peak - end) * Math.sin((Math.PI / 2) * ((1 - t) / (1 - peakAt)));
    let nx = 0;
    let ny = 0;
    for (const [p, q] of [
      [path[i - 1], path[i]],
      [path[i], path[i + 1]],
    ] as const) {
      if (!p || !q) continue;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len === 0) continue;
      nx -= (q.y - p.y) / len;
      ny += (q.x - p.x) / len;
    }
    const nl = Math.hypot(nx, ny);
    const ox = nl === 0 ? 0 : (nx / nl) * w;
    const oy = nl === 0 ? 0 : (ny / nl) * w;
    left.push({ x: path[i].x + ox, y: path[i].y + oy });
    right.push({ x: path[i].x - ox, y: path[i].y - oy });
  }
  return [...left, ...right.reverse()];
}

/** Frame_Time gap before the next regeneration: an integer from 60 to 90 ms. */
export function regenGapMs(seed: number): number {
  return 60 + Math.floor(mulberry32(seed)() * 31);
}

/** SVG `points` attribute text for a path. */
export function toPolyline(points: readonly Point[]): string {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

/** SVG path `d` text for a closed outline, such as a ribbon. */
export function toClosedPath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  return `M${points.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join("L")}Z`;
}
