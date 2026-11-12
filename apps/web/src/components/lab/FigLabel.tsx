import type { ReactNode } from "react";

// A fig label: a mono 12 px blueprint annotation with a leader line. The leader is stitch linework and
// decorative; the words are ink-dim, since stitch is never text that must be read. `side` is where the
// leader runs from the words.
export const FIG = "FIG.";

export function FigLabel({ n, children, side = "left" }: { n: string; children: ReactNode; side?: "left" | "right" }) {
  const leader = <span aria-hidden="true" data-fig-leader="" className="pointer-events-none inline-block h-px w-6 shrink-0 bg-stitch" />;
  return (
    <span data-fig={n} className="inline-flex items-center gap-2 font-mono text-xs text-ink-dim">
      {side === "left" ? leader : null}
      <span>
        {FIG} {n} <span aria-hidden="true">·</span> {children}
      </span>
      {side === "right" ? leader : null}
    </span>
  );
}
