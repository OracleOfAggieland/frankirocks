// The one polite live region (lab-ui-foundation R4.6, R18.5 to R18.8). The App writes one coalesced
// announcement per render. Each new announcement swaps between two child nodes, so a screen reader
// speaks a repeated message again.

export interface LiveRegionProps {
  message: string | null;
  /** Bumped for every new announcement, including a repeat of the last one. */
  seq: number;
}

export function LiveRegion({ message, seq }: LiveRegionProps) {
  return (
    <div aria-live="polite" aria-atomic="true" data-live-region="" className="sr-only">
      {message === null ? null : <span key={seq % 2 === 0 ? "a" : "b"} data-slot={seq % 2 === 0 ? "a" : "b"}>{message}</span>}
    </div>
  );
}
