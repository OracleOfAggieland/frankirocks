/**
 * Brief 049 part A: every word about an errand that code says (rulings 3, 9, 10, 12 and 13). Each is S0 and carries
 * no owner words, no name and nothing an errand found. The found lines themselves are the helper's, checked by code
 * (`checkErrandResult`) and attributed by code (`errandAttribution`).
 */
import type { ErrandAbout, ErrandMissing, ErrandNotice, ErrandStartState } from "./limits";

/** "your mail", "your calendar", "your mail and calendar". */
export function aboutPhrase(about: readonly ErrandAbout[]): string {
  const has = (a: ErrandAbout) => about.includes(a);
  return has("mail") && has("calendar") ? "your mail and calendar" : has("calendar") ? "your calendar" : "your mail";
}

/**
 * The note `start_errand` answers with (ruling 3). The model reads it and words one short neutral sentence; it never
 * implies success or failure (OpenAI's guidance for the filler before a tool's result).
 */
export function errandStartNote(state: ErrandStartState, about: readonly ErrandAbout[], missing: readonly ErrandMissing[] = []): string {
  const what = aboutPhrase(about);
  switch (state) {
    case "started": {
      // Review fix E11: a half-covered ask names the part that can't be looked up, and why.
      const gaps = missing.map((m) => `${capital(aboutPhrase([m.about]))} ${missingWhy(m.why)}, so that part can't be looked up.`);
      const tail = gaps.length === 0 ? "" : ` ${gaps.join(" ")} Say that too, in the same short sentence.`;
      return `A look-up through ${what} is now running for what the owner asked. Say one short, neutral sentence, such as "Let me look.", and nothing about what it might find. The answer comes later on its own; never guess it, and don't start another look-up for the same thing.${tail}`;
    }
    case "notConnected": {
      // Review fix E11: an expired grant is said as needing connecting again, never as never connected.
      const expired = missing.filter((m) => m.why === "expired").map((m) => m.about);
      if (expired.length > 0 && missing.every((m) => m.why === "expired")) return `${capital(aboutPhrase(expired))} needs connecting again before anything can be looked up there. Say so in one short sentence, and never guess what it holds.`;
      return `${capital(what)} is not connected, so nothing can be looked up there. Say so in one short sentence, and never guess what it holds.`;
    }
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

const missingWhy = (why: ErrandMissing["why"]): string => (why === "expired" ? "needs connecting again" : why === "notConnected" ? "isn't connected" : "can't be reached right now");

/**
 * Review fix E11: the sentence the call's Head carries while an errand agent is ready for the owner, so the model knows
 * a look-up exists and that its answer comes later. Code-worded, S0, no owner words.
 */
export const ERRAND_HEAD_LINE =
  "You can hand a look-up through the owner's connected mail or calendar to a helper with start_errand. Its answer comes later on its own: never guess it, and never say you can't check mail or calendar while it can. When the owner asks whether a look-up came back, call read_errand_result before answering.";

/**
 * Ruling 12: the note a later turn's reply carries while an errand of this Session runs, so the model neither starts
 * a second one nor guesses.
 */
export function errandRunningNote(about: readonly ErrandAbout[]): string {
  return `A look-up through ${aboutPhrase(about)} that you started for the owner is still running. Don't start another one for the same thing, and never guess what it will find: the answer comes when it is ready.`;
}

/**
 * Owner, Nov 19: what `start_errand` answers when a look-up through the same place is already running in this call,
 * in place of starting a second one.
 */
export function errandStillLookingNote(about: readonly ErrandAbout[]): string {
  return `A look-up through ${aboutPhrase(about)} is already running for the owner, so no second one was started. Say in one short sentence that you're still looking, and never guess what it will find.`;
}

/** Owner, Nov 19: what `read_errand_result` answers when no look-up of this call has come back or is running. */
export const ERRAND_NONE_READ_LINE = "No mail or calendar look-up has come back in this conversation, and none is running. Say so plainly, and never guess what one would find.";

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
/**
 * Review fix T8: code's line for an outcome with no citeable line. Each is S0 except `unmailed`, which says the
 * owner has mail from a stranger and is said only in private (`errandNoticeSens`).
 */
export function errandNoticeLine(notice: ErrandNotice, about: readonly ErrandAbout[]): string {
  const what = aboutPhrase(about);
  switch (notice) {
    case "needsDay":
      return "I need a day for that. Which day should I look at?";
    case "partial":
      return `I couldn't read all of ${what} just now, and what I could read didn't answer that.`;
    case "unmailed":
      return "There's mail on that from someone you haven't written to. It's on your screen.";
    case "expired":
      return `Your Google account needs connecting again before I can look through ${what}.`;
    default:
      notice satisfies never;
      return "";
  }
}
export const errandNoticeSens = (notice: ErrandNotice): "S0" | "S1" => (notice === "unmailed" ? "S1" : "S0");

/** Ruling 10: nothing could be said here, and something is on the card. */
export const ERRAND_ON_SCREEN_LINE = "I found something. It's on your screen.";
/** Ruling 10: some lines were said, and the rest is on the card. */
export const ERRAND_REST_ON_SCREEN_LINE = "The rest is on your screen.";
/**
 * Review fix T4: one card line on any run whose planner was shown an invite from someone else (owner ruling, Nov 19:
 * no longer for mail, which is attributed line by line). Code-worded, S0, and names nobody.
 */
export const ERRAND_UNMAILED_MARKER = "While looking this up, I read invites from other people.";
/** Ruling 10: the result is held, and nothing of it is shown here. */
export const ERRAND_HELD_LINE = "I found something, but I can't go into it right now.";

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
