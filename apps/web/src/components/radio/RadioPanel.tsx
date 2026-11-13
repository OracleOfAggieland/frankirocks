"use client";
// The radio's globe panel (brief 047 part C): a floating glass panel, not modal. No scrim, no focus trap, and the
// owner can talk to Franki, read a card or type while it is open. Escape closes it when focus is inside; closing
// leaves the station playing, and only the off button stops it. From 640 px it sits at the lower left, 16 rem wide
// (22 rem from 1800 px); below, it sits under the header across the width with a shorter globe.
// Top to bottom: the wordmark and a close button; the globe; the station, its place and the signal word (a polite
// live region); then previous, spin, next, the volume and off. If the globe can't be drawn, a list of stations
// stands in for it. Cheap to load with the page: three.js arrives only through ThreeGlobe's one import().
// Render it inside an AnimatePresence: it rises and fades in, and only fades under reduced motion.
import { motion } from "motion/react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { COPY } from "../../ui/copy";
import { DUR, EASE } from "../../ui/motion";
import type { RadioControls, RadioSignal, RadioView, Station } from "../../ui/radio/types";
import { FOCUS, QUIET_BUTTON, TARGET } from "../surfaces/classes";
import { Wordmark } from "../surfaces/Wordmark";
import { ThreeGlobe } from "./ThreeGlobe";

export interface RadioPanelProps {
  view: RadioView;
  stations: readonly Station[];
  controls: RadioControls;
  reduced: boolean;
  /** Told after the panel asked to close (its button or Escape), so the caller can put focus back on the radio. */
  onClosed?: () => void;
  /** "floating" (the default) is fixed on the screen; "inline" sits in the page flow, for a specimen tile. */
  presentation?: "floating" | "inline";
  /** "auto" (the default) draws the globe; "list" puts the station list in its place, as when WebGL fails. */
  globe?: "auto" | "list";
}

/**
 * Where the panel sits: under the header across the width below 640 px, at the lower left from 640 px. It is 16 rem
 * wide until 1800 px: the stage moves left when cards are docked beside it, and only a very wide screen leaves the
 * radio on the stage clear of 22 rem. It never grows taller than the screen: a short window scrolls it.
 */
export const PANEL_PLACE =
  "fixed z-40 inset-x-4 top-16 max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain sm:inset-x-auto sm:top-auto sm:bottom-3 sm:left-3 sm:max-h-[calc(100dvh-1.5rem)] sm:w-[16rem] min-[1800px]:w-[22rem]";
/** The inline panel's box: in the page flow, at the floating panel's width. */
export const PANEL_INLINE = "relative w-[22rem] max-w-full";
/** The globe's box: capped at 40vh below 640 px, so the panel stays short on a phone. */
export const GLOBE_BOX = "mx-auto w-full max-w-[40vh] sm:max-w-none";

/** The lamp beside the signal word: ecto on air, brass while tuning or waiting for a press, ember with no signal. */
export const SIGNAL_LAMP: Record<RadioSignal, string> = {
  playing: "bg-ecto shadow-ecto-glow",
  tuning: "bg-brass shadow-brass-glow",
  tapToPlay: "bg-brass",
  noSignal: "bg-ember",
  silent: "border border-stitch bg-night-1",
};

/** The two signals a press can mend. */
export const canRetry = (signal: RadioSignal): boolean => signal === "tapToPlay" || signal === "noSignal";

const ICON_BUTTON = `${TARGET} ${FOCUS} inline-flex size-11 shrink-0 items-center justify-center rounded-control border border-brass/60 text-brass transition-colors duration-(--dur-quick) hover:border-brass hover:bg-brass/10 hover:text-brass-hi disabled:opacity-40`;
const OFF_BUTTON = `${TARGET} ${FOCUS} inline-flex size-11 shrink-0 items-center justify-center rounded-control border border-ember/60 text-ember transition-colors duration-(--dur-quick) hover:border-ember hover:bg-ember/10`;
const CLOSE_BUTTON = `${TARGET} ${FOCUS} inline-flex size-11 items-center justify-center rounded-control text-ink-dim transition-colors duration-(--dur-quick) hover:bg-night-2 hover:text-ink`;
const STATION_BUTTON = `${TARGET} ${FOCUS} flex w-full flex-col items-start justify-center rounded-control px-3 py-1.5 text-left transition-colors duration-(--dur-quick) hover:bg-night-2 aria-[current=true]:bg-night-2 aria-[current=true]:text-ecto`;

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
const PreviousGlyph = () => (
  <Icon>
    <path d="M5 4.5 V15.5" />
    <path d="M15 4.8 L8 10 L15 15.2 Z" fill="currentColor" />
  </Icon>
);
const NextGlyph = () => (
  <Icon>
    <path d="M15 4.5 V15.5" />
    <path d="M5 4.8 L12 10 L5 15.2 Z" fill="currentColor" />
  </Icon>
);
const SpinGlyph = () => (
  <Icon>
    <path d="M15.6 7.2 A6 6 0 1 0 16 11.4" />
    <path d="M16.2 3.6 V7.6 H12.2" />
  </Icon>
);
const OffGlyph = () => (
  <Icon>
    <path d="M10 3 V9.5" />
    <path d="M6.2 5.6 A6 6 0 1 0 13.8 5.6" />
  </Icon>
);

