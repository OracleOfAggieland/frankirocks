// The radio globe's map (brief 047 part C), drawn in code onto a 2D context the caller passes in: an
// equirectangular picture, longitude -180 at the left edge and latitude 90 at the top. Night sea, land in a dim ghost
// green, a brighter coast that glows a little, and dashed parallels and meridians every 30 degrees like stitches.
// Pure drawing over a small context interface and a palette of CSS colour strings, so a recording fake can test it.
//
// Natural Earth's 110m land, as world-atlas stores it, has rings that cross the antimeridian (Fiji, Chukotka) and
// Antarctica as one ring that runs right round the pole without closing. prepareRings unwraps each ring's longitudes
// so it is continuous, draws a crossing ring again shifted by 360 degrees so both halves land on the map, and closes a
// ring that goes round a pole along the map's edge. No drawn segment ever jumps across the map.
import { landRings } from "./land";

export interface MapPalette {
  /** The sea: the night colour. */
  readonly sea: string;
  /** Land, drawn faint over the sea. */
  readonly land: string;
  /** The coast's stroke and glow. */
  readonly coast: string;
  /** The dashed graticule. */
  readonly thread: string;
}

/** The part of CanvasRenderingContext2D the map uses. */
export interface MapContext {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  globalAlpha: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  setLineDash(segments: number[]): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(rule?: CanvasFillRule): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
}

/** The map's size in pixels: twice as wide as tall. */
export const MAP_W = 2048;
export const MAP_H = 1024;
/** Degrees between graticule lines. */
export const GRATICULE_STEP = 30;
/** The dash of a stitch and the gap after it, in map pixels. */
export const STITCH_DASH: readonly number[] = [14, 10];
/** A pole-closing edge is cut into runs no longer than this, in degrees. */
const EDGE_RUN = 30;

const SEA_LIFT = 0.07;
const LAND_ALPHA = 0.3;
const COAST_GLOW_WIDTH = 7;
const COAST_GLOW_ALPHA = 0.14;
const COAST_WIDTH = 2.2;
const COAST_ALPHA = 0.62;
const THREAD_WIDTH = 1.6;
const THREAD_ALPHA = 0.3;

/** One land ring ready to draw: continuous longitudes, the 360-degree copies it needs, and which edges are coast. */
export interface PreparedRing {
  /** [lon0, lat0, lon1, lat1, ...]; longitudes may run past ±180. */
  readonly pts: Float64Array;
  /** 0 for an ordinary ring, -1 when it was closed along the south pole's edge, 1 along the north's. */
  readonly polar: -1 | 0 | 1;
  /** The longitude shifts it is drawn at: 0, and ±360 when it reaches past an edge. */
  readonly shifts: readonly number[];
  /** One flag per edge (point i to point i+1, the last back to the first): true for a coast, false for a map edge. */
  readonly coast: readonly boolean[];
}

/** Unwraps, closes and marks one ring of [lon, lat] pairs. */
export function prepareRing(raw: ArrayLike<number>): PreparedRing {
  const n = Math.floor(raw.length / 2);
  const pts: number[] = [];
  let lon = raw[0]!;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      let d = raw[2 * i]! - raw[2 * i - 2]!;
      if (d > 180) d -= 360;
      else if (d < -180) d += 360;
      lon += d;
    }
    pts.push(lon, raw[2 * i + 1]!);
  }
  const coast: boolean[] = new Array<boolean>(n).fill(true);
  // The closing edge, unwrapped: a ring round a pole ends 360 degrees from where it began.
  let close = raw[0]! - raw[2 * n - 2]!;
  if (close > 180) close -= 360;
  else if (close < -180) close += 360;
  const winding = lon + close - raw[0]!;
  let polar: -1 | 0 | 1 = 0;
  if (Math.abs(winding) > 180) {
    let latSum = 0;
    for (let i = 0; i < n; i++) latSum += raw[2 * i + 1]!;
    polar = latSum < 0 ? -1 : 1;
    const poleLat = polar * 90;
    const endLon = raw[0]! + winding;
    // Back to the first point's latitude at the far end, down to the pole, along it, and up again.
    // The edge into this point is the ring's real closing coast (the last flag already set); the edge out runs down
    // the map's edge to the pole, so it is not.
    pts.push(endLon, raw[1]!);
    coast.push(false);
    const along: number[] = [endLon];
    const steps = Math.ceil(Math.abs(winding) / EDGE_RUN);
    for (let s = 1; s <= steps; s++) along.push(endLon - (winding * s) / steps);
    for (const x of along) {
      pts.push(x, poleLat);
      coast.push(false);
    }
    // The edge from the last pole point back up to the first point is a map edge too (the last flag above).
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    min = Math.min(min, pts[i]!);
    max = Math.max(max, pts[i]!);
  }
  const shifts = [0];
  if (max > 180) shifts.push(-360);
  if (min < -180) shifts.push(360);
  return { pts: Float64Array.from(pts), polar, shifts, coast };
}

