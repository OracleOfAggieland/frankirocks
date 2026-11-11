// The three.js renderer's browser dependencies (brief 013, design note §3.3 three-host.ts), written in WP12.
// Injected, so the controller's tests run in node with fakes. browserThreeHost() touches no browser global until
// one of its methods is called, so it is safe to call during a server render. Only type imports from three/: the
// engine arrives through loadEngine's import(), the one way into three/.
import { createBrowserClock } from "../../client/clock";
import { type ElectricityBudget, electricityBudget } from "../../ui/electricity-budget";
import { browserScheduler } from "../../ui/hooks/frame-loop";
import { browserVisibility } from "../../ui/hooks/page-visible";
import type { AvatarAudioSource } from "../../ui/levels/audio-source";
import type * as EngineModule from "./three/engine";
import type { AvatarEngine, EngineEvent, EngineHost, EngineOptions } from "./three/engine";

export type LoadedEngine = typeof EngineModule;

export interface ThreeHostDeps {
  /** The app passes { still: false, quality: "auto" }. */
  options: EngineOptions;
  /**
   * WebGL 2 with a float colour buffer: getContext("webgl2") on a throwaway canvas and one of EXT_color_buffer_float or
   * EXT_color_buffer_half_float; then WEBGL_lose_context frees it at once. Memoised once per page.
   */
  probeWebGL2(): boolean;
  /** () => import("./three/engine"): the only dynamic import of the engine. */
  loadEngine(): Promise<LoadedEngine>;
  /** browserScheduler(), browserVisibility(), createBrowserClock().mono, a yield that lets the browser paint, the audio source. */
  engineHost(audio: AvatarAudioSource, onEvent: (e: EngineEvent) => void): EngineHost;
  /** ResizeObserver on the canvas layer, CSS pixels. Returns the disconnect. */
  observeSize(el: HTMLElement, cb: (w: number, h: number) => void): () => void;
  /** The screen's electricityBudget in the app; one budget per tile on the specimens page. */
  budget: ElectricityBudget;
  /** Told when an engine is ready and when it goes away (the specimens page reads stats from it). */
  onEngine?(engine: AvatarEngine | null): void;
}

/** The app's engine options: live animation, the quality ladder on auto. */
export const APP_ENGINE_OPTIONS: Readonly<EngineOptions> = Object.freeze({ still: false, quality: "auto" });

/** One of these is needed for the engine's float render targets (bloom and the grade pass). */
export const FLOAT_BUFFER_EXTENSIONS = ["EXT_color_buffer_float", "EXT_color_buffer_half_float"] as const;

/** The minimal document the probe needs; the browser's document satisfies it. */
export interface ProbeDocument {
  createElement(tag: "canvas"): { getContext(kind: "webgl2"): ProbeContext | null };
}

/** The minimal WebGL 2 context the probe needs. */
export interface ProbeContext {
  getExtension(name: string): unknown;
}

/**
 * The probe itself, on a throwaway canvas: a WebGL 2 context and a float colour buffer extension, then the context is
 * freed at once with WEBGL_lose_context. Any throw reads as no support. Pure over its document, so it is testable.
 */
export function probeDocument(doc: ProbeDocument): boolean {
  try {
    const gl = doc.createElement("canvas").getContext("webgl2");
    if (gl === null) return false;
    const ok = FLOAT_BUFFER_EXTENSIONS.some((name) => gl.getExtension(name) !== null);
    const lose = gl.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null;
    lose?.loseContext?.();
    return ok;
  } catch {
    return false;
  }
}

/**
 * A probe memoised on first answer: the throwaway context is made at most once per page, however many engines
 * mount (the specimens page mounts many). Without a document (a server render) it answers false and memoises nothing.
 */
export function memoisedProbe(getDocument: () => ProbeDocument | null): () => boolean {
  let memo: boolean | null = null;
  return () => {
    if (memo !== null) return memo;
    const doc = getDocument();
    if (doc === null) return false;
    memo = probeDocument(doc);
    return memo;
  };
}

/** The page's one probe. */
export const probeWebGL2: () => boolean = memoisedProbe(() => (typeof document === "undefined" ? null : document));

/** The one dynamic import of the engine: a split point, so three.js and the engine land in their own chunk. */
export function loadEngine(): Promise<LoadedEngine> {
  return import("./three/engine");
}

interface YieldingScheduler {
  yield?: () => Promise<void>;
}

/**
 * Yields to the browser between build steps, so input, the voice client's tasks and a due paint run between them.
 * scheduler.yield() where the browser has it (the build keeps its place in the queue), otherwise a zero timeout.
 */
export function yieldToBrowser(): Promise<void> {
  const s = (globalThis as { scheduler?: YieldingScheduler }).scheduler;
  if (s !== undefined && typeof s.yield === "function") return s.yield.call(s);
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** The canvas layer's content box in CSS pixels, on every change. Without ResizeObserver it reports once. */
export function observeElementSize(el: HTMLElement, cb: (w: number, h: number) => void): () => void {
  if (typeof ResizeObserver === "undefined") {
    const r = el.getBoundingClientRect();
    cb(r.width, r.height);
    return () => {};
  }
  const ro = new ResizeObserver((entries) => {
    const last = entries[entries.length - 1];
    if (last !== undefined) cb(last.contentRect.width, last.contentRect.height);
  });
  ro.observe(el);
  return () => ro.disconnect();
}

/** The browser's dependencies. Nothing here touches a browser global until a method is called. */
export function browserThreeHost(): ThreeHostDeps {
  return {
    options: APP_ENGINE_OPTIONS,
    probeWebGL2,
    loadEngine,
    engineHost(audio, onEvent) {
      const clock = createBrowserClock();
      return {
        scheduler: browserScheduler(),
        visibility: browserVisibility(),
        mono: clock.mono,
        yieldNow: yieldToBrowser,
        audio,
        onEvent,
      };
    },
    observeSize: observeElementSize,
    budget: electricityBudget,
  };
}
