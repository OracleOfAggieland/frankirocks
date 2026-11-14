"use client";
// The Google sheet (brief 049 part B). Short: what Franki can and can't do with Google, that the sign-in happens on
// Google's own page in its own window, one button that opens it, then the connection as the server answered it (the
// address, Gmail's and Calendar's states, a new sign-in when one is needed) and a disconnect that asks Yes or Not
// now, neither pre-selected. No mail, no events, no field of its own. Everything shown is in the `GoogleState` the
// machine holds; the sheet decides nothing.
// `presentation="sheet"` is modal, as the bank sheet is: focus moves to the heading on open and back on close, stays
// inside, and Escape closes; a drawer on the right from 1024 px, a bottom sheet below.
import { motion, useIsPresent } from "motion/react";
import { type KeyboardEvent, type Ref, useCallback, useEffect, useRef } from "react";
import { COPY } from "../../ui/copy";
import { googleLine, googleParts } from "../../ui/google/google-format";
import { type GoogleState, canConnectGoogle, googleBusy, googleHeld } from "../../ui/google/google-machine";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE, SPRING } from "../../ui/motion";
import { Lamp } from "../lab/Lamp";
import { FOCUS, QUIET_BUTTON, TARGET } from "../surfaces/classes";
import { Seam } from "../surfaces/Seam";
import { FOCUSABLE, nextFocusIndex } from "../surfaces/WhatIKnowSheet";
import { googleLit } from "./GoogleWayIn";

export type GooglePresentation = "inline" | "sheet";

export interface GoogleActions {
  onClose: () => void;
  onRetry: () => void;
  /** Must open Google's window in the same press. */
  onConnect: () => void;
  onStopWaiting: () => void;
  onDisconnect: () => void;
  onYes: () => void;
  onNotNow: () => void;
}

export interface GoogleSheetProps extends GoogleActions {
  state: GoogleState;
  /** The zone times are shown in. */
  zone: string;
  presentation?: GooglePresentation;
}

const BRASS_BUTTON = `${TARGET} ${FOCUS} mat-brass inline-flex items-center justify-center rounded-control px-5 text-base font-medium transition-transform duration-(--dur-quick) active:translate-y-0.5 disabled:opacity-40`;
const SMALL_QUIET = `${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control border border-ink-dim/70 px-3 text-sm text-ink transition-colors duration-(--dur-quick) hover:bg-night-2 disabled:opacity-40`;

const fade = { duration: DUR.base / 1000, ease: [...EASE.ecto] as [number, number, number, number] };

/** The one line the status region reads: a note after something finished, else what is out right now. */
export function googleStatusLine(s: GoogleState): string | null {
  if (s.note !== null) return COPY.google.notes[s.note];
  switch (s.phase) {
    case "reading":
      return COPY.google.reading;
    case "readFailed":
      return COPY.google.readFailed;
    case "notConfigured":
      return COPY.google.notConfigured;
    case "starting":
      return COPY.google.starting;
    case "authorizing":
      return COPY.google.authorizing;
    case "disconnecting":
      return COPY.google.disconnecting;
    case "unread":
    case "idle":
    case "confirming":
      return null;
    default:
      s.phase satisfies never;
      return null;
  }
}

