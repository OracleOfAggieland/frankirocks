/**
 * @machine ui.google
 * The Google sheet (brief 049 part B): what the sheet shows about the owner's Google connection, when Google's own
 * window is sent to its authorization page, and which `/api/google/*` call goes out next. Pure:
 * googleStep(state, event) -> { state, commands }. `at` rides on every event, request IDs arrive on the event that
 * needs one, and every wait is an `arm` command plus a deadline in state.
 * Always: the connection shown is the last one the server answered, changed only by a later answer (status,
 *         disconnect); nothing is shown as connected or gone before its answer. An answer that does not carry the
 *         seq of the request in flight changes nothing. The authorization URL rides on one `navigate` command and
 *         is never kept in state. The connect itself is sent by the callback page, never by this machine; the
 *         sheet learns how it went from the callback's one word or from a status read, and reads the status again
 *         either way. While Google's window is out, a status read goes out every GOOGLE_AUTH_POLL_MS, one at a
 *         time, and the wait ends at GOOGLE_AUTH_MAX_MS. Disconnect asks first, and only an explicit Yes sends it.
 *         While the last status answer said `simulated` (brief 054), neither Connect nor Disconnect starts.
 * Never:  read a clock, the network or the DOM; hold a code, a state or a token; show Google's error text; throw.
 */
import type { GoogleView } from "@franki/core";

/** Where the sheet is. */
export type GooglePhase =
  /** Nothing read yet: the sheet has not been opened since sign-in. */
  | "unread"
  /** The first status read is out. */
  | "reading"
  /** The first status read failed: the sheet says so and offers Try again. */
  | "readFailed"
  /** The server has no Google client set up: nothing can be connected here. */
  | "notConfigured"
  /** The connection is known and nothing is out. */
  | "idle"
  /** Google's window is open on a blank page, and the start call is out. */
  | "starting"
  /** Google's window is on Google's authorization page, or on the callback page. */
  | "authorizing"
  /** Disconnect was pressed, and waits for Yes or Not now. */
  | "confirming"
  /** The disconnect call is out. */
  | "disconnecting";

/** One plain line after something finished. Never Google's words. */
export type GoogleNote =
  | "popupBlocked"
  | "startFailed"
  | "connected"
  | "nothingGranted"
  | "denied"
  | "refused"
  | "connectUnknown"
  | "timedOut"
  | "stopped"
  | "disconnected"
  | "disconnectFailed"
  | "disconnectUnknown";

/** The one word the callback page sends back. `connected` and `nothingGranted` are the connect route's answers. */
export const GOOGLE_CALLBACK_OUTCOMES = ["connected", "nothingGranted", "denied", "refused", "unknown"] as const;
export type GoogleCallbackOutcome = (typeof GOOGLE_CALLBACK_OUTCOMES)[number];

export interface GoogleState {
  open: boolean;
  phase: GooglePhase;
  note: GoogleNote | null;
  /** The last connection the server answered; null before any answer. */
  google: GoogleView | null;
  /** The last seq handed out. */
  seq: number;
  /** The status read in flight. */
  statusAsk: number | null;
  /** The start or disconnect call in flight. */
  actionAsk: number | null;
  /** While `authorizing`: the connection time the server had answered when the window opened. */
  authBefore: string | null;
  /** While `authorizing`: the wait ends at this time. */
  authUntil: number | null;
  /** While `authorizing`: the next backup status read is due at this time. */
  pollAt: number | null;
  /**
   * Brief 054 (R17.3, R17.4): the server's last status answer said this mail and calendar are simulated (a demo
   * visit). Present only when true, and absent in `INITIAL_GOOGLE`, so a sample visit's states are as they were.
   * While set, the sheet offers neither Connect nor Disconnect. A later answer without it clears it.
   */
  simulated?: true;
}

export const INITIAL_GOOGLE: Readonly<GoogleState> = Object.freeze({
  open: false,
  phase: "unread",
  note: null,
  google: null,
  seq: 0,
  statusAsk: null,
  actionAsk: null,
  authBefore: null,
  authUntil: null,
  pollAt: null,
});

/** A backup status read while Google's window is out, in case the callback's word never arrives. */
export const GOOGLE_AUTH_POLL_MS = 4_000;
/** The wait for Google's window ends here: the server's pending authorization lasts ten minutes. */
export const GOOGLE_AUTH_MAX_MS = 10 * 60_000;

export type GoogleStatusAnswer = { ok: true; google: GoogleView; simulated?: true } | { ok: false; why: "notConfigured" | "failed" };
/** `url` is Google's authorization page, already checked by the shell to be on Google's host. */
export type GoogleStartAnswer = { ok: true; url: string } | { ok: false; why: "notConfigured" | "failed" };
/** `failed`: the server answered that it did not disconnect. `unknown`: no answer reached the browser. */
export type GoogleDisconnectAnswer = { ok: true; google: GoogleView } | { ok: false; why: "failed" | "unknown" };

