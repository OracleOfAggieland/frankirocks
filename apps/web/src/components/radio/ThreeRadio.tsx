"use client";
// The three.js radio on the stage: one canvas with a clear background. three.js and the radio's engine arrive
// through loadRadioEngine's import(), the one way into radio/three/, so neither is in the page's first load.
// Nothing is drawn until the engine's first frame; if WebGL can't be had, or the context is lost, onFail tells the
// caller, which then shows the words alone. `still` is Reduced_Motion: no frame loop runs, and the settled pose is
// drawn once for each view, each hover change and each size.
import { useEffect, useRef } from "react";
import type { RadioPropView } from "../../ui/radio/types";
import { browserScheduler } from "../../ui/hooks/frame-loop";
import { observeElementSize, probeWebGL2 } from "../avatar/three-host";
import type * as RadioEngineModule from "./three/engine";
import type { RadioEngine } from "./three/engine";

export type LoadedRadioEngine = typeof RadioEngineModule;

/** The one dynamic import of the radio's engine: its own chunk, beside the ghost's and the phone's. */
export function loadRadioEngine(): Promise<LoadedRadioEngine> {
  return import("./three/engine");
}

/** The most device pixels per CSS pixel the canvas is asked for; the engine applies the same cap. */
const MAX_DPR = 2;

export function ThreeRadio({ view, hover, still, onFail }: { view: RadioPropView; hover: boolean; still: boolean; onFail: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<RadioEngine | null>(null);
  const viewRef = useRef(view);
  const hoverRef = useRef(hover);
  const failRef = useRef(onFail);

  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);
  useEffect(() => {
    viewRef.current = view;
    hoverRef.current = hover;
    engineRef.current?.setView(view);
    engineRef.current?.setHover(hover);
    if (still) engineRef.current?.frame(0);
  }, [view, hover, still]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    if (!probeWebGL2()) {
      failRef.current();
      return;
    }
    const scheduler = browserScheduler();
    let dead = false;
    let handle: unknown = null;
    let unobserve = () => {};
    const onLost = () => {
      if (!dead) failRef.current();
    };
    canvas.addEventListener("webglcontextlost", onLost);

    loadRadioEngine()
      .then((mod) => {
        if (dead) return;
        const box = canvas.getBoundingClientRect();
        const dpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const engine = mod.createRadioEngine(canvas, { w: box.width, h: box.height, dpr: dpr() }, viewRef.current, { still });
        engine.setHover(hoverRef.current);
        engineRef.current = engine;
        // A resize clears the canvas, so a still radio is drawn again after each one.
        unobserve = observeElementSize(canvas, (w, h) => {
          engine.resize({ w, h, dpr: dpr() });
          if (still) engine.frame(0);
        });
        if (still) {
          engine.frame(0);
          return;
        }
        let last: number | null = null;
        const tick = (frameTime: number) => {
          if (dead) return;
          engine.frame(last === null ? 0 : (frameTime - last) / 1000);
          last = frameTime;
          handle = scheduler.request(tick);
        };
        handle = scheduler.request(tick);
      })
      .catch(() => {
        if (!dead) failRef.current();
      });

    return () => {
      dead = true;
      if (handle !== null) scheduler.cancel(handle);
      unobserve();
      canvas.removeEventListener("webglcontextlost", onLost);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // `still` is fixed for the life of a mount: the caller remounts the radio when Reduced_Motion changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" data-radio-canvas="" data-radio-still={still ? "true" : "false"} className="pointer-events-none block h-full w-full" />;
}
