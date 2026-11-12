"use client";
// The one-screen layout (lab-ui-foundation R12.1 to R12.4, R13, R14.1, R14.2, R14.9). A CSS grid with
// named areas after the UI direction diagram. Slots for Surfaces with no source today keep their area
// and render nothing. Below 1024 px the dock is a bottom sheet (the Card_Dock positions itself); below
// 640 px the corners stack. No element is wider than 343 px at 375 px.
// With no Card the grid has one column, so the stage sits on the page's centre axis with the call
// button and the Wordmark (Brief 004 item 1). A Card adds the dock column from 1024 px, and the column
// stays until the last Card has finished leaving (ui.dockLayout); the stage,
// chips, controls and reply all stay in the first column, so Franki and his controls keep one axis,
// and each glides between the two positions as a motion layout animation on spring.settle; instant
// under Reduced_Motion. The signed-out Wordmark sits outside the glide wrapper, on one line, so the
// stage's width never wraps it. Below 1024 px the dock is a bottom sheet over the screen, so the grid
// keeps room at the bottom to scroll the controls clear of it.
// The header is a slim rail: the Wordmark and its bolt, the Time_Badge slot, then the sound toggle and the
// signed-in identity, over a stitched seam that fades at both ends.
import { motion } from "motion/react";
import { type ReactNode, useCallback, useState } from "react";
import { type DockLayout, dockLayoutInit, dockLayoutStep, hasDockColumn } from "../../ui/dock-layout";
import { SPRING } from "../../ui/motion";
import type { CardProps } from "../../ui/surface-props";
import { cardHasContent } from "../surfaces/Card";
import { CardDock } from "../surfaces/CardDock";
import { Seam } from "../surfaces/Seam";
import { Wordmark } from "../surfaces/Wordmark";
import { Backdrop } from "./Backdrop";

export interface MainScreenProps {
  signedIn: boolean;
  /** AuthPanel: the sign-in button signed out, the email and sign-out signed in. */
  auth: ReactNode;
  soundToggle: ReactNode;
  /** The <Avatar> inside its <Stage>. */
  stage: ReactNode;
  /** CallScreen. */
  controls: ReactNode;
  /** TypedLine. */
  typed: ReactNode;
  /** ReplyLine, or nothing. */
  reply?: ReactNode;
  /** The Debug_Panel, only behind ?debug=1 in development. */
  debug?: ReactNode;
  /** The one polite live region. */
  live: ReactNode;
  reduced: boolean;
  paused: boolean;
  /** Cards for the Card_Dock. No card source reaches the Main_Screen yet; the Specimens_Page passes some. */
  cards?: CardProps[];
  // Brief 020: the memory surfaces, each from GET /api/memory or nothing. Each slot renders what it is given.
  /** The Strip, while a loop is open. */
  strip?: ReactNode;
  /** The Chips. */
  chips?: ReactNode;
  /** The Jar. */
  jar?: ReactNode;
  /** The Lab, with its receipt slip. */
  lab?: ReactNode;
  // Brief 027: the visit's controls, the simulated-time badge and the What I know sheet.
  /** The VisitBar: the time bolt and Start over, beside the Lab. */
  visit?: ReactNode;
  /** The Time_Badge, in the header's slot, while the shown clock is simulated. */
  timeBadge?: ReactNode;
  /** The What I know sheet's modal layer, inside an AnimatePresence. */
  sheet?: ReactNode;
}

export const GRID_AREAS = ["header", "strip", "stage", "dock", "chips", "controls", "reply", "corners"] as const;

const GRID_BASE =
  "grid w-full max-w-6xl flex-1 grid-cols-1 gap-y-4 px-4 py-4 [grid-template-areas:'header'_'strip'_'stage'_'chips'_'controls'_'reply'_'corners'_'dock']";

/** No Card: one column at every width, so the stage is centred on the page. */
export const GRID_CENTER = GRID_BASE;

/**
 * A Card: the stage and the dock side by side from 1024 px. Chips, controls and reply stay in the
 * stage column, on Franki's axis. Below 1024 px the bottom sheet covers the foot of the screen, so the
 * grid reserves room under the controls.
 */
export const GRID_WITH_DOCK = `${GRID_BASE} max-lg:pb-[min(24rem,60vh)] lg:grid-cols-[1fr_minmax(0,22rem)] lg:gap-x-8 lg:[grid-template-areas:'header_header'_'strip_strip'_'stage_dock'_'chips_.'_'controls_.'_'reply_.'_'corners_corners']`;

/** Hides the email below 640 px (it stays in the accessibility tree), so the header keeps one row. */
export const HEADER =
  "relative flex min-h-11 min-w-0 flex-nowrap items-center justify-between gap-3 pb-3 [grid-area:header] max-sm:[&_[data-testid=signed-in-email]]:sr-only";

