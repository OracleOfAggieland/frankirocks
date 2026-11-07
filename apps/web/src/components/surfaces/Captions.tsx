"use client";
// Captions (lab-ui-foundation R16.1, R16.9): one line of what Franki is saying now, fading out after
// it ends. No history. Off by default, with a "Captions" toggle.
import { COPY } from "../../ui/copy";
import type { CaptionsProps } from "../../ui/surface-props";
import { Materialize } from "../motion/Materialize";
import { QUIET_BUTTON } from "./classes";

export function Captions({ on = false, line, onToggle }: CaptionsProps) {
  return (
    <div data-captions={on ? "on" : "off"} className="flex w-full max-w-[343px] flex-col items-center gap-2 sm:max-w-xl">
      <button type="button" aria-pressed={on} onClick={onToggle} className={`${QUIET_BUTTON} text-sm`}>
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
