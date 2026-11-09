"use client";
// The one-screen layout (lab-ui-foundation R12.1 to R12.4, R13, R14.1, R14.2, R14.9). A CSS grid with
// named areas after the UI direction diagram. Slots for Surfaces with no source today keep their area
// and render nothing. Below 1024 px the dock is a bottom sheet (the Card_Dock positions itself); below
// 640 px the corners stack. No element is wider than 343 px at 375 px.
// With no Card the grid has one column, so the stage sits on the page's centre axis with the call
// button and the Wordmark (Brief 004 item 1). A Card adds the dock column from 1024 px; the stage,
// chips, controls and reply all stay in the first column, so Franki and his controls keep one axis,
// and each glides between the two positions as a motion layout animation on spring.settle; instant
// under Reduced_Motion. The signed-out Wordmark sits outside the glide wrapper, on one line, so the
// stage's width never wraps it. Below 1024 px the dock is a bottom sheet over the screen, so the grid
// keeps room at the bottom to scroll the controls clear of it.
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { SPRING } from "../../ui/motion";
import type { CardProps } from "../../ui/surface-props";
import { cardHasContent } from "../surfaces/Card";
import { CardDock } from "../surfaces/CardDock";
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
  "flex min-w-0 flex-nowrap items-center justify-between gap-3 [grid-area:header] max-sm:[&_[data-testid=signed-in-email]]:sr-only";

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

export function MainScreen({ signedIn, auth, soundToggle, stage, controls, typed, reply, debug, live, reduced, paused, cards = [] }: MainScreenProps) {
  const docked = cards.some(cardHasContent);
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
          {/* Time_Badge slot: no simulated-time source yet (contract question 8). */}
          <div data-slot="time-badge" />
          <div className="flex min-w-0 shrink items-center gap-2">
            {soundToggle}
            {signedIn ? auth : null}
          </div>
        </header>
        {/* Strip slot: no open-loop source yet. */}
        <div data-area="strip" className="[grid-area:strip]" />
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
          {docked ? <CardDock cards={cards} /> : null}
        </div>
        {/* Chips slot: chips show only when the server offers them. */}
        <div data-area="chips" className="[grid-area:chips]" />
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
        {/* Jar and Lab slots: no memory or count source yet. */}
        <div data-area="corners" className="flex flex-col items-center gap-3 sm:flex-row sm:items-end sm:justify-between [grid-area:corners]">
          <div data-slot="jar" />
          <div data-slot="lab" />
        </div>
      </div>
      {debug ? <div className="w-full max-w-6xl px-4 pb-4">{debug}</div> : null}
    </main>
  );
}
