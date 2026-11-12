"use client";
// Whether the lab spider can run here, and whether it is switched on. It runs only with a hovering, fine
// pointer, motion allowed, no forced colours, and the toggle on. The server snapshot says no, so nothing renders on the server.
import { useSyncExternalStore } from "react";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { SPIDER_KEY, readSpiderOn, writeSpiderOn } from "../../ui/cursor/preference";

/** Forced colours keep the native cursor (see cursor.css), so the spider stays off there too. */
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine) and (forced-colors: none)";

let fine: MediaQueryList | null | undefined;
function fineQuery(): MediaQueryList | null {
  if (fine === undefined) fine = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(FINE_POINTER_QUERY) : null;
  return fine;
}
const subscribeFine = (listener: () => void) => {
  const q = fineQuery();
  q?.addEventListener("change", listener);
  return () => q?.removeEventListener("change", listener);
};
const fineSnapshot = () => fineQuery()?.matches ?? false;
const no = () => false;

export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribeFine, fineSnapshot, no);
}

/** True when this device and setting can show the spider (whatever the toggle says). */
export function useSpiderCanRun(): boolean {
  const finePointer = useFinePointer();
  const reduced = useReducedMotion();
  return finePointer && !reduced;
}

// One shared value for the toggle and the spider, kept in step across tabs through the storage event.
const listeners = new Set<() => void>();
let cached: boolean | null = null;
const onStorage = (e: StorageEvent) => {
  if (e.key !== SPIDER_KEY) return;
  cached = null;
  listeners.forEach((l) => l());
};
const subscribeOn = (listener: () => void) => {
  if (listeners.size === 0 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
};
const onSnapshot = () => {
  if (cached === null) cached = readSpiderOn();
  return cached;
};
const yes = () => true;

export function useSpiderOn(): boolean {
  return useSyncExternalStore(subscribeOn, onSnapshot, yes);
}

export function setSpiderOn(on: boolean): void {
  cached = on;
  writeSpiderOn(on);
  listeners.forEach((l) => l());
}