export type GoogleEvent =
  /** The way in was pressed. */
  | { kind: "opened"; at: number }
  /** Close, Escape or the scrim. */
  | { kind: "closed"; at: number }
  /** Try again after a failed first read. */
  | { kind: "retry"; at: number }
  | { kind: "statusAnswered"; seq: number; answer: GoogleStatusAnswer; at: number }
  /** "Connect Google" was pressed. `popup`: the shell opened Google's window in the same press. */
  | { kind: "connectPressed"; popup: boolean; at: number }
  | { kind: "startAnswered"; seq: number; answer: GoogleStartAnswer; at: number }
  /** The callback page's one word. */
  | { kind: "callbackHeard"; outcome: GoogleCallbackOutcome; at: number }
  /** "Stop waiting" while Google's window is out. */
  | { kind: "stopWaiting"; at: number }
  | { kind: "disconnectPressed"; at: number }
  | { kind: "disconnectNotNow"; at: number }
  /** Yes. `requestId` is new for this disconnect. */
  | { kind: "disconnectYes"; requestId: string; at: number }
  | { kind: "disconnectAnswered"; seq: number; answer: GoogleDisconnectAnswer; at: number }
  /** A timer the machine armed went off. */
  | { kind: "tick"; at: number }
  /** Signed out, or the page is going away. */
  | { kind: "reset" };

export type GoogleCommand =
  | { kind: "readStatus"; seq: number }
  | { kind: "start"; seq: number }
  /** Send Google's window to this URL. */
  | { kind: "navigate"; url: string }
  /** Close Google's window, if it is still ours to close. */
  | { kind: "closePopup" }
  | { kind: "disconnect"; seq: number; requestId: string }
  /** Send `tick` after this many ms. */
  | { kind: "arm"; ms: number };

export interface GoogleStep {
  state: GoogleState;
  commands: GoogleCommand[];
}

const none = (state: GoogleState): GoogleStep => ({ state, commands: [] });

/** True while some call the owner started is out, so the sheet's own buttons wait. */
export function googleBusy(s: GoogleState): boolean {
  return s.phase === "starting" || s.phase === "authorizing" || s.phase === "disconnecting";
}

/** Some part is not connected now (never connected, refused at consent, or needing a new sign-in). */
export function googleIncomplete(g: GoogleView): boolean {
  return g.mail !== "connected" || g.calendar !== "connected";
}

/** Some part is connected or expired: there is something to disconnect. */
export function googleHeld(g: GoogleView): boolean {
  return g.mail !== "off" || g.calendar !== "off";
}

/** Whether "Connect Google" (or "Connect again") is offered. Never for a simulated connection (brief 054). */
export function canConnectGoogle(s: GoogleState): boolean {
  return s.phase === "idle" && s.google !== null && googleIncomplete(s.google) && s.simulated !== true;
}

/** Brief 054: the state with the server's `simulated` mark as the answer gave it, absent when it did not. */
function markSimulated(s: GoogleState, simulated: boolean): GoogleState {
  if (simulated) return s.simulated === true ? s : { ...s, simulated: true };
  if (s.simulated === undefined) return s;
  const next = { ...s };
  delete next.simulated;
  return next;
}

function readStatus(s: GoogleState): GoogleStep {
  if (s.statusAsk !== null) return none(s);
  const seq = s.seq + 1;
  return { state: { ...s, seq, statusAsk: seq }, commands: [{ kind: "readStatus", seq }] };
}

/** Merges the step's commands after `first`'s. */
function then(first: GoogleStep, next: (s: GoogleState) => GoogleStep): GoogleStep {
  const second = next(first.state);
  return { state: second.state, commands: [...first.commands, ...second.commands] };
}

/** The wait for Google's window ends: the window goes, and the status is read for what is true. */
function endAuth(s: GoogleState, note: GoogleNote): GoogleStep {
  const ended: GoogleState = { ...s, phase: "idle", note, authBefore: null, authUntil: null, pollAt: null };
  return then({ state: ended, commands: [{ kind: "closePopup" }] }, readStatus);
}

const CALLBACK_NOTES: Record<GoogleCallbackOutcome, GoogleNote> = {
  connected: "connected",
  nothingGranted: "nothingGranted",
  denied: "denied",
  refused: "refused",
  unknown: "connectUnknown",
};

/** A status answer while waiting that shows a newer connection: the connect landed, whatever the callback said. */
function landed(s: GoogleState, g: GoogleView): boolean {
  return g.connectedAt !== null && g.connectedAt !== s.authBefore && !g.needsReconnect && (g.mail === "connected" || g.calendar === "connected");
}

