"use client";
// Forget last (brief 015 K; UI direction "Surfaces"): a quiet capsule, "Forget last thing", with a small
// glyph of a mote coming apart. It renders nothing while there is nothing to forget, rises in when there
// is, and leaves the way forgotten things leave. While a forget is pending it is disabled and a lamp
// takes the glyph's place; the pending state is also said once in a status region beside the button.
// When it goes away, whoever mounts it moves keyboard focus somewhere that stays (this file cannot).
import { useIsPresent } from "motion/react";
import { COPY } from "../../ui/copy";
import { Lamp } from "../lab/Lamp";
import { Materialize } from "../motion/Materialize";
import { FOCUS, TARGET } from "./classes";

export interface ForgetLastProps {
  available: boolean;
  pending?: boolean;
  onForget(): void;
}


const CAPSULE = `${TARGET} ${FOCUS} group franki-forget inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-chip border border-ink-dim px-4 text-sm text-ink-dim transition-colors duration-(--dur-quick) not-aria-disabled:hover:bg-night-2 not-aria-disabled:hover:text-ink not-aria-disabled:focus-visible:text-ink aria-disabled:cursor-default`;

/** A mote whose outline has broken open at the top right, three bits drifting off and growing faint. */
export function MoteGlyph() {
  return (
    <svg data-glyph="mote" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" className="pointer-events-none shrink-0">
      <path
        d="M12.85 13.34A4.5 4.5 0 1 1 9.66 10.15"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <g fill="currentColor">
        <circle className="franki-mote-bit" cx="13.7" cy="9.3" r="1.1" />
        <circle className="franki-mote-bit" cx="16.9" cy="6.5" r="0.85" opacity="0.72" />
        <circle className="franki-mote-bit" cx="19.9" cy="4.1" r="0.6" opacity="0.45" />
      </g>
    </svg>
  );
}

export function ForgetLast({ available, pending = false, onForget }: ForgetLastProps) {
  return (
    <Materialize show={available} itemKey="forget-last" className="inline-flex">
      <ForgetLastButton pending={pending} onForget={onForget} />
    </Materialize>
  );
}

/**
 * The button itself. It stops answering presses while a forget is pending and while it is leaving (it stays
 * on screen for the exit after `available` turns false). It uses aria-disabled rather than disabled, so a
 * button that has keyboard focus keeps it.
 */
export function ForgetLastButton({ pending, onForget }: { pending: boolean; onForget(): void }) {
  const present = useIsPresent();
  const inert = pending || !present;
  return (
    <span data-forget-last={pending ? "pending" : "ready"} className="inline-flex items-center">
      <button
        type="button"
        aria-disabled={inert || undefined}
        aria-busy={pending || undefined}
        onClick={inert ? undefined : onForget}
        className={CAPSULE}
      >
        <span aria-hidden="true" className="inline-flex size-[18px] shrink-0 items-center justify-center">
          {pending ? (
            <span className="franki-forget-lamp inline-flex">
              <Lamp on />
            </span>
          ) : (
            <MoteGlyph />
          )}
        </span>
        {COPY.forgetLast}
      </button>
      <span role="status" className="sr-only">
        {pending ? COPY.forgetLastPending : ""}
      </span>
    </span>
  );
}
