// The little web the spider leaves where a click is released. Pure: a seeded shape, no random source.
// Six spokes of WEB_SPOKE px and two rings (r WEB_RINGS), each ring a hexagon whose threads sag a little
// toward the hub, as silk does between spokes.
import { mulberry32 } from "../electricity";
import { DEG, polar } from "./geometry";

export const WEB_SPOKES = 6;
export const WEB_SPOKE = 11;
export const WEB_RINGS = [5, 9] as const;
/** At most this many webs at once; a new one removes the oldest. */
export const MAX_WEBS = 3;
/** How far each spoke may lean from even spacing, in degrees. */
const SPOKE_JITTER_DEG = 6;
/** How far a ring thread sags toward the hub, as a share of its radius. */
const SAG = 0.14;

const f = (n: number) => n.toFixed(2);

export interface WebShape {
  /** One path of six spokes from the hub. */
  readonly spokes: string;
  /** One path of both rings. */
  readonly rings: string;
}

export function webShape(seed: number): WebShape {
  const rand = mulberry32(seed);
  const turn = rand() * 60;
  const angles = Array.from({ length: WEB_SPOKES }, (_, i) => (turn + i * (360 / WEB_SPOKES) + (rand() * 2 - 1) * SPOKE_JITTER_DEG) * DEG);
  const spokes = angles
    .map((a) => {
      const tip = polar(WEB_SPOKE, a);
      return `M0 0L${f(tip.x)} ${f(tip.y)}`;
    })
    .join("");
  const rings = WEB_RINGS.map((r) => {
    const pts = angles.map((a) => polar(r, a));
    let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
    for (let i = 0; i < pts.length; i++) {
      const a = angles[i];
      const b = angles[(i + 1) % pts.length] + (i + 1 === pts.length ? 2 * Math.PI : 0);
      const mid = polar(r * Math.cos((b - a) / 2) * (1 - SAG), (a + b) / 2);
      const next = pts[(i + 1) % pts.length];
      d += `Q${f(mid.x)} ${f(mid.y)} ${f(next.x)} ${f(next.y)}`;
    }
    return `${d}Z`;
  }).join("");
  return { spokes, rings };
}
