"use client";
// Reduced_Motion (lab-ui-foundation R9.4, R20.2). A watcher over `prefers-reduced-motion: reduce`, a
// hook on useSyncExternalStore whose server snapshot is true (calm first paint, no hydration
// mismatch), and an override context so a specimen can force it on.
import { createContext, createElement, type ReactNode, useContext, useSyncExternalStore } from "react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface MediaQueryLike {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

export class ReducedMotionWatcher {
  private readonly listeners = new Set<() => void>();
  private readonly onChange = () => this.listeners.forEach((l) => l());

  /** With no media query (no `matchMedia`), Reduced_Motion stays on. */
  constructor(private readonly query: MediaQueryLike | null) {}

  getSnapshot = (): boolean => (this.query === null ? true : this.query.matches);

  subscribe = (listener: () => void): (() => void) => {
    if (this.listeners.size === 0) this.query?.addEventListener("change", this.onChange);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.query?.removeEventListener("change", this.onChange);
    };
  };
}

let shared: ReducedMotionWatcher | null = null;

/** The Visit's watcher over the browser's media query. */
export function browserWatcher(): ReducedMotionWatcher {
  if (shared === null) {
    const mql = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
    shared = new ReducedMotionWatcher(mql);
  }
  return shared;
}

const serverSnapshot = () => true;

/** `true` forces Reduced_Motion on for everything inside; `null` follows the user's setting. */
export const ReducedMotionContext = createContext<boolean | null>(null);

export function ReducedMotionOverride({ reduced, children }: { reduced: boolean; children?: ReactNode }) {
  return createElement(ReducedMotionContext.Provider, { value: reduced }, children);
}

export function useReducedMotion(watcher?: ReducedMotionWatcher): boolean {
  const forced = useContext(ReducedMotionContext);
  const w = watcher ?? browserWatcher();
  const live = useSyncExternalStore(w.subscribe, w.getSnapshot, serverSnapshot);
  return forced ?? live;
}
