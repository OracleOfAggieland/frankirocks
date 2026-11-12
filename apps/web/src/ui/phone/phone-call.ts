// The phone on the screen, as a pure machine. It turns what the browser learns about one outbound phone call
// (the voice reducer's pending `make_phone_call` tool, a typed turn that may have placed one, and the status the
// server reads back) into the one phase the phone prop draws. Pure: no timers and no clock read; `at` rides on
// every event.
//
// Two ways in. A spoken request is certain as soon as the tool call is dispatched, so the phone shows at once, in
// `dialing`. A typed turn only might have placed a call, so it is a probe: the phone stays off the screen until the
// server says there is a call.
import type { PhoneStatus } from "@franki/core";

/** What the prop draws. `missed` is every way a call ends without a conversation. */
export type PhonePhase = "absent" | "dialing" | "ringing" | "talking" | "ended" | "missed";

/** Why a call was missed. `unconfirmed`: its status could not be read for too long. */
export type MissReason = "busy" | "noAnswer" | "failed" | "unconfirmed";

export interface PhoneCallRef {
  sessionId: string;
  turnId: string;
}

export interface PhoneCallState {
  phase: PhonePhase;
  reason: MissReason | null;
  /** The turn whose call this is; null exactly when nothing is tracked. */
  call: PhoneCallRef | null;
  /** The tool call is still out, so `none` only means the dial has not been claimed yet. */
  toolPending: boolean;
  /** When this call was first tracked. */
  startedAt: number;
  /** When the phase last changed. */
  since: number;
  /** `unknown` answers in a row. */
  unknowns: number;
}

export const INITIAL_PHONE: Readonly<PhoneCallState> = Object.freeze({
  phase: "absent", reason: null, call: null, toolPending: false, startedAt: 0, since: 0, unknowns: 0,
});

/** How often the status is read while a call is live. */
export const PHONE_POLL_MS = 2_000;
/** How long an ended or missed call stays on the screen before the phone leaves. */
export const PHONE_LINGER_MS = 4_000;
/** `unknown` this many times in a row ends the wait: about 20 s without an answer from the carrier. */
export const PHONE_UNKNOWN_LIMIT = 10;
/** A tool call that never settles, or a row stuck before the carrier answered, stops being shown after this. */
export const PHONE_DIAL_LIMIT_MS = 60_000;
/** No call is followed for longer than this. */
export const PHONE_MAX_MS = 60 * 60_000;

export type PhoneEvent =
  /** The voice reducer dispatched `make_phone_call` for this turn. */
  | { kind: "requested"; call: PhoneCallRef; at: number }
  /** The tool call came back, or was dropped. */
  | { kind: "settled"; at: number }
  /** A typed turn finished; it may have placed a call. */
  | { kind: "probe"; call: PhoneCallRef; at: number }
  /** The server's answer for `call`. A stale answer for an earlier call is ignored. */
  | { kind: "status"; call: PhoneCallRef; status: PhoneStatus; at: number }
  /** Time passed. */
  | { kind: "tick"; at: number }
  /** Signed out, or the page is going away. */
  | { kind: "reset" };

const same = (a: PhoneCallRef | null, b: PhoneCallRef) => a !== null && a.sessionId === b.sessionId && a.turnId === b.turnId;

const isOver = (phase: PhonePhase) => phase === "ended" || phase === "missed";

function to(s: PhoneCallState, phase: PhonePhase, at: number, reason: MissReason | null = null): PhoneCallState {
  if (s.phase === phase && s.reason === reason) return { ...s, unknowns: 0 };
  // An over call waits on nothing: a tool call still out no longer matters to it.
  return { ...s, phase, reason, since: at, unknowns: 0, toolPending: isOver(phase) ? false : s.toolPending };
}

function onStatus(s: PhoneCallState, status: PhoneStatus, at: number): PhoneCallState {
  // An ended call stays ended: a late answer never brings the phone back.
  if (isOver(s.phase)) return s;
  switch (status) {
    case "none":
      // Before the tool settles the dial may simply not be claimed yet. After it, this turn placed no call.
      return s.toolPending ? s : INITIAL_PHONE;
    case "dialing":
      return to(s, "dialing", at);
    case "ringing":
      return to(s, "ringing", at);
    case "talking":
      return to(s, "talking", at);
    case "ended":
      // A probe that finds a call already over shows nothing: there was no call on the screen to end.
      return s.phase === "absent" ? INITIAL_PHONE : to(s, "ended", at);
    case "busy":
    case "noAnswer":
    case "failed":
      return s.phase === "absent" ? INITIAL_PHONE : to(s, "missed", at, status);
    case "unknown": {
      const unknowns = s.unknowns + 1;
      if (unknowns < PHONE_UNKNOWN_LIMIT) return { ...s, unknowns };
      return s.phase === "absent" ? INITIAL_PHONE : to(s, "missed", at, "unconfirmed");
    }
  }
}

function onTick(s: PhoneCallState, at: number): PhoneCallState {
  if (s.call === null) return s;
  if (isOver(s.phase)) return at - s.since >= PHONE_LINGER_MS ? INITIAL_PHONE : s;
  if (at - s.startedAt >= PHONE_MAX_MS) return INITIAL_PHONE;
  if ((s.phase === "dialing" || s.phase === "absent") && at - s.since >= PHONE_DIAL_LIMIT_MS) {
    return s.phase === "absent" ? INITIAL_PHONE : to(s, "missed", at, "unconfirmed");
  }
  return s;
}

/** Total: every event is defined in every state. */
export function phoneStep(s: PhoneCallState, e: PhoneEvent): PhoneCallState {
  switch (e.kind) {
    case "reset":
      return INITIAL_PHONE;
    case "requested":
      // The same turn again (the reducer re-published) changes nothing. A new request replaces whatever was shown.
      if (same(s.call, e.call)) return s;
      return { phase: "dialing", reason: null, call: e.call, toolPending: true, startedAt: e.at, since: e.at, unknowns: 0 };
    case "settled":
      return s.toolPending ? { ...s, toolPending: false } : s;
    case "probe":
      // A live call is never dropped for a probe: the typed turn after "call the shop" is not a new call.
      if (s.call !== null && !isOver(s.phase) && s.phase !== "absent") return s;
      return { phase: "absent", reason: null, call: e.call, toolPending: false, startedAt: e.at, since: e.at, unknowns: 0 };
    case "status":
      return same(s.call, e.call) ? onStatus(s, e.status, e.at) : s;
    case "tick":
      return onTick(s, e.at);
  }
}

/** The status is read while a call is tracked and not over. */
export function phonePolls(s: PhoneCallState): boolean {
  return s.call !== null && !isOver(s.phase);
}

/** True while the phone is on the screen. */
export function phoneShows(s: PhoneCallState): boolean {
  return s.phase !== "absent";
}

/** What the prop needs: the phase, and why a missed call was missed. */
export interface PhoneView {
  phase: PhonePhase;
  reason: MissReason | null;
}

export const ABSENT_PHONE: Readonly<PhoneView> = Object.freeze({ phase: "absent", reason: null });
