// Pure geometry for the lab scenery: hanging cables, the corner cobweb, and the pointer parallax.
// Every value is in the drawing's own units (a 1440 by 900 viewBox) unless a name says px.

/** The drawing's size in user units. */
export const SCENE = { width: 1440, height: 900 } as const;

/** How far each depth travels against the pointer, in screen px, at the pointer's farthest reach. */
export const DEPTH = { far: 3, near: 6 } as const;

export interface Point {
  readonly x: number;
  readonly y: number;
}

const round = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface Catenary {
  /** x of the lowest point (it may lie outside the span when one end hangs much lower). */
  readonly vertexX: number;
  /** y of the lowest point; y grows downward. */
  readonly lowY: number;
  readonly a: number;
}

/**
 * The catenary through two hanging points with tension `a` (larger `a`, tighter cable). y grows
 * downward, so the cable sags toward larger y: y(x) = lowY - a (cosh((x - vertexX) / a) - 1).
 */
export function solveCatenary(p0: Point, p1: Point, a: number): Catenary {
  const [l, r] = p0.x <= p1.x ? [p0, p1] : [p1, p0];
  const span = Math.max(r.x - l.x, 1);
  // g(v) falls as v grows; its root puts both ends on the curve.
  const g = (v: number) => a * (Math.cosh((r.x - v) / a) - Math.cosh((l.x - v) / a)) - (l.y - r.y);
  // The lowest point may lie well outside a short, steep span, so the search reaches past it by both.
  let lo = l.x - span * 4 - a * 4;
  let hi = r.x + span * 4 + a * 4;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) lo = mid;
    else hi = mid;
  }
  const vertexX = (lo + hi) / 2;
  const lowY = l.y + a * (Math.cosh((l.x - vertexX) / a) - 1);
  return { vertexX, lowY, a };
}

export function catenaryY(c: Catenary, x: number): number {
  return c.lowY - c.a * (Math.cosh((x - c.vertexX) / c.a) - 1);
}

/** Sample points along the cable from p0 to p1, ends included. */
export function catenaryPoints(p0: Point, p1: Point, a: number, segments: number): Point[] {
  const c = solveCatenary(p0, p1, a);
  const n = Math.max(1, Math.floor(segments));
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const x = p0.x + ((p1.x - p0.x) * i) / n;
    pts.push({ x, y: i === 0 ? p0.y : i === n ? p1.y : catenaryY(c, x) });
  }
  return pts;
}

