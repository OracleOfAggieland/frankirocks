"use client";
// The radio globe in the panel (brief 047 part C): one square canvas with a clear background. three.js and the
// globe's engine arrive through loadGlobeEngine's import(), the one way into radio/globe/, so neither is in the page
// until the panel opens. If WebGL can't be had, or the context is lost, onFail tells the panel, which shows the
// station list instead.
// Drag to spin (pointer capture, so a drag that leaves the canvas still turns it); a press that moved less than
// PRESS_SLOP is a pick. A hovered light shows its city in a small label that follows it. The canvas is hidden from
// screen readers; its container is the image, focusable, and the left and right arrows walk the lights.
// `still` is Reduced_Motion: no frame loop runs, and the globe is drawn once for each change and each drag move.
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { COPY } from "../../ui/copy";
import { browserScheduler } from "../../ui/hooks/frame-loop";
import { COLOR } from "../../ui/motion";
import type { RadioSignal, Station } from "../../ui/radio/types";
import { observeElementSize, probeWebGL2 } from "../avatar/three-host";
import { FOCUS } from "../surfaces/classes";
import type * as GlobeEngineModule from "./globe/engine";
import type { GlobeEngine } from "./globe/engine";
import type { MapPalette } from "./globe/texture";

export type LoadedGlobeEngine = typeof GlobeEngineModule;

/** The one dynamic import of the globe's engine: its own chunk. */
export function loadGlobeEngine(): Promise<LoadedGlobeEngine> {
  return import("./globe/engine");
}

/** The most device pixels per CSS pixel the canvas is asked for; the engine applies the same cap. */
const MAX_DPR = 2;
/** A press that moved less than this, in CSS pixels, is a pick and not a drag. */
export const PRESS_SLOP = 6;
/** How much of each new pointer speed reading is kept, against the running speed. */
const SPEED_BLEND = 0.6;

/** The map's colours, from the CSS tokens; the hand-kept mirror in ui/motion.ts when a token can't be read. */
export function readPalette(read: (name: string) => string): MapPalette {
  const token = (name: keyof typeof COLOR) => read(`--color-${name}`).trim() || COLOR[name];
  return { sea: token("night-2"), land: token("ghost-deep"), coast: token("ecto"), thread: token("ink-dim") };
}

export interface ThreeGlobeProps {
  stations: readonly Station[];
  tunedId: string | null;
  signal: RadioSignal;
  still: boolean;
  onPick: (id: string) => void;
  /** The left (-1) or right (1) arrow key: walk to the previous or next light. */
  onStep: (direction: 1 | -1) => void;
  onFail: () => void;
}

type Cursor = "grab" | "grabbing" | "pointer";
const CURSOR: Record<Cursor, string> = { grab: "cursor-grab", grabbing: "cursor-grabbing", pointer: "cursor-pointer" };

interface Press {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t: number;
  vx: number;
  vy: number;
  dragging: boolean;
}

