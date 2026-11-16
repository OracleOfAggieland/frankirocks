"use client";
// The bones over the X-ray screen's picture (brief 051 part C): one clear canvas the size of the screen. three.js and
// the bones' engine arrive through loadBonesEngine's import(), the one way into xray/anatomy/, so neither is in the
// page until the screen opens. If WebGL can't be had, or the context is lost, onFail tells the screen, which shows
// the film alone.
// Each frame it reads the feed's newest tracked frame (outside React: it changes every frame) and the engine eases
// toward it by the frame's own time. `still` is Reduced_Motion: the film's grain, scan line and flicker are left
// out, but the bones still follow the person, since they are the content and not decoration.
import { useEffect, useRef } from "react";
import { browserScheduler } from "../../ui/hooks/frame-loop";
import type { XrayFeed } from "../../ui/xray/types";
import { observeElementSize, probeWebGL2 } from "../avatar/three-host";
import type * as BonesEngineModule from "./anatomy/engine";
import type { BonesEngine } from "./anatomy/engine";

export type LoadedBonesEngine = typeof BonesEngineModule;

/** The one dynamic import of the bones' engine: its own chunk. */
export function loadBonesEngine(): Promise<LoadedBonesEngine> {
  return import("./anatomy/engine");
}

/** The most device pixels per CSS pixel the canvas is asked for; the engine applies the same cap. */
const MAX_DPR = 2;

export interface ThreeBonesProps {
  feed: XrayFeed;
  /** The selfie camera's picture is drawn mirrored, and the bones with it. */
  mirrored: boolean;
  still: boolean;
  onFail: () => void;
}

export function ThreeBones({ feed, mirrored, still, onFail }: ThreeBonesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BonesEngine | null>(null);
  const feedRef = useRef(feed);
  const mirroredRef = useRef(mirrored);
  const failRef = useRef(onFail);

  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);
  useEffect(() => {
    feedRef.current = feed;
  }, [feed]);
  useEffect(() => {
    mirroredRef.current = mirrored;
    engineRef.current?.setMirrored(mirrored);
  }, [mirrored]);

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

    loadBonesEngine()
      .then((mod) => {
        if (dead) return;
        const box = canvas.getBoundingClientRect();
        const dpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const engine = mod.createBonesEngine(canvas, { w: box.width, h: box.height, dpr: dpr() }, { still });
        engineRef.current = engine;
        engine.setMirrored(mirroredRef.current);
        unobserve = observeElementSize(canvas, (w, h) => engine.resize({ w, h, dpr: dpr() }));
        let last: number | null = null;
        const tick = (frameTime: number) => {
          if (dead) return;
          engine.frame(last === null ? 0 : (frameTime - last) / 1000, feedRef.current.latest());
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
    // `still` is fixed for the life of a mount: the screen remounts the bones when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" data-xray-bones="" data-bones-still={still ? "true" : "false"} className="pointer-events-none absolute inset-0 block h-full w-full" />;
}
