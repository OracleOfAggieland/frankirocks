// The brass safety seal with a lock (lab-ui-foundation R15.5). Marks a hard rule wherever it appears.
// An embossed brass disc, 24 px: the disc is mat-brass cut to a scalloped edge (cards.css), with a ring
// pressed in 3.5 px from the edge and the lock struck in the middle. The disc, ring and lock are decorative;
// the seal's name is its label.
import { COPY } from "../../ui/copy";

export function Seal({ label = COPY.card.lockedRule }: { label?: string }) {
  return (
    <span role="img" aria-label={label} data-seal="" className="franki-seal relative inline-flex size-6 shrink-0 items-center justify-center text-night-0">
      <span aria-hidden="true" data-seal-part="disc" className="franki-seal-disc mat-brass pointer-events-none absolute inset-0" />
      <span
        aria-hidden="true"
        data-seal-part="ring"
        className="franki-seal-ring pointer-events-none absolute inset-[3.5px] rounded-full border border-night-0/30"
      />
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" data-seal-part="lock" className="franki-seal-lock relative size-3">
        <path d="M5.25 7.25 V5.25 a2.75 2.75 0 0 1 5.5 0 V7.25" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <rect x="3.5" y="7" width="9" height="7.25" rx="1.6" fill="currentColor" />
        <circle cx="8" cy="10.25" r="1.1" fill="var(--color-brass)" />
      </svg>
    </span>
  );
}
