// The veil over the flesh (brief 051 part C). Pure. Over a tracked face and each tracked hand a soft dark veil dims
// the picture a little more, so the bones stand out of it; a faint line along the face's outline stays, as soft
// tissue does on film. Everything here is in screen pixels, through the same picture-to-screen mapping the bones use.
import type { XrayPoint } from "../../../ui/xray/types";
import { FACE_OVAL } from "./canonical";
import { type Point2, type ScreenFit, pictureToScreen } from "./screen-map";

export interface FaceVeil {
  readonly center: Point2;
  /** On the face's outline, round the face. */
  readonly inner: readonly Point2[];
  /** The same points pushed out, where the veil has faded to nothing. The top is pushed further, over the head. */
  readonly outer: readonly Point2[];
}

export interface VeilDisc {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** How far past the face's outline the veil fades out, as a share of the distance from its middle. */
export const VEIL_FEATHER = 0.16;
/** How much further the top of the veil reaches, over the forehead and the crown. */
export const VEIL_CROWN = 0.42;
/** How dark the veil is at its darkest: the share of the picture it hides. */
export const VEIL_DEPTH = 0.55;

const finitePoint = (p: Point2) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** The veil over one face, or null when its outline isn't all there. */
export function faceVeil(points: readonly XrayPoint[], fit: ScreenFit): FaceVeil | null {
  const inner: Point2[] = [];
  for (const i of FACE_OVAL) {
    const p = points[i];
    if (p === undefined) return null;
    const s = pictureToScreen(fit, p.x, p.y);
    if (!finitePoint(s)) return null;
    inner.push(s);
  }
  const center = { x: inner.reduce((a, p) => a + p.x, 0) / inner.length, y: inner.reduce((a, p) => a + p.y, 0) / inner.length };
  // "Up" is from the chin (FACE_OVAL's middle entry) to the forehead (its first), so a tilted head keeps its crown.
  const top = inner[0]!;
  const bottom = inner[Math.floor(inner.length / 2)]!;
  const ux = top.x - bottom.x;
  const uy = top.y - bottom.y;
  const un = Math.hypot(ux, uy) || 1;
  const outer = inner.map((p) => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dn = Math.hypot(dx, dy) || 1;
    const up = Math.max(0, (dx * ux + dy * uy) / (dn * un));
    const k = 1 + VEIL_FEATHER + VEIL_CROWN * up * up;
    return { x: center.x + dx * k, y: center.y + dy * k };
  });
  return { center, inner, outer };
}

/** Joint pairs the veil follows along a hand: its outline is the union of soft discs along them. */
const HAND_LINKS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

/** Soft discs over one hand's flesh: along each finger, and two wide ones over the palm. Empty if a joint is missing. */
export function handVeil(points: readonly XrayPoint[], fit: ScreenFit): VeilDisc[] {
  if (points.length < 21) return [];
  const s = points.map((p) => pictureToScreen(fit, p.x, p.y));
  if (!s.every(finitePoint)) return [];
  const palm = Math.max(Math.hypot(s[5]!.x - s[17]!.x, s[5]!.y - s[17]!.y), 0.55 * Math.hypot(s[9]!.x - s[0]!.x, s[9]!.y - s[0]!.y), 1);
  const finger = palm * 0.2;
  const discs: VeilDisc[] = [];
  for (const [a, b] of HAND_LINKS) {
    const pa = s[a]!;
    const pb = s[b]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(pb.x - pa.x, pb.y - pa.y) / finger));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      discs.push({ x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, r: finger * 1.6 });
    }
  }
  for (const i of [4, 8, 12, 16, 20]) discs.push({ x: s[i]!.x, y: s[i]!.y, r: finger * 1.5 });
  const mid = (i: number, j: number, t: number) => ({ x: s[i]!.x + (s[j]!.x - s[i]!.x) * t, y: s[i]!.y + (s[j]!.y - s[i]!.y) * t });
  for (const c of [mid(0, 9, 0.55), mid(0, 9, 0.25)]) discs.push({ x: c.x, y: c.y, r: palm * 0.62 });
  return discs;
}
