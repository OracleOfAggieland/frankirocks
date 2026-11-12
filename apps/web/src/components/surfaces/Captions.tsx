"use client";
// Captions (lab-ui-foundation R16.1, R16.9): one line of what Franki is saying now, fading out after
// it ends. No history. Off by default, with a "Captions" toggle.
import { COPY } from "../../ui/copy";
import type { CaptionsProps } from "../../ui/surface-props";
import { Materialize } from "../motion/Materialize";
import { FOCUS, QUIET_BUTTON, TARGET } from "./classes";

/**
 * The toggle, on the shared recipes. Off, it is the quiet button with a hollow dot. On, it keeps the quiet
 * button's shape (target, focus ring, radius, padding, type) and is lit brass with a filled dot, and it
 * depresses 2 px on press like every brass control.
 */
const TOGGLE_OFF = `${QUIET_BUTTON} gap-2`;
const TOGGLE_ON = `${TARGET} ${FOCUS} franki-card-press inline-flex items-center justify-center gap-2 rounded-control border border-brass bg-brass/15 px-4 text-base text-brass-hi shadow-brass-glow hover:bg-brass/25`;

export function Captions({ on = false, line, onToggle }: CaptionsProps) {
  return (
    <div data-captions={on ? "on" : "off"} className="flex w-full max-w-[343px] flex-col items-center gap-2 sm:max-w-xl">
      <button type="button" aria-pressed={on} onClick={onToggle} className={on ? TOGGLE_ON : TOGGLE_OFF}>
        <span
          aria-hidden="true"
          data-toggle-dot={on ? "on" : "off"}
          className={`h-2 w-2 rounded-full border transition-colors duration-(--dur-quick) ${on ? "border-brass-hi bg-brass-hi" : "border-ink-dim"}`}
        />
        {COPY.captions.toggle}
      </button>
      <div aria-live="off" className="min-h-6 w-full text-center">
        <Materialize show={on && line !== null && line.text.trim() !== ""} itemKey={line?.id ?? "none"}>
          <p data-caption-line="" className="truncate text-base text-ink">
            {line?.text}
          </p>
        </Materialize>
      </div>
    </div>
  );
}
