// Where the three.js canvas sits relative to the avatar box, and the render height the engine draws at
// (brief 013, design note docs/briefs/013-design.md §4.3 and edit E10). No imports: ThreeGhost reads it at
// first render, so nothing here may pull three.js into the page. CANVAS_FRAME is calibrated by arithmetic (below);
// both values are checked in the browser at I3.

/** The canvas box in fractions of the avatar box's width (the box is 1 wide and 1.1 tall). */
export interface CanvasFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Calibrated against the projected rest silhouette (three/layout.ts ghostBounds) and the SVG ghost's body box:
// every edge lands within about 0.016 box widths (layout.test.ts allows 0.044). The browser check at I3 may refine it.
export const CANVAS_FRAME: Readonly<CanvasFrame> = Object.freeze({ left: -0.24, top: -0.23, width: 1.47, height: 1.47 });

/**
 * The render height, in device pixels, the engine draws the frame at on the ladder's top tier (E10). Bloom lobes,
 * film grain and every fwidth edge are measured in render pixels, so a small canvas renders at this height and the
 * browser scales it down. 900 is the prototype's parity frame (1280 x 900 at a pixel ratio of 1).
 */
export const REF_FRAME_H = 900;
