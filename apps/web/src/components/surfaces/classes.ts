// Shared token class strings for Surfaces and controls (lab-ui-foundation R18.2, R18.3).
// Every control has a 44 px minimum target and a visible focus ring.

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-hi";
export const TARGET = "min-h-11 min-w-11";

/** Brass, primary: something you can touch. */
export const BRASS_BUTTON = `${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control bg-brass px-4 text-base font-medium text-night-0 shadow-brass-glow transition-transform duration-(--dur-quick) active:translate-y-0.5 disabled:opacity-40`;

/** Quiet: a secondary action with an ink-dim boundary. */
export const QUIET_BUTTON = `${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control border border-ink-dim px-4 text-base text-ink transition-colors duration-(--dur-quick) hover:bg-night-2 disabled:opacity-40`;

/** A source tag: mono figures, brass boundary. */
export const SOURCE_TAG = `${TARGET} ${FOCUS} inline-flex items-center rounded-chip border border-brass px-3 font-mono text-sm text-brass hover:bg-night-1`;

/** A glass panel. */
export const GLASS = "rounded-card bg-night-2/90 shadow-card backdrop-blur-sm";
