// Chips (lab-ui-foundation R16.1, R16.10, R16.12): glass capsules with a stitched inner outline. A tap
// counts as the user's words. The boundary is brass, since a chip is something you can touch; the stitch inside
// it is decorative only. Chips rise into place one after another on STAGGER; under a hovering pointer or
// keyboard focus the stitches run; a press settles the chip 3% smaller on spring.press. All of that is CSS in
// cards.css, so it stops under reduced motion and pauses in a hidden tab.
import type { CSSProperties } from "react";
import type { ChipsProps } from "../../ui/surface-props";
import { FOCUS, TARGET } from "./classes";

/** The stitched outline sits 4 px inside the chip; at the 44 px target that is a 36 px capsule, radius 18. */
const STITCH_RADIUS = 18;

export function Chips({ chips, disabled, onChip }: ChipsProps) {
  if (chips.length === 0) return null;
  return (
    <ul data-chips="" className="flex w-full max-w-[343px] flex-wrap justify-center gap-2 sm:max-w-xl">
      {chips.map((text, i) => (
        <li key={text} className="franki-chip-enter" style={{ "--chip": i } as CSSProperties}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChip(text)}
            className={`${TARGET} ${FOCUS} franki-chip mat-glass relative rounded-chip border-brass! px-4 text-sm text-ink hover:bg-night-2/90 disabled:opacity-40`}
          >
            <span aria-hidden="true" data-stitch="" className="pointer-events-none absolute inset-1">
              <svg focusable="false" className="block size-full overflow-visible" width="100%" height="100%">
                <rect
                  className="franki-chip-stitch"
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                  rx={STITCH_RADIUS}
                  fill="none"
                  stroke="var(--color-stitch)"
                  strokeWidth="1"
                  strokeDasharray="5 4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="relative">{text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
