// The front door's scroll geometry (brief 015). Pure: the page measures its blocks and sections once per
// frame and these functions turn the numbers into the story step, the bar's state and the rail's marks.
// Every length is in CSS pixels. A block's `top` is measured from the top of the viewport.
import type { StepId } from "./steps";

/** The story step is the block whose centre is nearest this fraction of the viewport height. */
export const FOCUS_LINE = 0.55;

/** The page counts as scrolled, and the bar turns to glass, past this many pixels. */
export const SCROLLED_PX = 24;

/** The smallest gap kept between two rail marks, so the rail's input range always rises. */
export const MARK_GAP = 1e-4;

export interface BlockBox {
  readonly id: StepId;
  /** Distance from the top of the viewport to the top of the block. */
  readonly top: number;
  readonly height: number;
}

export interface ViewportBox {
  readonly height: number;
  /** How far the page has scrolled. */
  readonly scrollY: number;
}

/**
 * The step whose block centre is nearest the focus line. `hero` at the top of the page, and when there are no
 * blocks. A tie goes to the earlier block, so the step never skips ahead.
 */
export function stepAt(blocks: readonly BlockBox[], viewport: ViewportBox): StepId {
  if (blocks.length === 0 || viewport.scrollY <= 0) return "hero";
  const focus = viewport.height * FOCUS_LINE;
  let best: BlockBox = blocks[0]!;
  let bestDistance = Math.abs(best.top + best.height / 2 - focus);
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i]!;
    const d = Math.abs(b.top + b.height / 2 - focus);
    if (d < bestDistance) {
      best = b;
      bestDistance = d;
    }
  }
  return best.id;
}

/**
 * The page scroll that puts a block's centre on the focus line, never above the top of the page. `coveredTop` is
 * how far down the viewport something pinned covers the page (the stage on one column). When the focus line falls
 * under it, the block's centre goes to the middle of the part left uncovered instead.
 */
export function scrollTargetFor(block: Pick<BlockBox, "top" | "height">, viewport: ViewportBox, coveredTop = 0): number {
  const aim = Math.max(viewport.height * FOCUS_LINE, (coveredTop + viewport.height) / 2);
  return Math.max(0, viewport.scrollY + block.top + block.height / 2 - aim);
}

export function isScrolled(scrollY: number): boolean {
  return scrollY > SCROLLED_PX;
}

/** How far through the page the visitor is, 0 to 1. */
export function progressOf(scrollY: number, maxScroll: number): number {
  if (!(maxScroll > 0)) return 0;
  return clamp01(scrollY / maxScroll);
}

/**
 * Where each section is reached, as a fraction of the page's scroll: the scroll at which its top meets the focus
 * line. `docTops` are measured from the top of the page, in page order. The first mark is always 0, and the
 * marks never fall. With nothing to scroll, the marks are spread evenly.
 */
export function sectionMarks(docTops: readonly number[], viewportHeight: number, maxScroll: number): number[] {
  const n = docTops.length;
  if (n === 0) return [];
  if (!(maxScroll > 0)) return evenMarks(n);
  const marks: number[] = [];
  for (let i = 0; i < n; i++) {
    const raw = i === 0 ? 0 : clamp01((docTops[i]! - viewportHeight * FOCUS_LINE) / maxScroll);
    marks.push(i === 0 ? 0 : Math.max(raw, marks[i - 1]!));
  }
  return marks;
}

/** `n` marks spread evenly from 0 to 1: where the rail draws its terminals. */
export function evenMarks(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  return Array.from({ length: n }, (_, i) => i / (n - 1));
}

/** The last section whose mark the progress has reached. */
export function reachedSection(marks: readonly number[], progress: number): number {
  let reached = 0;
  for (let i = 0; i < marks.length; i++) if (progress + 1e-9 >= marks[i]!) reached = i;
  return reached;
}

/** The marks as a strictly rising input range, for mapping scroll progress onto evenly spaced terminals. */
export function railRange(marks: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < marks.length; i++) out.push(i === 0 ? marks[0]! : Math.max(marks[i]!, out[i - 1]! + MARK_GAP));
  return out;
}

/** True when two lists of marks would draw the same rail (equal to a thousandth). */
export function sameMarks(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((m, i) => Math.abs(m - b[i]!) < 1e-3);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
