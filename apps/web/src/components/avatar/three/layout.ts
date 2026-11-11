// Where the ghost lands inside the canvas (new code, ported in WP10). Pure three.js math, node-testable. The
// canvas box itself is CANVAS_FRAME in ../canvas-frame.ts, which imports nothing, so ThreeGhost can read it at
// first render without pulling three.js into the page.
import type { CanvasFrame } from "../canvas-frame";
import { notPorted } from "./errors";

export type { CanvasFrame };

/** Fractions of the canvas, top-left origin. */
export interface GhostBounds { top: number; bottom: number; left: number; right: number }

/**
 * The rest silhouette (hem tip to hair top, nub to nub) projected through the prototype camera at this aspect, in
 * fractions of the canvas. I3 uses it with CANVAS_FRAME to land the 3D silhouette on the SVG silhouette.
 */
export function ghostBounds(aspect: number): GhostBounds {
  return notPorted("ghostBounds", aspect);
}
