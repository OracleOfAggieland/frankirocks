"use client";
// Page visibility (lab-ui-foundation R10.7). While hidden, the frame loop, Electricity and the
// Level_Meter pause; they resume when visible.
import { useSyncExternalStore } from "react";

export interface DocumentLike {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export class VisibilityGate {
  private readonly listeners = new Set<(visible: boolean) => void>();
  private readonly onChange = () => {
    const v = this.isVisible();
    this.listeners.forEach((l) => l(v));
  };

  constructor(private readonly doc: DocumentLike | null) {}

  isVisible = (): boolean => this.doc === null || this.doc.visibilityState !== "hidden";

  subscribe = (listener: (visible: boolean) => void): (() => void) => {
    if (this.listeners.size === 0) this.doc?.addEventListener("visibilitychange", this.onChange);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.doc?.removeEventListener("visibilitychange", this.onChange);
    };
  };
}

let shared: VisibilityGate | null = null;

export function browserVisibility(): VisibilityGate {
  if (shared === null) shared = new VisibilityGate(typeof document === "undefined" ? null : document);
  return shared;
}

const serverVisible = () => true;

export function usePageVisible(gate?: VisibilityGate): boolean {
  const g = gate ?? browserVisibility();
  return useSyncExternalStore(g.subscribe, g.isVisible, serverVisible);
}