/** The stitched seam under the header rail, faded out toward both ends. */
export const RAIL_SEAM =
  "pointer-events-none absolute inset-x-0 bottom-0 [mask-image:linear-gradient(to_right,transparent,black_22%,black_78%,transparent)]";

/** One layout-animated wrapper: glides on spring.settle when the grid gains or loses the dock column. */
function Glide({ name, reduced, className, children }: { name: "stage" | "controls" | "reply"; reduced: boolean; className: string; children: ReactNode }) {
  return (
    <motion.div
      data-glide={name}
      layout={reduced ? false : "position"}
      transition={{ layout: { type: "spring", ...SPRING.settle } }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function MainScreen({ signedIn, auth, soundToggle, stage, controls, typed, reply, debug, live, reduced, paused, cards = [], strip, chips, jar, lab, visit, timeBadge, sheet }: MainScreenProps) {
  // The dock column stays from the first card until the last one has dematerialized (ui.dockLayout). The
  // cards event runs during render, so the column is there on the very render that brings the first card.
  const present = cards.some(cardHasContent);
  const [held, setHeld] = useState<DockLayout>(() => dockLayoutInit(present));
  const layout = dockLayoutStep(held, { type: "cards", present });
  if (layout !== held) setHeld(layout);
  const onExitComplete = useCallback(() => setHeld((l) => dockLayoutStep(l, { type: "exitComplete" })), []);
  const docked = hasDockColumn(layout);
  return (
    <main
      data-screen={signedIn ? "signed-in" : "signed-out"}
      data-reduced={reduced ? "true" : "false"}
      data-paused={paused ? "true" : "false"}
      className="relative flex w-full flex-1 flex-col items-center text-center text-ink"
    >
      <Backdrop />
      {live}
      <div data-layout={docked ? "dock" : "center"} className={docked ? GRID_WITH_DOCK : GRID_CENTER}>
        <header data-area="header" className={HEADER}>
          {signedIn ? <Wordmark variant="header" /> : <span />}
          {/* Time_Badge slot: the visit's world clock, labeled whenever it differs from the real one (brief 027). */}
          <div data-slot="time-badge">{timeBadge}</div>
          <div className="flex min-w-0 shrink items-center gap-3">
            {soundToggle}
            {signedIn ? auth : null}
          </div>
          <div aria-hidden="true" data-rail-seam="" className={RAIL_SEAM}>
            <Seam />
          </div>
        </header>
        {/* Strip slot: the open loop from GET /api/memory?view=strip (brief 020). */}
        <div data-area="strip" className="flex justify-center [grid-area:strip]">{strip}</div>
        {/* gap-6 is the 24 px between the signed-out Wordmark and the avatar box that globals.css masks the canvas by. */}
        <section data-area="stage" aria-label="Franki" className="flex min-w-0 flex-col items-center justify-center gap-6 py-4 [grid-area:stage]">
          {/* Outside the glide wrapper: the word needs more width than the stage, and never wraps. */}
          {signedIn ? null : <Wordmark variant="signedOut" />}
          {/* Position-only layout animation: the stage glides when the grid gains or loses the dock column. */}
          <Glide name="stage" reduced={reduced} className="flex w-full max-w-sm flex-col items-center gap-6">
            {stage}
            {signedIn ? null : auth}
          </Glide>
        </section>
        <div data-area="dock" className="[grid-area:dock]">
          {/* Always mounted: it renders nothing without a card, and keeps the last one while it leaves. */}
          <CardDock cards={cards} onExitComplete={onExitComplete} />
        </div>
        {/* Chips slot: the code-constant chips while signed in (brief 020). */}
        <div data-area="chips" className="flex justify-center [grid-area:chips]">{chips}</div>
        <div data-area="controls" className="flex min-w-0 flex-col items-center [grid-area:controls]">
          {/* The controls glide with Franki, on the same spring, so both keep one axis. */}
          <Glide name="controls" reduced={reduced} className="flex w-full max-w-xl flex-col items-center gap-3">
            {controls}
            {typed}
          </Glide>
        </div>
        <div data-area="reply" className="flex min-w-0 flex-col items-center [grid-area:reply]">
          <Glide name="reply" reduced={reduced} className="flex w-full max-w-xl justify-center">
            {reply}
          </Glide>
        </div>
        {/* Jar and Lab slots: from GET /api/memory (brief 020); empty until there is something true to show. */}
        <div data-area="corners" className="flex flex-col items-center gap-3 sm:flex-row sm:items-end sm:justify-between [grid-area:corners]">
          <div data-slot="jar">{jar}</div>
          {/* Visit slot: the time bolt and Start over, beside the Lab (brief 027). */}
          <div data-slot="visit">{visit}</div>
          <div data-slot="lab">{lab}</div>
        </div>
      </div>
      {debug ? <div className="w-full max-w-6xl px-4 pb-4">{debug}</div> : null}
      {sheet}
    </main>
  );
}
