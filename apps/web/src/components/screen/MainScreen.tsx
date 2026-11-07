// The one-screen layout (lab-ui-foundation R12.1 to R12.4, R13, R14.1, R14.2, R14.9). A CSS grid with
// named areas after the UI direction diagram. Slots for Surfaces with no source today keep their area
// and render nothing. Below 1024 px the dock is a bottom sheet (the Card_Dock positions itself); below
// 640 px the corners stack. No element is wider than 343 px at 375 px.
import type { ReactNode } from "react";
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
}

export const GRID_AREAS = ["header", "strip", "stage", "dock", "chips", "controls", "reply", "corners"] as const;

const GRID =
  "grid w-full max-w-6xl flex-1 grid-cols-1 gap-y-4 px-4 py-4 [grid-template-areas:'header'_'strip'_'stage'_'chips'_'controls'_'reply'_'corners'_'dock'] lg:grid-cols-[1fr_minmax(0,22rem)] lg:gap-x-8 lg:[grid-template-areas:'header_header'_'strip_strip'_'stage_dock'_'chips_chips'_'controls_controls'_'reply_reply'_'corners_corners']";

export function MainScreen({ signedIn, auth, soundToggle, stage, controls, typed, reply, debug, live, reduced, paused }: MainScreenProps) {
  return (
    <main
      data-screen={signedIn ? "signed-in" : "signed-out"}
      data-reduced={reduced ? "true" : "false"}
      data-paused={paused ? "true" : "false"}
      className="relative flex w-full flex-1 flex-col items-center text-center text-ink"
    >
      <Backdrop />
      {live}
      <div className={GRID}>
        <header data-area="header" className="flex min-w-0 flex-wrap items-center justify-between gap-3 [grid-area:header]">
          {signedIn ? <Wordmark variant="header" /> : <span />}
          {/* Time_Badge slot: no simulated-time source yet (contract question 8). */}
          <div data-slot="time-badge" />
          <div className="flex min-w-0 items-center gap-2">
            {soundToggle}
            {signedIn ? auth : null}
          </div>
        </header>
        {/* Strip slot: no open-loop source yet. */}
        <div data-area="strip" className="[grid-area:strip]" />
        <section data-area="stage" aria-label="Franki" className="flex flex-col items-center justify-center gap-6 py-4 [grid-area:stage]">
          {signedIn ? null : <Wordmark variant="signedOut" />}
          {stage}
          {signedIn ? null : auth}
        </section>
        {/* Card_Dock slot: no card source yet. */}
        <div data-area="dock" className="[grid-area:dock]" />
        {/* Chips slot: chips show only when the server offers them. */}
        <div data-area="chips" className="[grid-area:chips]" />
        <div data-area="controls" className="flex flex-col items-center gap-3 [grid-area:controls]">
          {controls}
          {typed}
        </div>
        <div data-area="reply" className="flex justify-center [grid-area:reply]">
          {reply}
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