function StationList({ stations, tunedId, onTune }: { stations: readonly Station[]; tunedId: string | null; onTune: (id: string) => void }) {
  return (
    <ul aria-label={COPY.radio.panel.list} data-radio-list="" className="flex max-h-56 flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-control border border-ink/10 bg-night-1/60 p-1">
      {stations.map((s) => (
        <li key={s.id}>
          <button type="button" data-station={s.id} aria-label={COPY.radio.panel.tuneTo(s.name, s.city)} aria-current={s.id === tunedId ? "true" : undefined} className={STATION_BUTTON} onClick={() => onTune(s.id)}>
            <span className="w-full truncate text-sm text-ink">{s.name}</span>
            <span className="text-xs text-ink-dim">{COPY.radio.panel.place(s.city, s.country)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RadioPanel({ view, stations, controls, reduced, onClosed, presentation = "floating", globe = "auto" }: RadioPanelProps) {
  const [globeFailed, setGlobeFailed] = useState(false);
  if (view.panel === "closed") return null;

  const close = () => {
    controls.closePanel();
    onClosed?.();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const station = view.station;
  const tunedId = station?.id ?? null;

  return (
    <motion.section
      role="dialog"
      aria-label={COPY.radio.panel.title}
      data-radio-panel=""
      data-radio-signal={view.signal}
      onKeyDown={onKeyDown}
      data-radio-presentation={presentation}
      className={`${presentation === "inline" ? PANEL_INLINE : PANEL_PLACE} mat-glass flex flex-col gap-3 rounded-card p-3 text-left`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      transition={fade}
    >
      <div className="flex items-center justify-between gap-2 pl-1">
        <Wordmark variant="header" />
        <button type="button" data-action="radio-close" aria-label={COPY.radio.panel.close} className={CLOSE_BUTTON} onClick={close}>
          <CloseGlyph />
        </button>
      </div>

      {globeFailed || globe === "list" ? (
        <StationList stations={stations} tunedId={tunedId} onTune={controls.tune} />
      ) : (
        <div className={GLOBE_BOX}>
          <ThreeGlobe
            key={reduced ? "still" : "live"}
            stations={stations}
            tunedId={tunedId}
            signal={view.signal}
            still={reduced}
            onPick={controls.tune}
            onStep={controls.step}
            onFail={() => setGlobeFailed(true)}
          />
        </div>
      )}

      <div aria-live="polite" data-radio-readout="" className="flex min-h-11 flex-col justify-center gap-0.5 px-1">
        {station !== null ? (
          <p data-radio-station="" title={station.name} className="truncate text-base text-ink">
            {station.name}
          </p>
        ) : null}
        {station !== null ? <p className="text-sm text-ink-dim">{COPY.radio.panel.place(station.city, station.country)}</p> : null}
        <div className="flex min-h-6 items-center gap-2">
          <span aria-hidden="true" data-radio-lamp={view.signal} className={`inline-block size-2 shrink-0 rounded-full ${SIGNAL_LAMP[view.signal]}`} />
          <span data-radio-signal-word="" className="font-mono text-xs text-ink-dim">
            {COPY.radio.signal[view.signal]}
          </span>
          {canRetry(view.signal) ? (
            <button type="button" data-action="radio-retry" className={`${QUIET_BUTTON} ml-auto min-h-11 px-3 text-sm`} onClick={controls.retry}>
              {COPY.radio.panel.retry}
            </button>
          ) : null}
        </div>
      </div>

      {/* The volume takes a row of its own, with off, where the panel is too narrow to hold all five in one. */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-action="radio-previous" aria-label={COPY.radio.panel.previous} className={ICON_BUTTON} onClick={() => controls.step(-1)}>
          <PreviousGlyph />
        </button>
        <button type="button" data-action="radio-spin" aria-label={COPY.radio.panel.spin} className={ICON_BUTTON} onClick={controls.spin}>
          <SpinGlyph />
        </button>
        <button type="button" data-action="radio-next" aria-label={COPY.radio.panel.next} className={ICON_BUTTON} onClick={() => controls.step(1)}>
          <NextGlyph />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={view.volume}
          aria-label={COPY.radio.panel.volume}
          data-radio-volume=""
          className={`${FOCUS} h-11 min-w-[6.5rem] flex-1 cursor-pointer accent-brass`}
          onChange={(e) => controls.setVolume(Number(e.currentTarget.value))}
        />
        <button type="button" data-action="radio-off" aria-label={COPY.radio.panel.off} className={OFF_BUTTON} onClick={controls.powerOff}>
          <OffGlyph />
        </button>
      </div>
    </motion.section>
  );
}
