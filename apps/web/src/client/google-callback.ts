/**
 * The callback page's work (brief 049 ruling 16): Google sends its window back to `/google/callback` with a code and
 * the state, or with an error. The page reads them once, takes them out of the address bar, sends the connect once
 * with the signed-in user's token, says how it went in one word on the callback channel, and closes itself. Nothing
 * from the query string is ever shown, stored, logged or sent anywhere but the connect call's body.
 */
import { GoogleConnectRequest, validate } from "@franki/core";
import type { GoogleCallbackOutcome } from "../ui/google/google-machine";
import type { ApiClient } from "./api";
import { connectGoogle } from "./google-api";
import { GOOGLE_CALLBACK_CHANNEL, GOOGLE_CALLBACK_MESSAGE } from "./google-watch";

/** How long the page waits for Firebase to say who is signed in before it gives up. */
export const GOOGLE_CALLBACK_AUTH_WAIT_MS = 10_000;

export type CallbackQuery = { kind: "code"; code: string; state: string } | { kind: "denied" } | { kind: "bad" };

/** What Google sent back. An error of any kind is `denied` (its text is never read); anything malformed is `bad`. */
export function callbackQuery(search: string): CallbackQuery {
  const q = new URLSearchParams(search);
  if (q.has("error")) return { kind: "denied" };
  const code = q.get("code");
  const state = q.get("state");
  if (code === null || state === null || q.getAll("code").length !== 1 || q.getAll("state").length !== 1) return { kind: "bad" };
  return { kind: "code", code, state };
}

export interface CallbackDeps {
  /** The query string the page was loaded with. */
  search: string;
  /** Called before anything else: takes the query out of the address bar and history. */
  scrub: () => void;
  /** Resolves with an API client once someone is signed in, or null if no one is within the wait. */
  signedIn: () => Promise<ApiClient | null>;
  newId: () => string;
  /** Says the outcome to the sheet. */
  tell: (outcome: GoogleCallbackOutcome) => void;
}

/** Runs the callback once. Never throws; every path ends in exactly one `tell`. */
export async function runGoogleCallback(deps: CallbackDeps): Promise<GoogleCallbackOutcome> {
  const query = callbackQuery(deps.search);
  deps.scrub();
  let outcome: GoogleCallbackOutcome;
  try {
    outcome = await connectFrom(query, deps);
  } catch {
    outcome = "unknown";
  }
  deps.tell(outcome);
  return outcome;
}

async function connectFrom(query: CallbackQuery, deps: CallbackDeps): Promise<GoogleCallbackOutcome> {
  if (query.kind === "denied") return "denied";
  if (query.kind === "bad") return "refused";
  const body = { requestId: deps.newId(), code: query.code, state: query.state };
  // A code or state the contract would refuse is never sent (and never shown).
  if (!validate(GoogleConnectRequest, body).ok) return "refused";
  const api = await deps.signedIn();
  if (api === null) return "unknown";
  return connectGoogle(api, body);
}

/** The browser's way to tell the sheet: one message on the same-origin channel. */
export function browserTell(outcome: GoogleCallbackOutcome): void {
  if (typeof BroadcastChannel === "undefined") return;
  const ch = new BroadcastChannel(GOOGLE_CALLBACK_CHANNEL);
  ch.postMessage({ kind: GOOGLE_CALLBACK_MESSAGE, outcome });
  ch.close();
}
