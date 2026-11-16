"use client";
// The X-ray screen (brief 051 part C). Modal (ruling 15): it covers the app, moves focus in and holds it there, and
// Escape closes it, as the bank sheet does; a call that is open stays open. Below 640 px it fills the screen; from
// 640 px it is a large glass screen in an oak and brass frame, centred, as big as fits.
// On the glass: the camera's picture as film (no colour, dimmed, tinted toward the ghost's cool green), the bones
// over it (ThreeBones), and on top, never mirrored: the wordmark with the signal's words in a polite live region, a
// close button, a flip button when there is another camera, the note that it is a toy, the hint while it looks for
// someone, and for blocked, noCamera, paused and filmOnly the help line with "Try again" or "Start again".
// The selfie picture and the bones are mirrored together (ruling 9): the video by CSS, the bones by their cameras.
// Cheap to load with the page: three.js arrives only through ThreeBones's one import(). Render it inside an
// AnimatePresence: it rises and fades in, and only fades under reduced motion.
import { motion, useIsPresent } from "motion/react";
import { type ReactNode, type Ref, useCallback, useEffect, useId, useRef, useState } from "react";
import { COPY } from "../../ui/copy";
import { DUR, EASE, SPRING } from "../../ui/motion";
import type { XrayControls, XrayFeed, XraySignal, XrayView } from "../../ui/xray/types";
import { FOCUS, TARGET } from "../surfaces/classes";
import { Rivet } from "../lab/Rivet";
import { FOCUSABLE, nextFocusIndex } from "../surfaces/WhatIKnowSheet";
import { Wordmark } from "../surfaces/Wordmark";
import { ThreeBones } from "./ThreeBones";

export interface XrayPanelProps {
  view: XrayView;
  feed: XrayFeed;
  controls: XrayControls;
  reduced: boolean;
  /** Told after the screen asked to close (its button, the scrim or Escape), so the caller can put focus back on the machine. */
  onClosed?: () => void;
  /** "modal" (the default) covers the app; "inline" sits in the page flow at a fixed size, for a specimen tile. */
  presentation?: "modal" | "inline";
  /** "auto" (the default) draws the bones; "none" leaves the film alone, as when WebGL fails. */
  bones?: "auto" | "none";
}

/** The signals that put a help line on the screen, and the press that mends each. */
export const HELP: Partial<Record<XraySignal, { line: string; action: string }>> = {
  blocked: { line: COPY.xray.help.blocked, action: COPY.xray.panel.retry },
  noCamera: { line: COPY.xray.help.noCamera, action: COPY.xray.panel.retry },
  paused: { line: COPY.xray.help.paused, action: COPY.xray.panel.resume },
  filmOnly: { line: COPY.xray.help.filmOnly, action: COPY.xray.panel.retry },
};

/** The signals with no moving picture behind them: their help line takes the middle of the screen. */
const NO_PICTURE: ReadonlySet<XraySignal> = new Set(["blocked", "noCamera", "paused", "asking"]);

/** The lamp beside the signal's words: ecto while it sees bones, brass while it works, ember when it can't. */
export const XRAY_LAMP: Record<XraySignal, string> = {
  seeing: "bg-ecto shadow-ecto-glow",
  searching: "bg-ecto/60",
  warming: "bg-brass shadow-brass-glow",
  asking: "bg-brass",
  filmOnly: "bg-brass/70",
  blocked: "bg-ember",
  noCamera: "bg-ember",
  paused: "border border-stitch bg-night-1",
  dark: "border border-stitch bg-night-1",
};

/** The modal layer's box: the whole screen below 640 px; from 640 px a centred frame as big as fits, 4 by 3. */
export const FRAME_BOX =
  "fixed inset-0 flex flex-col sm:inset-auto sm:top-1/2 sm:left-1/2 sm:aspect-[4/3] sm:w-[min(calc(100vw-3rem),calc((100dvh-3rem)*4/3))] sm:-translate-x-1/2 sm:-translate-y-1/2";
/** A specimen tile's box: in the page flow, 36 rem wide at most, 4 by 3. */
export const FRAME_INLINE = "relative flex aspect-[4/3] w-[36rem] max-w-full flex-col";

