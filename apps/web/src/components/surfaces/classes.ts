// Shared token class strings for Surfaces and controls (lab-ui-foundation R18.2, R18.3).
// Every control has a 44 px minimum target and a visible focus ring.

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-hi";
export const TARGET = "min-h-11 min-w-11";

/** Quiet: a secondary action with an ink-dim boundary. */
export const QUIET_BUTTON = `${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control border border-ink-dim px-4 text-base text-ink transition-colors duration-(--dur-quick) hover:bg-night-2 disabled:opacity-40`;

/**
 * A source tag (Brief 004 item 3): a quiet chip. The button keeps the 44 px target; the visible chip
 * inside it is Geist Mono 12 px in ink-dim with a thin ink-dim outline (3:1 against the Card), and
 * both turn brass on hover and keyboard focus.
 */
export const SOURCE_TAG = `${TARGET} ${FOCUS} group inline-flex items-center rounded-chip font-mono text-xs text-ink-dim transition-colors duration-(--dur-quick) hover:text-brass focus-visible:text-brass`;

/** The visible chip inside a SOURCE_TAG button. */
export const SOURCE_TAG_CHIP = "rounded-chip border border-ink-dim px-2 py-0.5 transition-colors duration-(--dur-quick) group-hover:border-brass group-focus-visible:border-brass";
