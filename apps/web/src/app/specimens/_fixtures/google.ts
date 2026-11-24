// Fixture Google connections for the Google sheet's specimens and tests (brief 049 part B). A made-up address; no
// mail and no events, as the sheet never shows any.
import type { GoogleView } from "@franki/core";
import { type GoogleEvent, type GoogleState, INITIAL_GOOGLE, googleStep } from "../../../ui/google/google-machine";

export const GOOGLE_ZONE = "America/Chicago";
export const GOOGLE_URL = "https://accounts.google.com/o/oauth2/v2/auth?client_id=specimen";

export const GOOGLE_OFF: GoogleView = { email: null, mail: "off", calendar: "off", needsReconnect: false, connectedAt: null };
export const GOOGLE_CONNECTED: GoogleView = { email: "dana.whitlock@example.com", mail: "connected", calendar: "connected", needsReconnect: false, connectedAt: "2026-11-13T20:05:00.000Z" };
export const GOOGLE_MAIL_ONLY: GoogleView = { ...GOOGLE_CONNECTED, calendar: "off" };
export const GOOGLE_EXPIRED: GoogleView = { ...GOOGLE_CONNECTED, mail: "expired", calendar: "expired", needsReconnect: true };
/** Brief 054: a demo visit's mail and calendar, as the simulated Google answers them. A made-up address. */
export const GOOGLE_SIMULATED: GoogleView = { ...GOOGLE_CONNECTED, email: "jeffrey@kisses.example" };

/** The machine's state after `events`, from `from`. */
export function googleAfter(events: GoogleEvent[], from: GoogleState = INITIAL_GOOGLE): GoogleState {
  let s = from;
  for (const e of events) s = googleStep(s, e).state;
  return s;
}

const at = 1_000;

/** Opened, and the status answered `google`. */
export function googleShowing(google: GoogleView): GoogleState {
  return googleAfter([
    { kind: "opened", at },
    { kind: "statusAnswered", seq: 1, answer: { ok: true, google }, at },
  ]);
}

/** Brief 054: opened on a demo visit: the server answered a simulated connection. */
export function googleSimulated(): GoogleState {
  return googleAfter([
    { kind: "opened", at },
    { kind: "statusAnswered", seq: 1, answer: { ok: true, google: GOOGLE_SIMULATED, simulated: true }, at },
  ]);
}

/** Every phase of the sheet, and the notes worth seeing, for the specimens page. */
export function googleSpecimens(): { id: string; label: string; state: GoogleState }[] {
  const off = googleShowing(GOOGLE_OFF);
  const starting = googleAfter([{ kind: "connectPressed", popup: true, at }], off);
  const authorizing = googleAfter([{ kind: "startAnswered", seq: 2, answer: { ok: true, url: GOOGLE_URL }, at }], starting);
  const connected = googleShowing(GOOGLE_CONNECTED);
  return [
    { id: "reading", label: "Reading", state: googleAfter([{ kind: "opened", at }]) },
    { id: "read-failed", label: "First read failed", state: googleAfter([{ kind: "opened", at }, { kind: "statusAnswered", seq: 1, answer: { ok: false, why: "failed" }, at }]) },
    { id: "not-configured", label: "Not set up on this server", state: googleAfter([{ kind: "opened", at }, { kind: "statusAnswered", seq: 1, answer: { ok: false, why: "notConfigured" }, at }]) },
    { id: "off", label: "Not connected", state: off },
    { id: "popup-blocked", label: "Window blocked", state: googleAfter([{ kind: "connectPressed", popup: false, at }], off) },
    { id: "starting", label: "Opening Google", state: starting },
    { id: "authorizing", label: "Google's window is open", state: authorizing },
    { id: "connected", label: "Connected", state: googleAfter([{ kind: "callbackHeard", outcome: "connected", at }, { kind: "statusAnswered", seq: 3, answer: { ok: true, google: GOOGLE_CONNECTED }, at }], authorizing) },
    { id: "nothing-granted", label: "Nothing allowed", state: googleAfter([{ kind: "callbackHeard", outcome: "nothingGranted", at }, { kind: "statusAnswered", seq: 3, answer: { ok: true, google: GOOGLE_OFF }, at }], authorizing) },
    { id: "mail-only", label: "Gmail only", state: googleShowing(GOOGLE_MAIL_ONLY) },
    { id: "expired", label: "Needs a new sign-in", state: googleShowing(GOOGLE_EXPIRED) },
    { id: "confirming", label: "Disconnect asked", state: googleAfter([{ kind: "disconnectPressed", at }], connected) },
    { id: "disconnecting", label: "Disconnecting", state: googleAfter([{ kind: "disconnectPressed", at }, { kind: "disconnectYes", requestId: "req-1", at }], connected) },
    { id: "disconnected", label: "Disconnected", state: googleAfter([{ kind: "disconnectPressed", at }, { kind: "disconnectYes", requestId: "req-1", at }, { kind: "disconnectAnswered", seq: 2, answer: { ok: true, google: GOOGLE_OFF }, at }], connected) },
    { id: "simulated", label: "Simulated (demo visit)", state: googleSimulated() },
  ];
}
