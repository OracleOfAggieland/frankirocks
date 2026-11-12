import type { CSSProperties, ReactNode } from "react";
import { FigLabel } from "../lab/FigLabel";
import { Backdrop } from "../screen/Backdrop";
import { FOCUS, TARGET } from "../surfaces/classes";

// The shared body of the 404 and error pages: the door backdrop, a blueprint drawing with its fig label,
// the title in display type, one line of plain text, and the actions. The column rises into place in
// order (drawing, title, text, actions), a plain fade under reduced motion; see system.css.
// The root layout renders the footer after this.

/** A brass action: something you can touch. Depresses 2 px on press. */
export const SYSTEM_BRASS = `${TARGET} ${FOCUS} mat-brass inline-flex items-center justify-center gap-2 rounded-control px-5 text-base font-medium transition-transform duration-(--dur-quick) ease-ecto active:translate-y-0.5`;

/** A quiet action: an ink-dim outline, no fill. */
export const SYSTEM_QUIET = `${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control border border-ink-dim px-5 text-base text-ink transition-colors duration-(--dur-quick) hover:bg-night-2`;

const order = (i: number) => ({ "--i": i }) as CSSProperties;

export function Room({
  kind,
  drawing,
  fig,
  title,
  body,
  actions,
}: {
  kind: "not-found" | "error";
  drawing: ReactNode;
  fig: { n: string; label: string };
  title: ReactNode;
  body: string;
  actions: ReactNode;
}) {
  return (
    <main data-system={kind} className="relative flex flex-1 flex-col items-center justify-center px-6 pt-16 pb-12 sm:pt-24 sm:pb-16">
      <Backdrop variant="door" />
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <figure aria-hidden="true" className="sys-rise w-full max-w-80" style={order(0)}>
          {drawing}
          <figcaption className="mt-3 flex justify-center">
            <FigLabel n={fig.n}>{fig.label}</FigLabel>
          </figcaption>
        </figure>
        {/* On the error page the title and text are an alert, so a screen reader announces the swap. */}
        <div role={kind === "error" ? "alert" : undefined} className="flex flex-col items-center">
          <h1 className="sys-rise mt-10 font-display text-title font-normal text-balance text-ink" style={order(1)}>
            {title}
          </h1>
          <p className="sys-rise mt-4 max-w-md text-base text-pretty text-ink-dim" style={order(2)}>
            {body}
          </p>
        </div>
        <div className="sys-rise mt-8 flex flex-wrap items-center justify-center gap-3" style={order(3)}>
          {actions}
        </div>
      </div>
    </main>
  );
}
