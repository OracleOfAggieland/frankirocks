// The Time_Badge (lab-ui-foundation R16.1, R16.8, R16.12): a brass badge with a small bolt, reading
// "Simulated: Thu 6:00 PM". Rendered whenever the clock is simulated, and only then.
import { COPY } from "../../ui/copy";
import { badgeTime } from "../../ui/format-time";
import type { TimeBadgeProps } from "../../ui/surface-props";

export function TimeBadge({ simulated, instantMs, zone }: TimeBadgeProps) {
  if (!simulated || !Number.isFinite(instantMs)) return null;
  return (
    <p data-time-badge="" className="inline-flex items-center gap-1.5 rounded-chip border border-brass px-3 py-1 text-sm text-brass">
      <svg viewBox="0 0 12 16" aria-hidden="true" focusable="false" className="h-3.5 w-2.5">
        <path d="M7 0 L1 9 H5.5 L4 16 L11 6 H6.5 Z" fill="var(--color-gold)" />
      </svg>
      <span>{COPY.time.simulated}</span>
      <span className="font-mono">{badgeTime(instantMs, zone)}</span>
    </p>
  );
}