/** Oak: brass darkened most of the way to night, with a grain of faint lighter and darker bands. */
const OAK_STYLE = {
  background: [
    "repeating-linear-gradient(97deg, color-mix(in srgb, var(--color-brass) 10%, transparent) 0 2px, transparent 2px 9px, color-mix(in srgb, var(--color-night-0) 22%, transparent) 9px 11px, transparent 11px 23px)",
    "linear-gradient(160deg, color-mix(in srgb, var(--color-brass) 42%, var(--color-night-0)) 0%, color-mix(in srgb, var(--color-brass) 30%, var(--color-night-0)) 55%, color-mix(in srgb, var(--color-brass) 22%, var(--color-night-0)) 100%)",
  ].join(", "),
  boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--color-brass-hi) 30%, transparent), 0 24px 64px color-mix(in srgb, var(--color-night-0) 80%, transparent)",
} as const;

/** The film's own darkening toward its edges. */
const VIGNETTE_STYLE = {
  background: "radial-gradient(ellipse at 50% 48%, transparent 52%, color-mix(in srgb, var(--color-night-0) 78%, transparent) 100%)",
} as const;

const CHIP = "rounded-chip border border-ink/10 bg-night-0/70 px-3 py-1";
const ICON_BUTTON = `${TARGET} ${FOCUS} inline-flex size-11 shrink-0 items-center justify-center rounded-control border border-brass/60 bg-night-0/60 text-brass transition-colors duration-(--dur-quick) hover:border-brass hover:bg-brass/10 hover:text-brass-hi`;
const ACTION_BUTTON = `${TARGET} ${FOCUS} mat-brass inline-flex items-center justify-center rounded-control px-5 text-base font-medium transition-transform duration-(--dur-quick) active:translate-y-0.5`;

const fade = { duration: DUR.base / 1000, ease: [...EASE.ecto] as [number, number, number, number] };

