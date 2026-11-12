import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BlockBox,
  FOCUS_LINE,
  SCROLLED_PX,
  evenMarks,
  isScrolled,
  progressOf,
  railRange,
  reachedSection,
  sameMarks,
  scrollTargetFor,
  sectionMarks,
  stepAt,
} from "./scroll-step";
import { STEP_IDS, type StepId } from "./steps";

const VH = 900;

/** The page's blocks stacked from `start`, as the page lays them out, then seen from a scroll of `scrollY`. */
function stack(heights: readonly number[], scrollY: number, start = 0): BlockBox[] {
  let y = start;
  return heights.map((height, i) => {
    const box = { id: STEP_IDS[i % STEP_IDS.length] as StepId, top: y - scrollY, height };
    y += height;
    return box;
  });
}

describe("stepAt", () => {
  it("is hero at the top of the page and with no blocks", () => {
    expect(stepAt([], { height: VH, scrollY: 400 })).toBe("hero");
    expect(stepAt(stack([800, 765, 765], 0), { height: VH, scrollY: 0 })).toBe("hero");
  });

  it("picks the block whose centre is nearest 55% of the viewport", () => {
    const blocks: BlockBox[] = [
      { id: "hero", top: -700, height: 800 },
      { id: "talk", top: 100, height: 765 },
      { id: "noticed", top: 865, height: 765 },
    ];
    expect(stepAt(blocks, { height: VH, scrollY: 700 })).toBe("talk");
    // Move the talk block up until the next block's centre is nearer the focus line.
    const later = blocks.map((b) => ({ ...b, top: b.top - 600 }));
    expect(stepAt(later, { height: VH, scrollY: 1300 })).toBe("noticed");
  });

  it("on a phone, with the stage drawn above the hero, is hero at the top and talk next", () => {
    // 375x812: the bar (56) and the stage (40svh, 325) sit above the hero; the hero is about 420 tall and the
    // talk block 70svh.
    const phone = 812;
    const heights = [420, 568, 568];
    const at = (y: number) => stepAt(stack(heights, y, 381), { height: phone, scrollY: y });
    expect(at(0)).toBe("hero");
    expect(at(30)).toBe("hero");
    const firstTalk = Array.from({ length: 2000 }, (_, y) => y).find((y) => at(y) !== "hero")!;
    expect(at(firstTalk)).toBe("talk");
  });

  it("gives a tie to the earlier block", () => {
    // A zero-height viewport puts the focus line at 0 exactly, so the two distances are equal in floating point.
    const blocks: BlockBox[] = [
      { id: "talk", top: -300, height: 200 },
      { id: "noticed", top: 100, height: 200 },
    ];
    expect(stepAt(blocks, { height: 0, scrollY: 50 })).toBe("talk");
  });

  it("property: scrolling down never moves the step backwards, and the step is always one of the blocks", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 40, max: 1600 }), { minLength: 1, maxLength: STEP_IDS.length }),
        fc.integer({ min: 0, max: 20000 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 320, max: 1600 }),
        (heights, scrollY, delta, vh) => {
          const ids = STEP_IDS.slice(0, heights.length) as readonly StepId[];
          const at = (y: number) => stepAt(stack(heights, y).map((b, i) => ({ ...b, id: ids[i]! })), { height: vh, scrollY: y });
          // The first block is the hero, as on the page.
          const before = at(scrollY);
          const after = at(scrollY + delta);
          expect(ids).toContain(before);
          expect(ids).toContain(after);
          expect(ids.indexOf(after)).toBeGreaterThanOrEqual(ids.indexOf(before));
        },
      ),
    );
  });

  it("property: the same measurements give the same step", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 40, max: 1600 }), { minLength: 1, maxLength: 11 }), fc.nat(20000), (heights, y) => {
        const blocks = stack(heights, y);
        expect(stepAt(blocks, { height: VH, scrollY: y })).toBe(stepAt([...blocks], { height: VH, scrollY: y }));
      }),
    );
  });
});

