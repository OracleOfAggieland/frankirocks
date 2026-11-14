/**
 * The Google sheet's shell (brief 049 part B). It runs what `ui/google/google-machine` asks for: the three
 * `/api/google/*` calls through `client/google-api.ts`, Google's own window, the callback page's word, and its
 * timers. It decides nothing itself: every change is `googleStep`, and every answer goes back as an event naming its
 * request.
 *
 * Google's window is opened blank in the same press as "Connect Google" (a window opened later, after a call, is
 * blocked), then sent to Google's URL when start answers. Whether it was closed is never read from the window:
 * once it is on Google's page the browser may cut it off from this one. The callback page says how it went over a
 * same-origin BroadcastChannel, and the machine's backup status reads cover a word that never arrives.
 *
 * Nothing is sent before the sheet is first opened, and nothing at all once stopped (sign-out).
 */
import { type GoogleCallbackOutcome, type GoogleCommand, type GoogleEvent, type GoogleState, GOOGLE_CALLBACK_OUTCOMES, INITIAL_GOOGLE, googleStep } from "../ui/google/google-machine";
import type { ApiClient } from "./api";
import { disconnectGoogle, isGoogleAuthorizeUrl, readGoogleStatus, startGoogle } from "./google-api";

/** The BroadcastChannel the callback page speaks on. */
export const GOOGLE_CALLBACK_CHANNEL = "franki-google";
/** The one message kind on it. */
export const GOOGLE_CALLBACK_MESSAGE = "googleCallback";
/** Google's window's name and size. */
export const GOOGLE_POPUP_NAME = "franki-google";
export const GOOGLE_POPUP_FEATURES = "popup,width=520,height=680";

export interface GooglePopup {
  navigate(url: string): void;
  close(): void;
}

export interface GoogleWatchTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface GoogleWatchDeps {
  api: ApiClient;
  /** Local monotonic ms (the Browser_Client clock's `mono`). */
  now: () => number;
  /** A new request ID (contracts `ID`) for each disconnect. */
  newId: () => string;
  /** Opens Google's window blank, synchronously; null when the browser blocked it. */
  openPopup?: () => GooglePopup | null;
  /** Listens for the callback page's word; answers the stop function. */
  listen?: (heard: (outcome: GoogleCallbackOutcome) => void) => () => void;
  timers?: GoogleWatchTimers;
}

const liveTimers: GoogleWatchTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** The callback page's message, or null for anything else on the channel. */
export function callbackOutcomeOf(data: unknown): GoogleCallbackOutcome | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { kind?: unknown; outcome?: unknown };
  if (d.kind !== GOOGLE_CALLBACK_MESSAGE || typeof d.outcome !== "string") return null;
  return (GOOGLE_CALLBACK_OUTCOMES as readonly string[]).includes(d.outcome) ? (d.outcome as GoogleCallbackOutcome) : null;
}

/** The browser's window.open, blank and with no opener rights kept past the callback. */
export function browserPopup(): GooglePopup | null {
  if (typeof window === "undefined") return null;
  let w: Window | null;
  try {
    w = window.open("about:blank", GOOGLE_POPUP_NAME, GOOGLE_POPUP_FEATURES);
  } catch {
    return null;
  }
  if (w === null) return null;
  const win = w;
  return {
    navigate(url) {
      // Only Google's own authorization page; anything else stays blank.
      if (!isGoogleAuthorizeUrl(url)) return;
      try {
        win.location.replace(url);
      } catch {
        /* the window went away */
      }
    },
    close() {
      try {
        win.close();
      } catch {
        /* no longer ours */
      }
    },
  };
}

/** Listens on the callback channel; a browser with no BroadcastChannel hears nothing and relies on the status reads. */
export function browserListen(heard: (outcome: GoogleCallbackOutcome) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(GOOGLE_CALLBACK_CHANNEL);
  ch.onmessage = (e: MessageEvent) => {
    const outcome = callbackOutcomeOf(e.data);
    if (outcome !== null) heard(outcome);
  };
  return () => ch.close();
}

export class GoogleWatch {
  private state: GoogleState = INITIAL_GOOGLE;
  private readonly listeners = new Set<() => void>();
  private readonly timers: GoogleWatchTimers;
  private readonly handles = new Set<unknown>();
  private stopped = true;
  /** Raised by every stop, so an answer to a call made before it is dropped (the machine's seqs start again). */
  private epoch = 0;
  private popup: GooglePopup | null = null;
  private unlisten: (() => void) | null = null;

