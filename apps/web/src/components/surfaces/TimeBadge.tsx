// The Time_Badge (lab-ui-foundation R16.1, R16.8, R16.12): a brass plate with a small bolt, reading
// "Simulated: Thu 6:00 PM". Rendered whenever the clock is simulated, and only then. The plate is the shared
// Plate part; the bolt is engraved into it in night-0, like the words.
import { COPY } from "../../ui/copy";
import { badgeTime } from "../../ui/format-time";
import type { TimeBadgeProps } from "../../ui/surface-props";
import { Plate } from "../lab/Plate";

export function TimeBadge({ simulated, instantMs, zone }: TimeBadgeProps) {
  if (!simulated || !Number.isFinite(instantMs)) return null;
  return (
    <p data-time-badge="" className="inline-flex shrink-0 whitespace-nowrap">
      <Plate>
        <span className="inline-flex items-center gap-1.5 py-0.5">
          <svg viewBox="0 0 12 16" aria-hidden="true" focusable="false" className="franki-badge-bolt h-3.5 w-2.5 shrink-0">
            <path d="M7.2 0.6 L1.4 9 H5.6 L4.2 15.4 L10.6 6.2 H6.5 Z" fill="currentColor" strokeLinejoin="round" />
          </svg>
          <span>{COPY.time.simulated}</span>
          <span>{badgeTime(instantMs, zone)}</span>
        </span>
      </Plate>
    </p>
  );
}