/** A control's glyph: 20 px, drawn in the button's own colour. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const CloseGlyph = () => (
  <Icon>
    <path d="M5 5 L15 15 M15 5 L5 15" />
  </Icon>
);
const FlipGlyph = () => (
  <Icon>
    <path d="M3.5 7.5 H14.5 L11.5 4.5" />
    <path d="M16.5 12.5 H5.5 L8.5 15.5" />
  </Icon>
);

interface ScreenProps extends XrayPanelProps {
  close: () => void;
  titleId: string;
  headingRef?: Ref<HTMLHeadingElement>;
}

/** The glass and everything on it. */
function Screen({ view, feed, controls, reduced, close, bones = "auto", titleId, headingRef }: ScreenProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [bonesFailed, setBonesFailed] = useState(false);
  const mirrored = view.facing === "user";
  const centred = NO_PICTURE.has(view.signal);
  // The film-only line stands in for missing bones, so it shows only while a picture is on the glass.
  const help = HELP[view.signal] ?? ((bonesFailed || bones === "none") && !centred ? { line: COPY.xray.help.filmOnly, action: null } : null);

  useEffect(() => {
    const el = video.current;
    if (el === null) return;
    return feed.attach(el);
  }, [feed]);

  return (
    <div data-xray-glass="" className="relative isolate min-h-0 flex-1 overflow-hidden bg-night-0 text-ink sm:rounded-control">
      {/* The picture as film, and the bones with it. Only these two are mirrored. */}
      <div role="img" aria-label={COPY.xray.panel.picture} className="absolute inset-0">
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          aria-hidden="true"
          data-xray-video=""
          data-mirrored={mirrored ? "true" : "false"}
          className={`absolute inset-0 h-full w-full object-cover grayscale brightness-[0.42] contrast-[1.35] ${mirrored ? "-scale-x-100" : ""}`}
        />
        <div aria-hidden="true" className="absolute inset-0 bg-ghost-deep opacity-60 mix-blend-color" />
        <div aria-hidden="true" className="absolute inset-0" style={VIGNETTE_STYLE} />
        {bones === "auto" && !bonesFailed ? <ThreeBones key={reduced ? "still" : "live"} feed={feed} mirrored={mirrored} still={reduced} onFail={() => setBonesFailed(true)} /> : null}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className={`${CHIP} pointer-events-auto flex items-center gap-3`}>
          <h2 ref={headingRef} id={titleId} tabIndex={-1} className="outline-none">
            <span className="sr-only">{COPY.xray.panel.title}</span>
            <span aria-hidden="true">
              <Wordmark variant="header" />
            </span>
          </h2>
          <p aria-live="polite" data-xray-signal-word="" className="flex items-center gap-2 font-mono text-xs text-ink-dim">
            <span aria-hidden="true" data-xray-lamp={view.signal} className={`inline-block size-2 shrink-0 rounded-full ${XRAY_LAMP[view.signal]}`} />
            {COPY.xray.signal[view.signal]}
          </p>
        </div>
        <div className="pointer-events-auto flex gap-2">
          {view.canFlip ? (
            <button type="button" data-action="xray-flip" aria-label={COPY.xray.panel.flip} className={ICON_BUTTON} onClick={controls.flip}>
              <FlipGlyph />
            </button>
          ) : null}
          <button type="button" data-action="xray-close" aria-label={COPY.xray.panel.close} className={ICON_BUTTON} onClick={close}>
            <CloseGlyph />
          </button>
        </div>
      </div>

      {help !== null ? (
        <div data-xray-help={view.signal} className={`pointer-events-none absolute inset-x-0 flex flex-col items-center gap-3 px-6 text-center ${centred ? "top-1/2 -translate-y-1/2" : "bottom-16"}`}>
          <p className={`${CHIP} max-w-md text-base text-ink`}>{help.line}</p>
          {help.action !== null ? (
            <button type="button" data-action="xray-retry" className={`${ACTION_BUTTON} pointer-events-auto`} onClick={controls.retry}>
              {help.action}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center">
        {view.signal === "searching" ? (
          <p data-xray-hint="" className={`${CHIP} text-sm text-ink`}>
            {COPY.xray.panel.hint}
          </p>
        ) : null}
        <p data-xray-note="" className="font-mono text-xs text-ink-dim">
          {COPY.xray.panel.note}
        </p>
      </div>
    </div>
  );
}

/** The oak and brass round the glass, from 640 px. Below it the glass fills the screen and the frame is not drawn. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div data-xray-frame="" className="relative flex min-h-0 flex-1 flex-col sm:rounded-frame sm:p-3.5">
      <div aria-hidden="true" className="absolute inset-0 hidden sm:block sm:rounded-frame" style={OAK_STYLE} />
      {(["top-1.5 left-1.5", "top-1.5 right-1.5", "bottom-1.5 left-1.5", "bottom-1.5 right-1.5"] as const).map((at) => (
        <Rivet key={at} className={`absolute hidden sm:inline-block ${at}`} />
      ))}
      <div className="relative flex min-h-0 flex-1 flex-col sm:mat-brass sm:rounded-card sm:p-[3px]">{children}</div>
    </div>
  );
}

/** The modal layer: a scrim and the screen, with focus moved in, held in, and handed back. */
function XrayLayer(props: XrayPanelProps) {
  const { controls, onClosed, reduced } = props;
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const holding = useRef(false);
  const present = useIsPresent();
  const titleId = useId();

  const handBack = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    const el = returnTo.current;
    returnTo.current = null;
    if (el && el.isConnected) el.focus({ preventScroll: true });
  }, []);

  const close = useCallback(() => {
    handBack();
    controls.close();
    onClosed?.();
  }, [handBack, controls, onClosed]);
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
    <div data-sheet-layer="" data-xray-layer="" className="fixed inset-0 z-50">
      <motion.div aria-hidden="true" data-sheet-scrim="" className="absolute inset-0 bg-night-0/80" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} />
      <motion.section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-xray-panel=""
        data-xray-signal={props.view.signal}
        data-xray-presentation="modal"
        tabIndex={-1}
        className={`${FRAME_BOX} outline-none`}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
        transition={reduced ? fade : { scale: { type: "spring", ...SPRING.settle }, opacity: fade }}
      >
        <Frame>
          <Screen {...props} close={close} titleId={titleId} headingRef={heading} />
        </Frame>
      </motion.section>
    </div>
  );
}

/** The screen in a specimen tile: in the page flow, not modal. */
function XrayInline(props: XrayPanelProps) {
  const { view, controls, onClosed } = props;
  const titleId = useId();
  const close = () => {
    controls.close();
    onClosed?.();
  };
  return (
    <section role="dialog" aria-labelledby={titleId} data-xray-panel="" data-xray-signal={view.signal} data-xray-presentation="inline" className={FRAME_INLINE}>
      <Frame>
        <Screen {...props} close={close} titleId={titleId} />
      </Frame>
    </section>
  );
}

export function XrayPanel(props: XrayPanelProps) {
  if (props.view.power === "off") return null;
  return (props.presentation ?? "modal") === "modal" ? <XrayLayer {...props} /> : <XrayInline {...props} />;
}