  constructor(private readonly deps: GoogleWatchDeps) {
    this.timers = deps.timers ?? liveTimers;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): GoogleState => this.state;

  /** Effect setup. Restartable: Strict Mode runs start, stop, start on one instance. */
  start(): void {
    this.stopped = false;
    if (this.unlisten === null) this.unlisten = (this.deps.listen ?? browserListen)((outcome) => this.send({ kind: "callbackHeard", outcome, at: this.deps.now() }));
  }

  /** Sign-out or unmount: every timer goes, Google's window closes, nothing more is sent, and nothing is kept. */
  stop(): void {
    this.stopped = true;
    this.epoch++;
    for (const h of this.handles) this.timers.clearTimeout(h);
    this.handles.clear();
    this.unlisten?.();
    this.unlisten = null;
    this.closePopup();
    this.apply({ kind: "reset" });
  }

  open(): void {
    this.send({ kind: "opened", at: this.deps.now() });
  }

  close(): void {
    this.send({ kind: "closed", at: this.deps.now() });
  }

  toggle(): void {
    if (this.state.open) this.close();
    else this.open();
  }

  retry(): void {
    this.send({ kind: "retry", at: this.deps.now() });
  }

  /** Call from the press itself: the window must open in the same gesture. */
  connect(): void {
    if (this.stopped) return;
    this.closePopup();
    this.popup = (this.deps.openPopup ?? browserPopup)();
    this.send({ kind: "connectPressed", popup: this.popup !== null, at: this.deps.now() });
  }

  stopWaiting(): void {
    this.send({ kind: "stopWaiting", at: this.deps.now() });
  }

  askDisconnect(): void {
    this.send({ kind: "disconnectPressed", at: this.deps.now() });
  }

  notNow(): void {
    this.send({ kind: "disconnectNotNow", at: this.deps.now() });
  }

  confirmDisconnect(): void {
    this.send({ kind: "disconnectYes", requestId: this.deps.newId(), at: this.deps.now() });
  }

  private closePopup(): void {
    this.popup?.close();
    this.popup = null;
  }

  private send(e: GoogleEvent): void {
    if (this.stopped) return;
    for (const c of this.apply(e)) this.run(c);
  }

  private apply(e: GoogleEvent): GoogleCommand[] {
    const before = this.state;
    const out = googleStep(before, e);
    this.state = out.state;
    if (this.state !== before) for (const l of this.listeners) l();
    return out.commands;
  }

  private run(c: GoogleCommand): void {
    const { api } = this.deps;
    switch (c.kind) {
      case "arm": {
        const epoch = this.epoch;
        const h = this.timers.setTimeout(() => {
          this.handles.delete(h);
          if (epoch === this.epoch) this.send({ kind: "tick", at: this.deps.now() });
        }, c.ms);
        this.handles.add(h);
        return;
      }
      case "navigate":
        this.popup?.navigate(c.url);
        return;
      case "closePopup":
        this.closePopup();
        return;
      case "readStatus":
        return void this.answer(readGoogleStatus(api), (answer, at) => ({ kind: "statusAnswered", seq: c.seq, answer, at }), { ok: false, why: "failed" });
      case "start":
        return void this.answer(startGoogle(api), (answer, at) => ({ kind: "startAnswered", seq: c.seq, answer, at }), { ok: false, why: "failed" });
      case "disconnect":
        return void this.answer(disconnectGoogle(api, { requestId: c.requestId }), (answer, at) => ({ kind: "disconnectAnswered", seq: c.seq, answer, at }), { ok: false, why: "unknown" });
      default:
        c satisfies never;
    }
  }

  /** Awaits one call and sends its answer; a call that throws is answered with `onThrow`. */
  private async answer<A>(call: Promise<A>, event: (answer: A, at: number) => GoogleEvent, onThrow: A): Promise<void> {
    const epoch = this.epoch;
    let a: A;
    try {
      a = await call;
    } catch {
      a = onThrow;
    }
    if (epoch !== this.epoch) return;
    this.send(event(a, this.deps.now()));
  }
}
