// From a point on the camera's picture to a point on the X-ray screen (brief 051 part C). Pure. The picture fills
// the screen like `object-fit: cover` (scaled evenly until it covers both sides, centred, the overflow cut off), and
// the selfie camera is drawn mirrored (ruling 9). Picture points are measured on the unmirrored picture, 0 to 1
// across and down; screen points are CSS pixels from the screen's top left. The bones and the veil both use this.

export interface ScreenFit {
  /** The screen, CSS pixels. */
  readonly w: number;
  readonly h: number;
  /** The picture's width over its height. */
  readonly aspect: number;
  readonly mirrored: boolean;
  /** The drawn picture's size and its top left, CSS pixels. It covers the screen, so left and top are 0 or less. */
  readonly drawnW: number;
  readonly drawnH: number;
  readonly left: number;
  readonly top: number;
}

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/** A screen side under one CSS pixel, or not a number, counts as one pixel. */
export const MIN_SIDE = 1;
/** The widest and the tallest picture taken as given; anything past them, or not a number, counts as square. */
export const ASPECT_RANGE = [1e-3, 1e3] as const;

const side = (v: number) => (Number.isFinite(v) && v >= MIN_SIDE ? v : MIN_SIDE);
const ratio = (v: number) => (Number.isFinite(v) && v >= ASPECT_RANGE[0] && v <= ASPECT_RANGE[1] ? v : 1);

/** The cover fit of a picture of `aspect` on a `w` by `h` screen. */
export function coverFit(aspect: number, w: number, h: number, mirrored: boolean): ScreenFit {
  const a = ratio(aspect);
  const sw = side(w);
  const sh = side(h);
  // Pixels per unit of picture height: large enough that both the width and the height cover the screen.
  const k = Math.max(sw / a, sh);
  const drawnW = a * k;
  const drawnH = k;
  return { w: sw, h: sh, aspect: a, mirrored, drawnW, drawnH, left: (sw - drawnW) / 2, top: (sh - drawnH) / 2 };
}

/** A picture point (unmirrored, 0 to 1) to screen pixels. */
export function pictureToScreen(fit: ScreenFit, x: number, y: number): Point2 {
  const across = fit.mirrored ? 1 - x : x;
  return { x: fit.left + across * fit.drawnW, y: fit.top + y * fit.drawnH };
}

/** Screen pixels back to a picture point (unmirrored). */
export function screenToPicture(fit: ScreenFit, sx: number, sy: number): Point2 {
  const across = (sx - fit.left) / fit.drawnW;
  return { x: fit.mirrored ? 1 - across : across, y: (sy - fit.top) / fit.drawnH };
}

/**
 * The same mapping on normalised device coordinates, for a camera drawing the picture's own view: the screen's NDC is
 * the picture's NDC times this scale, about the centre. A mirrored fit has a negative x.
 */
export function ndcScale(fit: ScreenFit): Point2 {
  const sx = fit.drawnW / fit.w;
  return { x: fit.mirrored ? -sx : sx, y: fit.drawnH / fit.h };
}
