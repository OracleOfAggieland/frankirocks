/**
 * Brief 049 part A: an errand's closed sets and every limit, each a named constant (ruling 5). Pure: no I/O, no clock.
 *
 * An errand is a job the live call hands to a helper on the server. The talking model calls `start_errand` with only
 * what it is about; the server reads the assignment from the owner's own committed turns, runs a bounded helper loop
 * as a leased Job, and says the result later, once, at a pause.
 */

/** What an errand may be about (ruling 1). The framework knows the names only; an agent supplies the tools. */
export const ERRAND_ABOUT = ["mail", "calendar"] as const;
export type ErrandAbout = (typeof ERRAND_ABOUT)[number];

/** How `start_errand` answers at once (ruling 3). `stale`: the turn it was asked on is no longer current. */
export const ERRAND_START_STATES = ["started", "notConnected", "busy", "unavailable", "stale"] as const;
export type ErrandStartState = (typeof ERRAND_START_STATES)[number];
/** Review fix E11: an asked-for part that can't be looked up, and why, for the start's note. */
export interface ErrandMissing {
  about: ErrandAbout;
  why: "notConnected" | "expired" | "unavailable";
}

/** The planner's last output (ruling 8). */
export const ERRAND_OUTCOMES = ["answered", "nothing", "failed"] as const;
export type ErrandOutcome = (typeof ERRAND_OUTCOMES)[number];

/**
 * Review fix T8: an outcome with no citeable line that code words, not the planner. `needsDay`: a time phrase code
 * couldn't place and nothing was read; `partial`: part of what was asked couldn't be read; `unmailed`: what was found
 * is only from people the owner hasn't written to; `expired`: the grant needs connecting again.
 */
export const ERRAND_NOTICES = ["needsDay", "partial", "unmailed", "expired"] as const;
export type ErrandNotice = (typeof ERRAND_NOTICES)[number];

/** At most this many of the owner's committed turns make the assignment, newest last (ruling 2). */
export const ERRAND_ASSIGNMENT_TURNS = 4;
/** At most this many errands run at once per owner; one more answers `busy` (ruling 7). */
export const ERRAND_RUNNING_MAX = 2;
/** A result nobody has heard is dropped to card-only this long after it is ready (ruling 7). */
export const ERRAND_RESULT_TTL_MS = 5 * 60_000;
/** The call must have been quiet this long before a result is offered (ruling 9). */
export const ERRAND_SILENCE_MS = 2_000;
/** A card stays offered on the state poll this long after its result was ready. */
export const ERRAND_CARD_KEEP_MS = 30 * 60_000;

/*
 * Owner ruling, Nov 19 (lane mail-limits): no time limit ends a working run. The 40 s wall clock and the per-call
 * timeouts of ruling 5 are gone; what is left are runaway guards on counts, so a broken loop still ends, and the
 * stuck-run guard below, so a call that never answers can't hold an Errand `running` for good.
 */
/** Model calls one run makes at most: a runaway guard, far above any real ask (ruling 5 had 6). */
export const ERRAND_MODEL_CALLS_MAX = 24;
/** Tool calls one run makes at most: a runaway guard, far above any real ask (ruling 5 had 10). */
export const ERRAND_TOOL_CALLS_MAX = 64;
/** The run's lease (ruling 4). Renewed at each step and every `ERRAND_LEASE_RENEW_MS` while a step works. */
export const ERRAND_LEASE_MS = 20_000;
/** How often a working run renews its lease, so a slow call never lets it lapse and a second runner start. */
export const ERRAND_LEASE_RENEW_MS = 5_000;
/**
 * A run still going this long after its Errand started is stuck, not slow: it is stopped, ends `failed`, and its
 * lease is no longer renewed. Cloud Run ends the request that runs it at 300 s anyway (`errands/hand-off.ts`).
 */
export const ERRAND_STUCK_MS = 5 * 60_000;
/** Claims of one run: the second after a lapsed lease starts again from nothing; a third never runs (ruling 4). */
export const ERRAND_RUNS_MAX = 2;

/** The planner's result: at most this many lines, each at most this many characters (ruling 8). */
export const ERRAND_LINES_MAX = 3;
export const ERRAND_LINE_CHARS = 200;
/** Refs one line may rest on, and Evidence one run may read. */
export const ERRAND_LINE_REFS_MAX = 8;
export const ERRAND_READS_MAX = 32;
/** A ref the framework hands a tool for one read: `r1` to `r32`. */
export const ERRAND_REF_PATTERN = /^r[1-9]\d?$/;
/** A tool's output, serialized, is cut to this many characters before the planner sees it. */
export const ERRAND_TOOL_OUTPUT_CHARS = 8_000;
/** Output items one model call may hand back to the next (function calls and reasoning). */
export const ERRAND_OUTPUT_ITEMS_MAX = 24;
/** Labels on a card: a sender or a title, and a subject. */
export const ERRAND_LABEL_CHARS = 120;

/**
 * Review fix R12: how long an Errand row may hold what it found, from its start: the longest run (two claims), the
 * time a result waits to be said, and the card window. At `finish` it is set again from `readyAt`
 * (`ERRAND_RESULT_TTL_MS + ERRAND_CARD_KEEP_MS`). Past it the row is stripped bare.
 */
/**
 * Review fix R4: the longest a run can last, both claims: a running Errand older than this is stranded. Every claim
 * stops at `ERRAND_STUCK_MS` from the Errand's start, and its lease lapses at most `ERRAND_LEASE_MS` later.
 */
export const ERRAND_RUN_SPAN_MS = ERRAND_STUCK_MS + ERRAND_LEASE_MS;
export const ERRAND_RETAIN_MS = ERRAND_RUN_SPAN_MS + ERRAND_RESULT_TTL_MS + ERRAND_CARD_KEEP_MS;

/** Review fix V2: one offer of a waiting result lives this long; offered again only after it, with no receipt. */
export const ERRAND_OFFER_MS = 10_000;
