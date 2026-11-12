// Whether a watched part of a front-door section has entered view (brief 015, package I). Pure: the hook in
// components/landing/use-seen.ts feeds it each IntersectionObserver report.
// "static": no report yet (the server, or scripting off), so the part is drawn in full.
// "waiting": the first report found it out of view, so it hides until it enters.
// "seen": it was in view on the first report, or `threshold` of it has shown since. Seen is never undone.

export type Seen = "static" | "waiting" | "seen";

export interface SeenReport {
  /** True for the first report about this part. */
  readonly first: boolean;
  readonly isIntersecting: boolean;
  /** The share of the part in view, 0 to 1. */
  readonly ratio: number;
}

/** The part's next state after a report, given its state before (undefined: never reported). */
export function nextSeen(prev: Seen | undefined, report: SeenReport, threshold: number): Seen {
  if (prev === "seen") return "seen";
  if (report.isIntersecting && (report.first || report.ratio >= threshold)) return "seen";
  if (report.first) return "waiting";
  return prev ?? "waiting";
}