/** An SVG path through the points: one M, then one L per point. */
export function polyline(pts: readonly Point[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`).join(" ");
}

export interface WebSpec {
  readonly hub: Point;
  /** Thread directions in degrees, measured clockwise from +x on screen (y down). */
  readonly anglesDeg: readonly number[];
  /** Ring radii from the hub. */
  readonly radii: readonly number[];
  /** Thread length from the hub. */
  readonly reach: number;
  /** Per-thread length factor, so the rings are a little uneven, as a real web is. */
  readonly wobble: readonly number[];
  /** How far each scallop dips toward the hub, as a share of its ring's radius. */
  readonly dip: number;
}

/**
 * A quarter web: straight threads from the hub, and rings drawn as scallops, one quadratic curve
 * between each pair of neighbouring threads, each dipping toward the hub.
 */
export function webPaths(spec: WebSpec): { threads: string; rings: string } {
  const rad = spec.anglesDeg.map((d) => (d * Math.PI) / 180);
  const at = (theta: number, r: number): Point => ({ x: spec.hub.x + r * Math.cos(theta), y: spec.hub.y + r * Math.sin(theta) });
  const w = (i: number) => spec.wobble[i] ?? 1;
  const threads = rad.map((t, i) => polyline([spec.hub, at(t, spec.reach * w(i))])).join(" ");
  const rings = spec.radii
    .map((r) => {
      const parts: string[] = [];
      rad.forEach((t, i) => {
        const p = at(t, r * w(i));
        if (i === 0) {
          parts.push(`M${round(p.x)} ${round(p.y)}`);
          return;
        }
        const prev = rad[i - 1];
        const half = (t - prev) / 2;
        const mid = prev + half;
        const cr = r * ((w(i) + w(i - 1)) / 2) * (Math.cos(half) - spec.dip);
        const c = at(mid, cr);
        parts.push(`Q${round(c.x)} ${round(c.y)} ${round(p.x)} ${round(p.y)}`);
      });
      return parts.join(" ");
    })
    .join(" ");
  return { threads, rings };
}

/**
 * The scale `preserveAspectRatio="xMidYMax slice"` gives the drawing in a viewport: the larger of the
 * two ratios, so the drawing covers it.
 */
export function coverScale(widthPx: number, heightPx: number): number {
  if (!(widthPx > 0) || !(heightPx > 0)) return 1;
  return Math.max(widthPx / SCENE.width, heightPx / SCENE.height);
}

/** Where a drawing point lands on screen, in px, under `xMidYMax slice`. */
export function sceneToScreen(p: Point, widthPx: number, heightPx: number): Point {
  const s = coverScale(widthPx, heightPx);
  return { x: (widthPx - SCENE.width * s) / 2 + p.x * s, y: heightPx - SCENE.height * s + p.y * s };
}

/** The drawing point under a screen point, in drawing units: the inverse of `sceneToScreen`. */
export function screenToScene(p: Point, widthPx: number, heightPx: number): Point {
  const s = coverScale(widthPx, heightPx);
  return { x: (p.x - (widthPx - SCENE.width * s) / 2) / s, y: (p.y - heightPx + SCENE.height * s) / s };
}

/**
 * How much of the drawing `xMidYMax slice` cuts away, in drawing units: `top` off the top edge (wide
 * screens) and `side` off each side (tall screens). At most one of the two is above 0. Shifting a
 * point down by `top` and in by `side` keeps it the same distance from the screen's top corner.
 */
export function sliceCrop(widthPx: number, heightPx: number): { top: number; side: number } {
  if (!(widthPx > 0) || !(heightPx > 0)) return { top: 0, side: 0 };
  const s = coverScale(widthPx, heightPx);
  return { top: Math.max(0, SCENE.height - heightPx / s), side: Math.max(0, (SCENE.width - widthPx / s) / 2) };
}

/**
 * The drawing y, inside the group shifted down by the top crop, that lands `px` screen pixels below the
 * screen's top edge. That group's y reaches the screen as y * scale: h - 900 s + (y + top) s, and
 * top = 900 - h / s, so the h terms cancel.
 */
export function hangY(px: number, widthPx: number, heightPx: number): number {
  return px / coverScale(widthPx, heightPx);
}

/** A box on screen, in px. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A move and a scale about a drawing point: the point goes to `about + (dx, dy)`, and sizes scale by `k`. */
export interface Placement {
  readonly dx: number;
  readonly dy: number;
  readonly k: number;
}

export const STILL: Placement = { dx: 0, dy: 0, k: 1 };

/**
 * Where to put a drawn thing so its centre sits on the centre of a box on screen (Franki's floor
 * shadow), at `perBox` times the box's width but never wider than `maxShare` of the screen, with the
 * scale kept between 0.5 and 1.3. `width` is the thing's drawn width in drawing units.
 */
export function placeOnBox(
  box: Box,
  widthPx: number,
  heightPx: number,
  thing: { centre: Point; width: number },
  perBox: number,
  maxShare: number,
): Placement {
  const ok = [box.left, box.top, box.width, box.height].every(Number.isFinite) && box.width > 0 && widthPx > 0 && heightPx > 0 && thing.width > 0;
  if (!ok) return STILL;
  const s = coverScale(widthPx, heightPx);
  const c = screenToScene({ x: box.left + box.width / 2, y: box.top + box.height / 2 }, widthPx, heightPx);
  const px = Math.min(perBox * box.width, maxShare * widthPx);
  return { dx: c.x - thing.centre.x, dy: c.y - thing.centre.y, k: clamp(px / (thing.width * s), 0.5, 1.3) };
}

/** Where a drawing point goes under a placement about `about`. */
export function placePoint(p: Placement, about: Point, pt: Point): Point {
  return { x: about.x + p.dx + p.k * (pt.x - about.x), y: about.y + p.dy + p.k * (pt.y - about.y) };
}

/** The SVG `transform` attribute for a placement about `about`. */
export function placementTransform(p: Placement, about: Point): string {
  const k = Math.round(p.k * 1000) / 1000;
  return `translate(${round(about.x + p.dx)} ${round(about.y + p.dy)}) scale(${k}) translate(${-about.x} ${-about.y})`;
}

/**
 * The parallax offset for depth 1, in drawing units. The pointer's place in the viewport maps to
 * -1..1 on each axis, the layer moves against it, and the result is divided by the cover scale so
 * that a layer of depth d moves at most d screen px however large the drawing is scaled.
 */
export function parallaxUnit(clientX: number, clientY: number, widthPx: number, heightPx: number): Point {
  if (!(widthPx > 0) || !(heightPx > 0) || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return { x: 0, y: 0 };
  const s = coverScale(widthPx, heightPx);
  const nx = clamp((clientX / widthPx) * 2 - 1, -1, 1);
  const ny = clamp((clientY / heightPx) * 2 - 1, -1, 1);
  return { x: -nx / s || 0, y: -ny / s || 0 };
}
