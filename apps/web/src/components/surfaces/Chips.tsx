// Chips (lab-ui-foundation R16.1, R16.10, R16.12): glass capsules with a stitched outline. A tap
// counts as the user's words. The boundary is brass; the stitch inside it is decorative only.
import type { ChipsProps } from "../../ui/surface-props";
import { FOCUS, TARGET } from "./classes";

export function Chips({ chips, disabled, onChip }: ChipsProps) {
  if (chips.length === 0) return null;
  return (
    <ul data-chips="" className="flex w-full max-w-[343px] flex-wrap justify-center gap-2 sm:max-w-xl">
      {chips.map((text) => (
        <li key={text}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChip(text)}
            className={`${TARGET} ${FOCUS} relative rounded-chip border border-brass bg-night-1/70 px-4 text-sm text-ink backdrop-blur-sm transition-colors duration-(--dur-quick) hover:bg-night-2 disabled:opacity-40`}
          >
            <span aria-hidden="true" className="pointer-events-none absolute inset-1 rounded-chip border border-dashed border-stitch" />
            <span className="relative">{text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
