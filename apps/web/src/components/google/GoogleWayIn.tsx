"use client";
// The way in to the Google sheet (brief 049 part B): one small brass-edged control beside the bank's. It opens the
// sheet; the lamp is lit only once the server has answered that mail or calendar is being read.
import type { GoogleView } from "@franki/core";
import { COPY } from "../../ui/copy";
import { Lamp } from "../lab/Lamp";
import { FOCUS, TARGET } from "../surfaces/classes";

export interface GoogleWayInProps {
  /** The connection the server last answered, or null before any answer. */
  google: GoogleView | null;
  open: boolean;
  disabled?: boolean;
  onOpen: () => void;
}

/** True when the server has answered that mail or calendar is being read. */
export function googleLit(g: GoogleView | null): boolean {
  return g !== null && !g.needsReconnect && (g.mail === "connected" || g.calendar === "connected");
}

export function GoogleWayIn({ google, open, disabled = false, onOpen }: GoogleWayInProps) {
  return (
    <button
      type="button"
      data-google-way-in=""
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
      onClick={onOpen}
      className={`${TARGET} ${FOCUS} inline-flex items-center justify-center gap-2 rounded-chip border border-brass/70 px-4 text-sm text-brass transition-colors duration-(--dur-quick) hover:border-brass hover:bg-brass/10 hover:text-brass-hi disabled:opacity-40`}
    >
      {googleLit(google) ? <Lamp on words={COPY.google.lamp} /> : null}
      {COPY.google.open}
    </button>
  );
}