function onStatus(s: GoogleState, e: Extract<GoogleEvent, { kind: "statusAnswered" }>): GoogleStep {
  if (e.seq !== s.statusAsk) return none(s);
  const a = e.answer;
  if (!a.ok) {
    if (a.why === "notConfigured") return none({ ...s, statusAsk: null, phase: s.phase === "reading" || s.phase === "readFailed" ? "notConfigured" : s.phase });
    // A failed re-read keeps what was last answered; only a first read that fails says so.
    if (s.google !== null) return none({ ...s, statusAsk: null });
    return none({ ...s, statusAsk: null, phase: s.phase === "reading" ? "readFailed" : s.phase });
  }
  const state: GoogleState = markSimulated(
    {
      ...s,
      statusAsk: null,
      google: a.google,
      phase: s.phase === "reading" || s.phase === "readFailed" || s.phase === "notConfigured" ? "idle" : s.phase,
    },
    a.simulated === true,
  );
  if (state.phase === "authorizing" && landed(s, a.google)) return endAuth(state, "connected");
  // Nothing left to disconnect, or a simulated connection, which is never disconnected: the ask goes.
  if (state.phase === "confirming" && (state.simulated === true || !googleHeld(a.google))) return none({ ...state, phase: "idle" });
  return none(state);
}

function onTick(s: GoogleState, at: number): GoogleStep {
  if (s.phase !== "authorizing") return none(s);
  if (s.authUntil !== null && at >= s.authUntil) return endAuth(s, "timedOut");
  if (s.pollAt === null || at < s.pollAt) return none(s);
  const armed: GoogleStep = { state: { ...s, pollAt: at + GOOGLE_AUTH_POLL_MS }, commands: [{ kind: "arm", ms: GOOGLE_AUTH_POLL_MS }] };
  return then(armed, readStatus);
}

/** Total: every event is defined in every state. */
export function googleStep(s: GoogleState, e: GoogleEvent): GoogleStep {
  switch (e.kind) {
    case "reset":
      return none(INITIAL_GOOGLE);
    case "opened": {
      // Every open reads the connection again.
      const phase = s.phase === "unread" || s.phase === "readFailed" || s.phase === "notConfigured" ? "reading" : s.phase;
      return readStatus({ ...s, open: true, note: null, phase });
    }
    case "closed":
      // Closing drops an unanswered ask; a call already out still lands, and the wait for Google's window goes on.
      return none({ ...s, open: false, note: null, phase: s.phase === "confirming" ? "idle" : s.phase });
    case "retry":
      if (s.phase !== "readFailed" || s.statusAsk !== null) return none(s);
      return readStatus({ ...s, phase: "reading", note: null });
    case "statusAnswered":
      return onStatus(s, e);
    case "connectPressed": {
      if (!canConnectGoogle(s)) return e.popup ? { state: s, commands: [{ kind: "closePopup" }] } : none(s);
      if (!e.popup) return none({ ...s, note: "popupBlocked" });
      const seq = s.seq + 1;
      return { state: { ...s, seq, actionAsk: seq, phase: "starting", note: null }, commands: [{ kind: "start", seq }] };
    }
    case "startAnswered": {
      if (s.phase !== "starting" || e.seq !== s.actionAsk) return none(s);
      const base: GoogleState = { ...s, actionAsk: null };
      if (!e.answer.ok) {
        const phase = e.answer.why === "notConfigured" ? "notConfigured" : "idle";
        return { state: { ...base, phase, note: e.answer.why === "notConfigured" ? null : "startFailed" }, commands: [{ kind: "closePopup" }] };
      }
      return {
        state: { ...base, phase: "authorizing", authBefore: s.google?.connectedAt ?? null, authUntil: e.at + GOOGLE_AUTH_MAX_MS, pollAt: e.at + GOOGLE_AUTH_POLL_MS },
        commands: [{ kind: "navigate", url: e.answer.url }, { kind: "arm", ms: GOOGLE_AUTH_POLL_MS }, { kind: "arm", ms: GOOGLE_AUTH_MAX_MS }],
      };
    }
    case "callbackHeard":
      if (s.phase !== "authorizing") return none(s);
      return endAuth(s, CALLBACK_NOTES[e.outcome]);
    case "stopWaiting":
      if (s.phase !== "authorizing") return none(s);
      return endAuth(s, "stopped");
    case "disconnectPressed":
      // Brief 054 (R17.3): a simulated connection is never offered a disconnect, and the server refuses one.
      if (s.phase !== "idle" || s.simulated === true || s.google === null || !googleHeld(s.google)) return none(s);
      return none({ ...s, phase: "confirming", note: null });
    case "disconnectNotNow":
      if (s.phase !== "confirming") return none(s);
      return none({ ...s, phase: "idle" });
    case "disconnectYes": {
      if (s.phase !== "confirming") return none(s);
      const seq = s.seq + 1;
      return { state: { ...s, seq, actionAsk: seq, phase: "disconnecting" }, commands: [{ kind: "disconnect", seq, requestId: e.requestId }] };
    }
    case "disconnectAnswered": {
      if (s.phase !== "disconnecting" || e.seq !== s.actionAsk) return none(s);
      const base: GoogleState = { ...s, actionAsk: null, phase: "idle" };
      if (e.answer.ok) return none({ ...base, google: e.answer.google, note: "disconnected" });
      return readStatus({ ...base, note: e.answer.why === "failed" ? "disconnectFailed" : "disconnectUnknown" });
    }
    case "tick":
      return onTick(s, e.at);
    default:
      e satisfies never;
      return none(s);
  }
}