describe("scrollTargetFor", () => {
  it("puts the block's centre on the focus line, and is the step afterwards", () => {
    const blocks = stack([800, 765, 765, 765], 0);
    const yes = { ...blocks[2]!, id: "yes" as const };
    const target = scrollTargetFor(yes, { height: VH, scrollY: 0 });
    expect(target + VH * FOCUS_LINE).toBe(yes.top + yes.height / 2);
    const moved = stack([800, 765, 765, 765], target).map((b, i) => (i === 2 ? { ...b, id: "yes" as const } : b));
    expect(stepAt(moved, { height: VH, scrollY: target })).toBe("yes");
  });

  it("never asks for a scroll above the top of the page", () => {
    expect(scrollTargetFor({ top: 0, height: 100 }, { height: VH, scrollY: 0 })).toBe(0);
  });

  it("with nothing pinned, or a pin above the focus line, aims at the focus line as before", () => {
    const block = { top: 2000, height: 765 };
    const plain = scrollTargetFor(block, { height: VH, scrollY: 0 });
    expect(scrollTargetFor(block, { height: VH, scrollY: 0 }, 0)).toBe(plain);
    expect(scrollTargetFor(block, { height: VH, scrollY: 0 }, 64)).toBe(plain);
  });

  it("property: on one column, the yes block's centre lands below the pinned stage and yes is still the step", () => {
    // Phone and small tablet heights. The bar is 56 px and the stage pins under it at 44svh; each story block is
    // 70svh, stacked one after another, the yes block third.
    fc.assert(
      fc.property(fc.integer({ min: 480, max: 1366 }), fc.integer({ min: 0, max: 4000 }), (vh, start) => {
        const covered = 56 + 0.44 * vh;
        const heights = [0.7 * vh, 0.7 * vh, 0.7 * vh, 0.7 * vh, 0.7 * vh];
        const ids: StepId[] = ["suggested", "approve", "yes", "result", "jar"];
        const laid = stack(heights, 0, start).map((b, i) => ({ ...b, id: ids[i]! }));
        const yes = laid[2]!;
        const target = scrollTargetFor(yes, { height: vh, scrollY: 0 }, covered);
        const centre = yes.top - target + yes.height / 2;
        // The centre sits in the middle of the uncovered part, so text centred on it clears the stage.
        expect(centre).toBeCloseTo((covered + vh) / 2);
        expect(centre).toBeGreaterThan(covered);
        // It is 28 px + 0.17 of the viewport below the focus line, inside the block's half height.
        expect(centre - vh * FOCUS_LINE).toBeCloseTo(28 + 0.17 * vh);
        expect(centre - vh * FOCUS_LINE).toBeLessThan(yes.height / 2);
        const seen = stack(heights, target, start).map((b, i) => ({ ...b, id: ids[i]! }));
        expect(stepAt(seen, { height: vh, scrollY: target })).toBe("yes");
      }),
    );
  });

  it("on a 664 px phone, the block's centre moves from 365 px to 506 px, below the stage's 348 px edge", () => {
    const vh = 664;
    const covered = 56 + 0.44 * vh;
    const yes = { top: 3000, height: 0.7 * vh };
    const centre = (t: number) => yes.top - t + yes.height / 2;
    expect(centre(scrollTargetFor(yes, { height: vh, scrollY: 0 }))).toBeCloseTo(365.2);
    expect(centre(scrollTargetFor(yes, { height: vh, scrollY: 0 }, covered))).toBeCloseTo(506.08);
    expect(covered).toBeCloseTo(348.16);
  });
});

describe("the bar and the rail", () => {
  it("counts the page as scrolled only past 24 px", () => {
    expect(SCROLLED_PX).toBe(24);
    expect(isScrolled(0)).toBe(false);
    expect(isScrolled(24)).toBe(false);
    expect(isScrolled(25)).toBe(true);
  });

  it("progress runs from 0 to 1 and is 0 with nothing to scroll", () => {
    expect(progressOf(0, 1000)).toBe(0);
    expect(progressOf(500, 1000)).toBe(0.5);
    expect(progressOf(1200, 1000)).toBe(1);
    expect(progressOf(300, 0)).toBe(0);
  });

  it("marks a section where its top meets the focus line", () => {
    const marks = sectionMarks([0, 2000, 6000, 9000, 9800, 11000], VH, 10000);
    expect(marks[0]).toBe(0);
    expect(marks[1]).toBeCloseTo((2000 - VH * FOCUS_LINE) / 10000);
    expect(marks[5]).toBe(1);
    expect(reachedSection(marks, 0)).toBe(0);
    expect(reachedSection(marks, marks[2]!)).toBe(2);
    expect(reachedSection(marks, 1)).toBe(5);
  });

  it("spreads the marks evenly with nothing to scroll", () => {
    expect(sectionMarks([0, 10, 20], VH, 0)).toEqual([0, 0.5, 1]);
    expect(evenMarks(6)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(evenMarks(1)).toEqual([0]);
    expect(sectionMarks([], VH, 100)).toEqual([]);
  });

  it("property: marks stay in [0, 1] and never fall; the rail's range strictly rises; reaching never goes back", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 30000 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 320, max: 1600 }),
        fc.integer({ min: 0, max: 30000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (tops, vh, maxScroll, p, q) => {
          const sorted = [...tops].sort((a, b) => a - b);
          const marks = sectionMarks(sorted, vh, maxScroll);
          expect(marks).toHaveLength(sorted.length);
          expect(marks[0]).toBe(0);
          marks.forEach((m, i) => {
            expect(m).toBeGreaterThanOrEqual(0);
            expect(m).toBeLessThanOrEqual(1);
            if (i > 0) expect(m).toBeGreaterThanOrEqual(marks[i - 1]!);
          });
          const range = railRange(marks);
          range.forEach((r, i) => {
            if (i > 0) expect(r).toBeGreaterThan(range[i - 1]!);
          });
          const [lo, hi] = p <= q ? [p, q] : [q, p];
          expect(reachedSection(marks, hi)).toBeGreaterThanOrEqual(reachedSection(marks, lo));
        },
      ),
    );
  });

  it("compares marks to a thousandth", () => {
    expect(sameMarks([0, 0.5], [0, 0.5004])).toBe(true);
    expect(sameMarks([0, 0.5], [0, 0.51])).toBe(false);
    expect(sameMarks([0], [0, 1])).toBe(false);
  });
});
