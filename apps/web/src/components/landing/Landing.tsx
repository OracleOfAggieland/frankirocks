"use client";
// The front door at `/` (brief 015). Holds the story step, the state the visitor picked in the toy and whether
// the switch has been thrown, and composes the page in order.
//
// Layout. From 1024 px a two-column grid: the hero and then the story on the left; the stage on the right,
// spanning both rows, sticky 1rem under the bar and 2rem shorter than the viewport below the bar, so its frame
// never touches the window's edge. Below 1024 px one column: the stage is drawn first (CSS `order`; the hero and
// its h1 stay first in the DOM), sits right under the bar and pins there at 40svh (44svh from 640 px) on a night-0
// ground, while the hero and then the story pass beneath it. Its top margin is the bar's height, so at the top of
// the page it already sits where it pins and covers nothing. No ancestor of the stage clips, because Franki's
// canvas spills past its box.
//
// Step. The page measures its blocks and sections on scroll and resize, inside one frame callback, and the pure
// functions in ui/landing/scroll-step.ts turn the numbers into the step, the bar's state and the rail's marks.
import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import {
  type BlockBox,
  evenMarks,
  isScrolled,
  progressOf,
  reachedSection,
  sameMarks,
  scrollTargetFor,
  sectionMarks,
  stepAt,
} from "../../ui/landing/scroll-step";
import { SECTION_IDS, type StepId, type ToyState, isStepId } from "../../ui/landing/steps";
import { Backdrop } from "../screen/Backdrop";
import { Build } from "./Build";
import { DemoStage } from "./DemoStage";
import { Hero } from "./Hero";
import { HouseRules } from "./HouseRules";
import { Rail } from "./Rail";
import { Story } from "./Story";
import { Switch } from "./Switch";
import { TopBar } from "./TopBar";

/** Where the lab lives. */
const LAB_HREF = "/lab";

interface DoorView {
  step: StepId;
  scrolled: boolean;
  reached: number;
  marks: readonly number[];
  /** The page has measured itself at least once. */
  measured: boolean;
}

const INITIAL_VIEW: DoorView = { step: "hero", scrolled: false, reached: 0, marks: evenMarks(SECTION_IDS.length), measured: false };

function sameView(a: DoorView, b: DoorView): boolean {
  return a.step === b.step && a.scrolled === b.scrolled && a.reached === b.reached && a.measured === b.measured && sameMarks(a.marks, b.marks);
}

/** Reads the page's geometry. Browser only. */
function measure(root: HTMLElement): DoorView {
  const height = window.innerHeight;
  const scrollY = window.scrollY;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - height);
  const blocks: BlockBox[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-step-block]")) {
    const id = el.dataset.stepBlock;
    if (!isStepId(id)) continue;
    const r = el.getBoundingClientRect();
    blocks.push({ id, top: r.top, height: r.height });
  }
  const docTops = SECTION_IDS.map((id, i) => {
    const el = document.getElementById(id);
    return el === null ? (i === 0 ? 0 : maxScroll + height) : el.getBoundingClientRect().top + scrollY;
  });
  const marks = sectionMarks(docTops, height, maxScroll);
  return {
    step: stepAt(blocks, { height, scrollY }),
    scrolled: isScrolled(scrollY),
    reached: reachedSection(marks, progressOf(scrollY, maxScroll)),
    marks,
    measured: true,
  };
}

export function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<DoorView>(INITIAL_VIEW);
  const [toy, setToy] = useState<ToyState>("listening");
  const [won, setWon] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    let frame = 0;
    const run = () => {
      frame = 0;
      const next = measure(root);
      setView((prev) => (sameView(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(run);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Fonts, the stage and the sections below can change the page's height without a scroll or a resize.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(root);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  /** Yes on the approval card: bring the `yes` block to the focus line, smoothly only when motion is allowed. */
  const onYes = useCallback(() => {
    const el = rootRef.current?.querySelector<HTMLElement>('[data-step-block="yes"]');
    if (el === null || el === undefined) return;
    const r = el.getBoundingClientRect();
    // On one column the stage pins over the top of the viewport; aim the block at the part below it. The stage's
    // pinned bottom is its sticky offset plus its height, wherever it sits right now.
    let covered = 0;
    const stage = rootRef.current?.querySelector<HTMLElement>("[data-stage-column]");
    if (stage && !window.matchMedia("(min-width: 1024px)").matches) {
      const offset = Number.parseFloat(getComputedStyle(stage).top);
      covered = (Number.isFinite(offset) ? offset : 0) + stage.getBoundingClientRect().height;
    }
    const top = scrollTargetFor({ top: r.top, height: r.height }, { height: window.innerHeight, scrollY: window.scrollY }, covered);
    window.scrollTo({ top, behavior: reduced ? "instant" : "smooth" });
  }, [reduced]);

  const onThrown = useCallback(() => setWon(true), []);

  return (
    <div ref={rootRef} data-landing="" className="relative w-full">
      <Backdrop variant="door" />
      <TopBar scrolled={view.scrolled} section={SECTION_IDS[view.reached]} />
      <Rail won={won} reached={view.reached} marks={view.marks} reduced={reduced} />
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:pl-28 lg:pr-8 min-[1400px]:pl-32">
        <div data-door-grid="" className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-x-10">
          <Hero className="lg:col-start-1 lg:row-start-1" />
          <div
            data-stage-column=""
            className="sticky top-14 z-10 grid h-[40svh] self-start max-lg:order-first max-lg:mt-14 max-lg:-mx-4 max-lg:bg-night-0 max-lg:px-4 max-lg:after:pointer-events-none max-lg:after:absolute max-lg:after:inset-x-0 max-lg:after:top-full max-lg:after:h-6 max-lg:after:bg-linear-to-b max-lg:after:from-night-0 max-lg:after:to-transparent sm:h-[44svh] sm:max-lg:-mx-6 sm:max-lg:px-6 md:top-16 md:max-lg:mt-16 lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-[calc(100svh-6rem)]"
          >
            <DemoStage step={view.step} toy={toy} onToy={setToy} onYes={onYes} reduced={reduced} />
          </div>
          <Story
            step={view.step}
            dim={view.measured}
            className="max-lg:-mx-4 max-lg:px-4 sm:max-lg:-mx-6 sm:max-lg:px-6 lg:col-start-1 lg:row-start-2"
          />
        </div>
        <HouseRules />
        <Build />
        {/* Cancels the rail's extra left padding, so the switch sits on the viewport's centre line like the footer. */}
        <div className="lg:-ml-20 min-[1400px]:-ml-24">
          <Switch href={LAB_HREF} onThrown={onThrown} reduced={reduced} />
        </div>
      </main>
    </div>
  );
}
