"use client";
// The X-ray machine on the stage's floor at Franki's lower right (brief 051 part B), the radio's mirror image: an
// antique oak and brass fluoroscope, built in three.js (xray/three/), from the same set as the wall phone and the
// radio. It is always there, and acts what the machine is doing:
//   off              the glass is dark and the arm parked upright; a hover or keyboard focus warms the glass amber
//   asking           the arm swings down to aim the tube head at the glass, the glass flickers a dim amber, and an
//                    arc crackles between the head's two electrodes
//   warming          the same, brighter and greener, with a faint hand and a slow scan line showing through
//   searching        the glass glows ghost green with the hand's bones half bright and the scan line hunting fast,
//                    a faint beam from the head to the glass
//   seeing           full ghost green, the bones bright, the beam on, a slow and sure scan
//   filmOnly         the pale grey of bare film, the bones faint, no beam
//   blocked          a steady ember glass, the arm still raised
//   noCamera         a dim ember glass that stutters like a dying tube, the arm drooping
//   paused           a slow green blink with the hand faint in it, the arm halfway up
// Under Reduced_Motion the same machine is drawn still, in the pose each state comes to rest in. A real button lies
// over the canvas and says what a press would do; if WebGL fails, the button shows a word instead, in the same place.
import { useCallback, useState } from "react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import type { XrayPropView } from "../../ui/xray/types";
import { FOCUS, TARGET } from "../surfaces/classes";
import { ThreeXray } from "./ThreeXray";

/** What the button says to a screen reader: what a press would do now. On means the X-ray screen is open. */
export function xrayLabel(view: XrayPropView): string {
  return view.power === "off" ? COPY.xray.prop.turnOn : COPY.xray.prop.turnOff;
}

/**
 * Where the machine stands on the stage: on the floor at Franki's lower right, the radio's place (RADIO_PLACE)
 * mirrored, its bottom level with the floor shadow and its left edge just over the ghost canvas's right side.
 * Smaller and closer in on a narrow screen. Placed against the stage box, so it takes no room. A starting point,
 * to be tuned by eye.
 */
export const XRAY_PLACE = "absolute bottom-[-7%] left-[77%] aspect-[1/1] w-[84%] max-sm:left-[72%] max-sm:w-[52%]";

/** The button over the canvas: the whole square, clear, with the house focus ring. */
export const XRAY_COVER = `${TARGET} ${FOCUS} absolute inset-0 cursor-pointer rounded-control bg-transparent`;

/** The button as words, when the machine can't be drawn: the bank's chip, at the machine's foot nearest Franki. */
export const XRAY_FALLBACK = `${TARGET} ${FOCUS} absolute bottom-0 left-0 inline-flex items-center justify-center rounded-chip border border-brass/70 px-4 text-sm text-brass transition-colors duration-(--dur-quick) hover:border-brass hover:bg-brass/10 hover:text-brass-hi`;

export interface XrayPropProps {
  view: XrayPropView;
  onPress: () => void;
  /** Reduced_Motion: the machine is drawn still. */
  reduced: boolean;
  /** True once WebGL has failed: the button shows words instead of lying over a canvas. */
  failed: boolean;
  hover: boolean;
  onHover: (hover: boolean) => void;
  onFail: () => void;
  /** Where the machine is placed; the stage's place unless the specimens lay it out in a box of their own. */
  place?: string;
}

/** The machine as drawn, with its state passed in. XrayOnStage holds that state; the specimens can pass any. */
export function XrayProp({ view, onPress, reduced, failed, hover, onHover, onFail, place = XRAY_PLACE }: XrayPropProps) {
  return (
    <div data-xray="" data-xray-power={view.power} data-xray-signal={view.signal} className={place}>
      {/* Remounted when Reduced_Motion changes: a still machine and a moving one are built differently. */}
      {failed ? null : <ThreeXray key={reduced ? "still" : "moving"} view={view} hover={hover} still={reduced} onFail={onFail} />}
      <button
        type="button"
        data-xray-button=""
        aria-label={xrayLabel(view)}
        aria-expanded={view.power === "on"}
        aria-haspopup="dialog"
        onClick={onPress}
        onPointerEnter={() => onHover(true)}
        onPointerLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        className={failed ? XRAY_FALLBACK : XRAY_COVER}
      >
        {failed ? COPY.xray.prop.fallback : null}
      </button>
    </div>
  );
}

/** The machine in its place on the stage. Always rendered, in every state; rendered inside the Stage's `aside`. */
export function XrayOnStage({ view, onPress }: { view: XrayPropView; onPress: () => void }) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  return <XrayProp view={view} onPress={onPress} reduced={reduced} failed={failed} hover={hover} onHover={setHover} onFail={onFail} />;
}
