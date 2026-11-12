// Where things sit in the lab scenery drawing (1440 by 900 user units, y down). Scenery.tsx draws from
// these numbers and geometry.test.ts checks them against real window sizes.
import { type Point, type WebSpec } from "./geometry";

/**
 * The two hanging cables, each strung between two glass insulators on short drop rods from the ceiling.
 * They are drawn shifted down by the slice crop, so they always hang from the top of the screen; they
 * are strung tight so that, shifted, they still pass above the shelf and the Jacob's ladder.
 */
export const CABLES: readonly { from: Point; to: Point; a: number; segments: number }[] = [
  { from: { x: 90, y: 48 }, to: { x: 540, y: 40 }, a: 900, segments: 12 },
  { from: { x: 930, y: 36 }, to: { x: 1170, y: 46 }, a: 500, segments: 8 },
];

/** Each insulator is three stacked glass discs, widening toward the bottom like a bell. */
export const DISCS = [
  { dy: -14, rx: 5 },
  { dy: -9, rx: 7 },
  { dy: -4, rx: 8 },
] as const;
/** Half the height of one disc. */
export const DISC_RY = 2.2;

/** A quarter web in the top right corner: five threads, four scalloped rings. Shifted by the crop too. */
export const WEB_SPEC: WebSpec = {
  hub: { x: 1440, y: 0 },
  anglesDeg: [94, 114, 135, 156, 176],
  radii: [44, 80, 116, 152],
  reach: 172,
  wobble: [1, 0.95, 1.03, 0.97, 1.02],
  dip: 0.1,
};

/** The highest point of anything on the shelf (the tall jar's lid). */
export const SHELF_TOP = 306;
/** The top of the Jacob's ladder rods. */
export const LADDER_TOP = 296;
/** The top of the coil's toroid, and the coil's left edge with its dimension. */
export const COIL_TOP = 286;
export const COIL_LEFT = 1184;

/** The slab under Franki: a round stone disc, its top face and its lower rim as two ellipses. */
export const SLAB = { cx: 720, cy: 520, rx: 190, ry: 26, h: 16 } as const;
/** The slab is this many times as wide on screen as Franki's floor shadow, */
export const SLAB_PER_FLOOR = 2.1;
/** and never wider than this share of the screen. */
export const SLAB_MAX_SHARE = 0.88;
