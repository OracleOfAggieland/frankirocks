/**
 * Brief 049 part A: every word about an errand that code says (rulings 3, 9, 10, 12 and 13). Each is S0 and carries
 * no owner words, no name and nothing an errand found. The found lines themselves are the helper's, checked by code
 * (`checkErrandResult`) and attributed by code (`errandAttribution`).
 */
import type { ErrandAbout, ErrandStartState } from "./limits";

/** "your mail", "your calendar", "your mail and calendar". */
export function aboutPhrase(about: readonly ErrandAbout[]): string {
  const has = (a: ErrandAbout) => about.includes(a);
  return has("mail") && has("calendar") ? "your mail and calendar" : has("calendar") ? "your calendar" : "your mail";
}

/**
 * The note `start_errand` answers with (ruling 3). The model reads it and words one short neutral sentence; it never
 * implies success or failure (OpenAI's guidance for the filler before a tool's result).
 */
export function errandStartNote(state: ErrandStartState, about: readonly ErrandAbout[]): string {
  const what = aboutPhrase(about);
  switch (state) {
    case "started":
      return `A helper is now looking through ${what} for what the owner asked. Say one short, neutral sentence, such as "Let me look.", and nothing about what it might find. The answer comes later on its own; never guess it, and don't start another look-up for the same thing.`;
    case "notConnected":
      return `${capital(what)} is not connected, so nothing can be looked up there. Say so in one short sentence, and never guess what it holds.`;
    case "busy":
      return "Two look-ups are already running. Say in one short sentence that you'll look once one of them is done, and never guess what they will find.";
    case "unavailable":
      return `Looking through ${what} isn't available right now. Say so in one short sentence, and never guess what it holds.`;
    case "stale":
      return "That request is no longer current. Say nothing about it.";
    default:
      state satisfies never;
      return "";
  }
}

/**
 * Ruling 12: the note a later turn's reply carries while an errand of this Session runs, so the model neither starts
 * a second one nor guesses.
 */
export function errandRunningNote(about: readonly ErrandAbout[]): string {
  return `A look-up through ${aboutPhrase(about)} that you started for the owner is still running. Don't start another one for the same thing, and never guess what it will find: the answer comes when it is ready.`;
}

/** Said before the found lines when the result is said in full (ruling 9). */
export const ERRAND_FOUND_LEAD = "Found it.";
/** Said when the helper answered `nothing`. */
export function errandNothingLine(about: readonly ErrandAbout[]): string {
  return `I looked through ${aboutPhrase(about)} and didn't find anything on that.`;
}
/** Ruling 13: a failed run, said plainly, once. */
export function errandFailedLine(about: readonly ErrandAbout[]): string {
  return `I couldn't get to ${aboutPhrase(about)} just now.`;
}
/** Ruling 10: nothing could be said here, and something is on the card. */
export const ERRAND_ON_SCREEN_LINE = "I found something. It's on your screen.";
/** Ruling 10: some lines were said, and the rest is on the card. */
export const ERRAND_REST_ON_SCREEN_LINE = "The rest is on your screen.";
/**
 * Review fix T4: one card line on any run whose planner was shown a message or an invite from someone the owner
 * hasn't written to. Code-worded, S0, and names nobody.
 */
export const ERRAND_UNMAILED_MARKER = "While looking this up, I read messages or invites from people you haven't written to.";
/** Ruling 10: the result is held, and nothing of it is shown here. */
export const ERRAND_HELD_LINE = "I found something, but I can't go into it right now.";

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
