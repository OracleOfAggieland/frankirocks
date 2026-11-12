/**
 * Every name the browser's half of the visit uses that the seed lane (briefs 019 and 023) had not fixed when brief
 * 027 was built. Each is a guess at the contract (contracts §6 Routes, `POST /api/seed/reset` and `advance`), kept
 * in this one file so the merge with the seed lane changes one place. Brief 027's report lists them.
 */

/** The route paths, as contracts §6 names the routes. */
export const RESET_PATH = "/api/seed/reset";
export const ADVANCE_PATH = "/api/seed/advance";

/** The one persona's fixture ID, in the contract's 43-character ID shape. Guessed: the seed lane names its persona. */
export const PERSONA_FIXTURE_ID = `persona${"_".repeat(36)}`;

/**
 * Where the browser keeps the visit, one entry per signed-in user, so a reload keeps the same month (spec §15,
 * "keyed to a stored visit ID"). localStorage, so it lives as long as the browser profile.
 */
export const VISIT_STORAGE_PREFIX = "franki.visit.";

/** The reset's budget is 5 s plus progress (contracts §6); the client waits a little longer. */
export const RESET_TIMEOUT_MS = 8_000;
/** The advance's budget is 2 s (contracts §6); the client waits a little longer. */
export const ADVANCE_TIMEOUT_MS = 4_000;

/** The barrier answer: HTTP 423 (contracts §6, "barrier423"), or the ErrorCode BARRIER on another status. */
export const BARRIER_STATUS = 423;
/** How long the bolt waits after a barrier answer that carries no `retryAfterMs`. */
export const BARRIER_WAIT_MS = 2_000;
