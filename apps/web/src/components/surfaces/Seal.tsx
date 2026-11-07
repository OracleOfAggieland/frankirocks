// The brass safety seal with a lock (lab-ui-foundation R15.5). Marks a hard rule wherever it appears.
import { COPY } from "../../ui/copy";

export function Seal({ label = COPY.card.lockedRule }: { label?: string }) {
  return (
    <span role="img" aria-label={label} data-seal="" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brass text-night-0 shadow-brass-glow">
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-3.5 w-3.5">
        <rect x="3.5" y="7" width="9" height="7" rx="1.5" fill="currentColor" />
        <path d="M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </span>
  );
}
