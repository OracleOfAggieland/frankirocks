"use client";
// Captions (lab-ui-foundation R16.1, R16.9): one line of what Franki is saying now, fading out after
// it ends. No history. Off by default, with a "Captions" toggle.
import { COPY } from "../../ui/copy";
import type { CaptionsProps } from "../../ui/surface-props";
import { Materialize } from "../motion/Materialize";
import { FOCUS, TARGET } from "./classes";

/** The toggle: a quiet outline with a hollow dot while off; brass-lit with a filled dot while on. */
const TOGGLE = `${TARGET} ${FOCUS} inline-flex items-center justify-center gap-2 rounded-control border px-4 text-sm transition-colors duration-(--dur-quick)`;
const TOGGLE_OFF = "border-ink-dim text-ink-dim hover:bg-night-2 hover:text-ink";
const TOGGLE_ON = "border-brass bg-brass/15 text-brass-hi shadow-brass-glow hover:bg-brass/25";

export function Captions({ on = false, line, onToggle }: CaptionsProps) {
  return (
    <div data-captions={on ? "on" : "off"} className="flex w-full max-w-[343px] flex-col items-center gap-2 sm:max-w-xl">
      <button type="button" aria-pressed={on} onClick={onToggle} className={`${TOGGLE} ${on ? TOGGLE_ON : TOGGLE_OFF}`}>
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
