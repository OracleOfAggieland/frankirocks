"use client";
// The three.js renderer behind the Avatar_Contract (brief 013, design note §4.3), written in WP12: an SVG layer and
// a canvas layer in one box that never changes size, driven by one ThreeGhostController per mount.
//
// The box is the SVG ghost's own (viewBox 200 x 220), so the stage keeps its size in every phase, including three,
// when the SVG layer is unmounted. The canvas layer comes first, so the SVG layer paints over it; it is placed by
// CANVAS_FRAME, which imports nothing, so reading it here pulls no three.js into the page. The SVG ghost is the
// fallback only (reduced motion, no WebGL 2, a lost context, a failed engine): the box is empty on the server and
// while three.js loads, and the canvas fades in on its own. Fading out, the SVG fades in over the opaque canvas.
// A lost context shows the SVG at once. Opacity is set by class, never inline.
import { type AnimationEvent, type CSSProperties, type TransitionEvent, useEffect, useState, useSyncExternalStore } from "react";
import type { CanvasLayer, SvgLayer } from "../../ui/avatar/renderer-phase";
import type { AvatarRenderer, AvatarRendererProps } from "../../ui/avatar/types";
import { useAvatarAudio } from "./avatar-audio";
import { CANVAS_FRAME, type CanvasFrame } from "./canvas-frame";
import { SvgGhost } from "./SvgGhost";
import { ThreeGhostController } from "./three-ghost-controller";
import { type ThreeHostDeps, browserThreeHost } from "./three-host";

/** The avatar box's height over its width: the SVG ghost's viewBox, 220 over 200. CANVAS_FRAME is in box widths. */
const BOX_HEIGHT_OVER_WIDTH = 1.1;

const pct = (x: number) => `${(x * 100).toFixed(4)}%`;

/** CANVAS_FRAME as CSS: left and width in box widths, top and height converted to box heights. */
export function canvasFrameStyle(f: Readonly<CanvasFrame>): CSSProperties {
  return {
    left: pct(f.left),
    top: pct(f.top / BOX_HEIGHT_OVER_WIDTH),
    width: pct(f.width),
    height: pct(f.height / BOX_HEIGHT_OVER_WIDTH),
  };
}

const CANVAS_STYLE: CSSProperties = canvasFrameStyle(CANVAS_FRAME);

/** The radial mask that blends the prototype's background into the app's backdrop (stop calibrated at I3). */
const CANVAS_MASK = "[mask-image:radial-gradient(closest-side,black_72%,transparent)]";

/** §4.3 item 5. hidden and shown change at once; entering fades over one base duration. */
export const CANVAS_LAYER_CLASS: Readonly<Record<Exclude<CanvasLayer, "absent">, string>> = {
  hidden: "opacity-0",
  entering: "opacity-100 transition-opacity duration-(--dur-base) ease-(--ease-ecto)",
  shown: "opacity-100",
};

/** §4.3 item 5. entering is franki-fade. */
export const SVG_LAYER_CLASS: Readonly<Record<Exclude<SvgLayer, "absent">, string>> = {
  shown: "opacity-100",
  entering: "franki-fade",
};

/** One renderer per dependency factory; the specimens page builds its own with a budget per tile. */
export function createThreeGhost(makeDeps: () => ThreeHostDeps = browserThreeHost): AvatarRenderer {
  return function ThreeGhost({ look, input }: AvatarRendererProps) {
    // No side effects in the constructor: Strict Mode may build it twice and keep one.
    const [ctl] = useState(() => new ThreeGhostController(makeDeps()));
    const view = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getServerSnapshot);
    const audio = useAvatarAudio();

    useEffect(() => {
      ctl.start();
      return () => ctl.stop();
    }, [ctl]);
    useEffect(() => {
      ctl.setLook(look, input);
    }, [ctl, look, input]);
    useEffect(() => {
      ctl.setAudio(audio);
    }, [ctl, audio]);
    // After the commit that unmounted the SVG layer, whose Electricity cleanup released its own grants (§4.4).
    useEffect(() => {
      ctl.syncGrant();
    }, [ctl, view.phase, look.electric]);

    // Only a layer's own fade ends the phase: the SVG ghost's inner animations bubble up through it. The canvas
    // layer's transition ends fading-in; the SVG layer's animation ends fading-out.
    const onFadeEnd = (e: AnimationEvent<HTMLDivElement> | TransitionEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) ctl.fadeDone();
    };

    return (
      <div className="relative isolate aspect-[10/11] w-full" data-three-phase={view.phase}>
        {view.canvas !== "absent" ? (
          <div
            ref={ctl.attach}
            aria-hidden="true"
            data-three-layer="canvas"
            data-layer-state={view.canvas}
            className={`pointer-events-none absolute ${CANVAS_MASK} ${CANVAS_LAYER_CLASS[view.canvas]}`}
            style={CANVAS_STYLE}
            onTransitionEnd={onFadeEnd}
          />
        ) : null}
        {view.svg !== "absent" ? (
          <div
            data-three-layer="svg"
            data-layer-state={view.svg}
            className={`absolute inset-0 ${SVG_LAYER_CLASS[view.svg]}`}
            onTransitionEnd={onFadeEnd}
            onAnimationEnd={onFadeEnd}
          >
            <SvgGhost look={look} input={input} />
          </div>
        ) : null}
      </div>
    );
  };
}

export const ThreeGhost: AvatarRenderer = createThreeGhost(browserThreeHost);