export function prepareRings(rings: readonly ArrayLike<number>[]): PreparedRing[] {
  return rings.filter((r) => r.length >= 6).map(prepareRing);
}

let preparedLand: PreparedRing[] | null = null;
/** The bundled land, prepared once. */
export function landPrepared(): readonly PreparedRing[] {
  preparedLand ??= prepareRings(landRings());
  return preparedLand;
}

/** True when the point is on land by the same even-odd rule the map is filled with. */
export function onLand(lat: number, lon: number, rings: readonly PreparedRing[] = landPrepared()): boolean {
  let inside = false;
  for (const r of rings) {
    const n = r.pts.length / 2;
    for (const shift of r.shifts) {
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = r.pts[2 * i]! + shift, yi = r.pts[2 * i + 1]!;
        const xj = r.pts[2 * j]! + shift, yj = r.pts[2 * j + 1]!;
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

/** Map pixels for a longitude and latitude in degrees. */
export const mapX = (lon: number, w: number) => ((lon + 180) / 360) * w;
export const mapY = (lat: number, h: number) => ((90 - lat) / 180) * h;

function ringPath(ctx: MapContext, r: PreparedRing, shift: number, w: number, h: number, coastOnly: boolean) {
  const n = r.pts.length / 2;
  const x = (i: number) => mapX(r.pts[2 * (i % n)]! + shift, w);
  const y = (i: number) => mapY(r.pts[2 * (i % n) + 1]!, h);
  if (!coastOnly) {
    ctx.moveTo(x(0), y(0));
    for (let i = 1; i < n; i++) ctx.lineTo(x(i), y(i));
    ctx.closePath();
    return;
  }
  let pen = false;
  for (let i = 0; i < n; i++) {
    if (!r.coast[i]) {
      pen = false;
      continue;
    }
    if (!pen) ctx.moveTo(x(i), y(i));
    ctx.lineTo(x(i + 1), y(i + 1));
    pen = true;
  }
}

/** Draws the whole map onto `ctx`, which is `w` by `h` pixels. */
export function drawMap(ctx: MapContext, w: number, h: number, palette: MapPalette, rings: readonly PreparedRing[] = landPrepared()): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.sea;
  ctx.fillRect(0, 0, w, h);
  // The sea lifted a touch toward the land's green, so the sphere reads against the dark panel.
  ctx.globalAlpha = SEA_LIFT;
  ctx.fillStyle = palette.land;
  ctx.fillRect(0, 0, w, h);

  ctx.globalAlpha = LAND_ALPHA;
  ctx.fillStyle = palette.land;
  ctx.beginPath();
  for (const r of rings) for (const s of r.shifts) ringPath(ctx, r, s, w, h, false);
  ctx.fill("evenodd");

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = palette.coast;
  for (const [width, alpha] of [
    [COAST_GLOW_WIDTH, COAST_GLOW_ALPHA],
    [COAST_WIDTH, COAST_ALPHA],
  ] as const) {
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (const r of rings) for (const s of r.shifts) ringPath(ctx, r, s, w, h, true);
    ctx.stroke();
  }

  ctx.strokeStyle = palette.thread;
  ctx.lineWidth = THREAD_WIDTH;
  ctx.globalAlpha = THREAD_ALPHA;
  ctx.lineCap = "butt";
  ctx.setLineDash([...STITCH_DASH]);
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += GRATICULE_STEP) {
    ctx.moveTo(mapX(lon, w), 0);
    ctx.lineTo(mapX(lon, w), h);
  }
  for (let lat = -90 + GRATICULE_STEP; lat < 90; lat += GRATICULE_STEP) {
    // Each parallel in runs of one step, so no single segment spans the map.
    ctx.moveTo(0, mapY(lat, h));
    for (let lon = -180 + GRATICULE_STEP; lon <= 180; lon += GRATICULE_STEP) ctx.lineTo(mapX(lon, w), mapY(lat, h));
  }
  ctx.stroke();
  ctx.restore();
}