function Account({ state, zone, actions }: { state: GoogleState; zone: string; actions: GoogleActions }) {
  const g = state.google!;
  const asking = state.phase === "confirming" || state.phase === "disconnecting";
  const question = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // The pressed Disconnect gives way to the question: focus goes to the question, on neither answer.
    if (state.phase === "confirming") question.current?.focus({ preventScroll: true });
  }, [state.phase]);
  const line = googleLine(g, zone);
  return (
    <div data-google-account="" data-google-mail={g.mail} data-google-calendar={g.calendar} className="flex flex-col gap-2 rounded-control border border-ink/10 bg-night-1/80 p-3">
      <div className="flex items-center gap-2">
        <Lamp on={googleLit(g)} words={COPY.google.lamp} />
        {/* The address is the server's answer, shown as plain text only. */}
        <p className="min-w-0 break-all text-base text-ink">{g.email ?? COPY.google.title}</p>
      </div>
      {line !== null ? (
        <p data-google-line="" className={`text-sm ${g.needsReconnect ? "text-ink" : "text-ink-dim"}`}>
          {g.needsReconnect ? <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-ember align-middle" /> : null}
          {line}
        </p>
      ) : null}
      <ul aria-label={COPY.google.partsLabel} className="flex flex-col gap-0.5 text-sm text-ink-dim">
        {googleParts(g).map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {asking ? (
        <div data-google-confirm="" className="flex flex-col gap-2">
          <p ref={question} tabIndex={-1} className="text-sm text-ink outline-none">
            {COPY.google.confirm}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-action="google-yes" className={BRASS_BUTTON} disabled={state.phase !== "confirming"} onClick={actions.onYes}>
              {COPY.google.yes}
            </button>
            <button type="button" data-action="google-not-now" className={QUIET_BUTTON} disabled={state.phase !== "confirming"} onClick={actions.onNotNow}>
              {COPY.google.notNow}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" data-action="google-disconnect" className={SMALL_QUIET} disabled={state.phase !== "idle"} onClick={actions.onDisconnect}>
            {COPY.google.disconnect}
          </button>
        </div>
      )}
    </div>
  );
}

export interface GoogleSheetViewProps extends GoogleSheetProps {
  presentation: GooglePresentation;
  reduced: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  panelRef?: Ref<HTMLElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

/** The sheet's drawing, with no state of its own. */
export function GoogleSheetView({ state, zone, presentation, reduced, headingRef, panelRef, onKeyDown, ...actions }: GoogleSheetViewProps) {
  const sheet = presentation === "sheet";
  const line = googleStatusLine(state);
  const g = state.google;
  const head = (
    <div className={`flex items-center justify-between gap-3 ${sheet ? "px-5 pt-3" : ""}`}>
      <h2 ref={headingRef} tabIndex={-1} className="text-lg text-ink outline-none">
        {COPY.google.title}
      </h2>
      <button type="button" data-action="close" className={`${QUIET_BUTTON} text-sm`} onClick={actions.onClose}>
        {COPY.google.close}
      </button>
    </div>
  );
  const body = (
    <div data-sheet-body="" className={`flex flex-col gap-4 ${sheet ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]" : ""}`}>
      <div className="flex flex-col gap-1.5">
        <p className="text-base text-ink">{COPY.google.readOnly}</p>
        <p className="text-sm text-ink-dim">{COPY.google.signIn}</p>
        <p className="text-sm text-ink-dim">{COPY.google.onRead}</p>
      </div>
      <p role="status" data-google-status="" className={line === null ? "sr-only" : "text-sm text-ink"}>
        {line ?? ""}
      </p>
      {state.phase === "readFailed" ? (
        <div>
          <button type="button" data-action="google-retry" className={QUIET_BUTTON} onClick={actions.onRetry}>
            {COPY.google.retry}
          </button>
        </div>
      ) : null}
      {state.phase === "authorizing" ? (
        <div>
          <button type="button" data-action="google-stop-waiting" className={QUIET_BUTTON} onClick={actions.onStopWaiting}>
            {COPY.google.stopWaiting}
          </button>
        </div>
      ) : null}
      {g !== null && googleHeld(g) ? (
        <>
          <Seam />
          <Account state={state} zone={zone} actions={actions} />
        </>
      ) : null}
      {g !== null && !googleHeld(g) && !googleBusy(state) ? <p className="text-sm text-ink-dim">{COPY.google.none}</p> : null}
      {canConnectGoogle(state) ? (
        <div>
          <button type="button" data-action="google-connect" className={BRASS_BUTTON} onClick={actions.onConnect}>
            {g !== null && googleHeld(g) ? COPY.google.connectAgain : COPY.google.connect}
          </button>
        </div>
      ) : null}
    </div>
  );
  if (!sheet) {
    return (
      <section role="dialog" aria-label={COPY.google.title} data-google-sheet="" data-google-phase={state.phase} className="mat-glass flex w-[343px] max-w-full flex-col gap-4 rounded-card p-4 text-left sm:w-md">
        {head}
        {body}
      </section>
    );
  }
  return (
    <motion.section
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={COPY.google.title}
      data-google-sheet=""
      data-google-phase={state.phase}
      data-presentation="sheet"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="mat-glass absolute outline-none inset-x-0 bottom-0 flex max-h-[80svh] flex-col rounded-t-card text-left lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-full lg:max-w-[420px] lg:rounded-none lg:rounded-l-card"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
      transition={reduced ? fade : { y: { type: "spring", ...SPRING.settle }, opacity: fade }}
    >
      <div className="px-5 pt-4">
        <Seam />
      </div>
      {head}
      {body}
    </motion.section>
  );
}

/** The modal layer: a scrim and the panel, with focus moved in, held in, and handed back. */
function GoogleSheetLayer(props: Omit<GoogleSheetViewProps, "presentation" | "headingRef" | "panelRef" | "onKeyDown">) {
  const { onClose } = props;
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const holding = useRef(false);
  const present = useIsPresent();

  const handBack = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    const el = returnTo.current;
    returnTo.current = null;
    if (el && el.isConnected) el.focus({ preventScroll: true });
  }, []);

  const close = useCallback(() => {
    handBack();
    onClose();
  }, [handBack, onClose]);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    if (!present) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    holding.current = true;
    heading.current?.focus({ preventScroll: true });
    const guard = (e: FocusEvent) => {
      const p = panel.current;
      if (holding.current && p && e.target instanceof Node && !p.contains(e.target)) heading.current?.focus({ preventScroll: true });
    };
    const keys = (e: globalThis.KeyboardEvent) => {
      if (!holding.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      const p = panel.current;
      if (e.key !== "Tab" || !p) return;
      const controls = [...p.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      const next = nextFocusIndex({ count: controls.length, current: controls.indexOf(document.activeElement as HTMLElement), shift: e.shiftKey });
      e.preventDefault();
      (next < 0 ? heading.current : controls[next])?.focus();
    };
    document.addEventListener("focusin", guard);
    document.addEventListener("keydown", keys, true);
    return () => {
      document.removeEventListener("focusin", guard);
      document.removeEventListener("keydown", keys, true);
      handBack();
    };
  }, [present, handBack]);

  return (
    <div data-sheet-layer="" data-google-layer="" className="fixed inset-0 z-50">
      <motion.div aria-hidden="true" data-sheet-scrim="" className="absolute inset-0 bg-night-0/60" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} />
      <GoogleSheetView {...props} onClose={close} presentation="sheet" headingRef={heading} panelRef={panel} />
    </div>
  );
}

export function GoogleSheet({ presentation = "inline", ...props }: GoogleSheetProps) {
  const reduced = useReducedMotion();
  return presentation === "sheet" ? <GoogleSheetLayer {...props} reduced={reduced} /> : <GoogleSheetView {...props} presentation="inline" reduced={reduced} />;
}
