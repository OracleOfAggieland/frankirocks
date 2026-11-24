/**
 * Every name the browser's half of the visit uses that the seed lane (briefs 019 and 023) had not fixed when brief
 * 027 was built. Each is a guess at the contract (contracts §6 Routes, `POST /api/seed/reset` and `advance`), kept
 * in this one file so the merge with the seed lane changes one place. Brief 027's report lists them.
 */

/** The route paths, as contracts §6 names the routes. */
export const RESET_PATH = "/api/seed/reset";
export const ADVANCE_PATH = "/api/seed/advance";

/**
 * The one persona's fixture ID. No longer a guess: it is the seed's own ID (`packages/server/src/seed/persona`),
 * and `scripts/persona-fixture-id.test.ts` fails if the two ever differ.
 */
export const PERSONA_FIXTURE_ID = "seed-persona-riley-v1-000000000000000000000";

/**
 * Where the browser keeps the visit, one entry per signed-in user, so a reload keeps the same month (spec §15,
 * "keyed to a stored visit ID"). localStorage, so it lives as long as the browser profile.
 */
export const VISIT_STORAGE_PREFIX = "franki.visit.";

/**
 * The reset's budget is 5 s plus progress (contracts §6), but real resets take 6 to 8 s: the deployed site's logs
 * show 6.1 s and 7.9 s (Nov 19 and 21), and a local one took 7.8 s (Nov 24). At 8 s the browser gave up on a reset
 * the server went on to finish, and the first load of a visit failed. The browser now waits well past the slowest
 * seen; "Setting up your month" shows meanwhile.
 */
export const RESET_TIMEOUT_MS = 20_000;
/** The advance's budget is 2 s (contracts §6); the client waits a little longer. */
export const ADVANCE_TIMEOUT_MS = 4_000;

/** The barrier answer: HTTP 423 (contracts §6, "barrier423"), or the ErrorCode BARRIER on another status. */
export const BARRIER_STATUS = 423;
