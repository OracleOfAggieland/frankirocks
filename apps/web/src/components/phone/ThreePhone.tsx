"use client";
// The three.js wall phone on the stage: one canvas with a clear background, placed over the stage so the handset can
// reach Franki. three.js and the phone's engine arrive through loadPhoneEngine's import(), the one way into
// phone/three/, so neither is in the page until a call is shown. Nothing is drawn until the engine's first frame;
// if WebGL can't be had, or the context is lost, onFail tells the caller, which then shows the words alone.
// `still` is Reduced_Motion: no frame loop runs, and the settled pose is drawn once for each view and each size.
import { useEffect, useRef } from "react";
import { browserScheduler } from "../../ui/hooks/frame-loop";
import { observeElementSize, probeWebGL2 } from "../avatar/three-host";
import type * as PhoneEngineModule from "./three/engine";
import type { PhoneEngine } from "./three/engine";
import type { ShownView } from "./three/motion";

export type LoadedPhoneEngine = typeof PhoneEngineModule;

/** The one dynamic import of the phone's engine: its own chunk, beside the ghost's. */
export function loadPhoneEngine(): Promise<LoadedPhoneEngine> {
  return import("./three/engine");
}

/** The most device pixels per CSS pixel the canvas is asked for; the engine applies the same cap. */
const MAX_DPR = 2;

export function ThreePhone({ view, still, onFail }: { view: ShownView; still: boolean; onFail: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PhoneEngine | null>(null);
  const viewRef = useRef(view);
  const failRef = useRef(onFail);

  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);
  useEffect(() => {
    viewRef.current = view;
    engineRef.current?.setView(view);
    if (still) engineRef.current?.frame(0);
  }, [view, still]);

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

    loadPhoneEngine()
      .then((mod) => {
        if (dead) return;
        const box = canvas.getBoundingClientRect();
        const dpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const engine = mod.createPhoneEngine(canvas, { w: box.width, h: box.height, dpr: dpr() }, viewRef.current, { still });
        engineRef.current = engine;
        // A resize clears the canvas, so a still phone is drawn again after each one.
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
    // `still` is fixed for the life of a mount: the caller remounts the phone when Reduced_Motion changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" data-phone-canvas="" data-phone-still={still ? "true" : "false"} className="block h-full w-full" />;
}