export function ThreeGlobe({ stations, tunedId, signal, still, onPick, onStep, onFail }: ThreeGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  const viewRef = useRef({ tunedId, signal });
  const failRef = useRef(onFail);
  const pressRef = useRef<Press | null>(null);
  const hoverRef = useRef<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Cursor>("grab");

  const hovered = hover === null ? undefined : stations.find((s) => s.id === hover);

  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);

  /** Moves the hover label onto the hovered light, or hides it when the light is round the back. */
  const placeLabel = () => {
    const label = labelRef.current;
    const engine = engineRef.current;
    const id = hoverRef.current;
    if (label === null) return;
    const p = engine !== null && id !== null ? engine.project(id) : null;
    if (p === null || !p.visible) {
      label.style.opacity = "0";
      return;
    }
    label.style.opacity = "1";
    label.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, calc(-100% - 10px))`;
  };
  const placeRef = useRef(placeLabel);
  useEffect(() => {
    placeRef.current = placeLabel;
  });

  const redrawIfStill = () => {
    if (!still) return;
    engineRef.current?.frame(0);
    placeRef.current();
  };

  useEffect(() => {
    viewRef.current = { tunedId, signal };
    engineRef.current?.setView({ tunedId, signal });
    redrawIfStill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tunedId, signal, still]);

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

    loadGlobeEngine()
      .then((mod) => {
        if (dead) return;
        const box = canvas.getBoundingClientRect();
        const dpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const style = getComputedStyle(document.documentElement);
        const palette = readPalette((name) => style.getPropertyValue(name));
        const engine = mod.createGlobeEngine(canvas, { w: box.width, h: box.height, dpr: dpr() }, { stations, still, palette });
        engineRef.current = engine;
        engine.setView(viewRef.current);
        // A resize clears the canvas, so a still globe is drawn again after each one.
        unobserve = observeElementSize(canvas, (w, h) => {
          engine.resize({ w, h, dpr: dpr() });
          if (still) {
            engine.frame(0);
            placeRef.current();
          }
        });
        if (still) {
          engine.frame(0);
          return;
        }
        let last: number | null = null;
        const tick = (frameTime: number) => {
          if (dead) return;
          engine.frame(last === null ? 0 : (frameTime - last) / 1000);
          if (hoverRef.current !== null) placeRef.current();
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
    // `stations` and `still` are fixed for the life of a mount: the panel remounts the globe when either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const local = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hoverAt = (id: string | null) => {
    if (hoverRef.current === id) return;
    hoverRef.current = id;
    setHover(id);
    engineRef.current?.setHover(id);
    redrawIfStill();
    placeRef.current();
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || engineRef.current === null) return;
    const { x, y } = local(e);
    // Capture keeps a drag alive past the canvas's edge. A pointer the browser no longer holds can't be captured;
    // the press still counts, it just ends at the edge.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not captured.
    }
    pressRef.current = { id: e.pointerId, x0: x, y0: y, x, y, t: e.timeStamp, vx: 0, vy: 0, dragging: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (engine === null) return;
    const { x, y } = local(e);
    const press = pressRef.current;
    if (press === null || press.id !== e.pointerId) {
      if (e.pointerType === "mouse") {
        const id = engine.pick(x, y);
        hoverAt(id);
        setCursor(id === null ? "grab" : "pointer");
      }
      return;
    }
    if (!press.dragging && Math.hypot(x - press.x0, y - press.y0) < PRESS_SLOP) return;
    if (!press.dragging) {
      press.dragging = true;
      setCursor("grabbing");
      hoverAt(null);
    }
    const dx = x - press.x;
    const dy = y - press.y;
    const dt = (e.timeStamp - press.t) / 1000;
    if (dt > 0) {
      press.vx = press.vx * (1 - SPEED_BLEND) + (dx / dt) * SPEED_BLEND;
      press.vy = press.vy * (1 - SPEED_BLEND) + (dy / dt) * SPEED_BLEND;
    }
    press.x = x;
    press.y = y;
    press.t = e.timeStamp;
    engine.dragBy(dx, dy);
    redrawIfStill();
  };

  const endPress = (e: PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const press = pressRef.current;
    const engine = engineRef.current;
    if (press === null || press.id !== e.pointerId) return;
    pressRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (engine === null) return;
    if (press.dragging) {
      // A pointer that stopped before letting go leaves the globe where it is.
      const stale = (e.timeStamp - press.t) / 1000 > 0.08;
      engine.release(cancelled || stale ? 0 : press.vx, cancelled || stale ? 0 : press.vy);
      setCursor("grab");
      redrawIfStill();
      return;
    }
    if (cancelled) return;
    const { x, y } = local(e);
    const id = engine.pick(x, y);
    if (id !== null) onPick(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onStep(e.key === "ArrowLeft" ? -1 : 1);
    }
  };

  return (
    <div
      role="img"
      aria-label={COPY.radio.panel.globe}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-radio-globe=""
      data-globe-still={still ? "true" : "false"}
      className={`${FOCUS} relative aspect-square w-full rounded-control`}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-globe-canvas=""
        className={`block h-full w-full touch-none select-none ${CURSOR[cursor]}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPress(e, false)}
        onPointerCancel={(e) => endPress(e, true)}
        onPointerLeave={(e) => {
          if (pressRef.current === null && e.pointerType === "mouse") {
            hoverAt(null);
            setCursor("grab");
          }
        }}
      />
      <span
        ref={labelRef}
        aria-hidden="true"
        data-globe-label=""
        className="pointer-events-none absolute top-0 left-0 rounded-chip border border-ink/10 bg-night-1/90 px-2 py-0.5 font-mono text-xs whitespace-nowrap text-ink opacity-0"
      >
        {hovered?.city ?? ""}
      </span>
    </div>
  );
}
