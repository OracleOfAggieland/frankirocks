"use client";
// The radio on the stage's floor at Franki's lower left (brief 047 part B): a small oak and brass tabletop radio,
// built in three.js (radio/three/), from the same set as the wall phone. It is always there, and acts what the
// radio is doing:
//   off        the dial is dark and the needle parked; a hover or keyboard focus warms the dial to invite a press
//   tuning     the dial is lit, the needle sweeps, and a small spark crackles at the antenna's tip
//   playing    the dial glows ghost green, the speaker pulses, the cabinet bobs, rings and a note drift up
//   noSignal   the dial glows ember and the needle trembles in place
//   tapToPlay  the dial blinks slowly
// and while the globe is open a faint brass glow under it marks it as the globe's source. Under Reduced_Motion the
// same radio is drawn still, in the pose each state comes to rest in. A real button lies over the canvas and says
// what a press would do; if WebGL fails, the button shows a word instead, in the same place.
import { useCallback, useState } from "react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import type { RadioPropView } from "../../ui/radio/types";
import { FOCUS, TARGET } from "../surfaces/classes";
import { ThreeRadio } from "./ThreeRadio";

/** What the button says to a screen reader: what a press would do now. */
export function radioLabel(view: RadioPropView): string {
  if (view.power === "off") return COPY.radio.prop.turnOn;
  return view.open ? COPY.radio.prop.closeGlobe : COPY.radio.prop.openGlobe;
}

/**
 * Where the radio stands on the stage: on the floor at Franki's lower left, its bottom level with the floor shadow
 * and its right edge just over the ghost canvas's left side. Smaller and closer in on a narrow screen, where it
 * still ends inside the viewport. Placed against the stage box, so it takes no room.
 */
export const RADIO_PLACE = "absolute bottom-[-7%] right-[77%] aspect-[1/1] w-[84%] max-sm:right-[72%] max-sm:w-[52%]";

/** The button over the canvas: the whole square, clear, with the house focus ring. */
export const RADIO_COVER = `${TARGET} ${FOCUS} absolute inset-0 cursor-pointer rounded-control bg-transparent`;

/** The button as words, when the radio can't be drawn: the bank's chip, at the radio's foot nearest Franki. */
export const RADIO_FALLBACK = `${TARGET} ${FOCUS} absolute bottom-0 right-0 inline-flex items-center justify-center rounded-chip border border-brass/70 px-4 text-sm text-brass transition-colors duration-(--dur-quick) hover:border-brass hover:bg-brass/10 hover:text-brass-hi`;

export interface RadioPropProps {
  view: RadioPropView;
  onPress: () => void;
  /** Reduced_Motion: the radio is drawn still. */
  reduced: boolean;
  /** True once WebGL has failed: the button shows words instead of lying over a canvas. */
  failed: boolean;
  hover: boolean;
  onHover: (hover: boolean) => void;
  onFail: () => void;
}

/** The radio as drawn, with its state passed in. RadioOnStage holds that state; the specimens can pass any. */
export function RadioProp({ view, onPress, reduced, failed, hover, onHover, onFail }: RadioPropProps) {
  return (
    <div data-radio="" data-radio-power={view.power} data-radio-signal={view.signal} className={RADIO_PLACE}>
      {/* Remounted when Reduced_Motion changes: a still radio and a moving one are built differently. */}
      {failed ? null : <ThreeRadio key={reduced ? "still" : "moving"} view={view} hover={hover} still={reduced} onFail={onFail} />}
      <button
        type="button"
        data-radio-button=""
        aria-label={radioLabel(view)}
        aria-expanded={view.open}
        aria-haspopup="dialog"
        onClick={onPress}
        onPointerEnter={() => onHover(true)}
        onPointerLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        className={failed ? RADIO_FALLBACK : RADIO_COVER}
      >
        {failed ? COPY.radio.prop.fallback : null}
      </button>
    </div>
  );
}

/** The radio in its place on the stage. Always rendered, in every state; rendered inside the Stage's `aside`. */
export function RadioOnStage({ view, onPress }: { view: RadioPropView; onPress: () => void }) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  return <RadioProp view={view} onPress={onPress} reduced={reduced} failed={failed} hover={hover} onHover={setHover} onFail={onFail} />;
}
