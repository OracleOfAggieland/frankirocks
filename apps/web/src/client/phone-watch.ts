/**
 * Follows one outbound phone call for the phone on the screen. It learns of a call from the voice reducer (a
 * dispatched `make_phone_call` tool) or from a finished typed turn, reads `GET /api/phone/status` while the call is
 * live, and publishes what `ui/phone/phone-call` makes of it. It decides nothing itself: every change is
 * `phoneStep`.
 *
 * It never changes call behavior: it only reads. Nothing is sent before a call is known, and one read at a time.
 */
import { type VoiceState, isPhoneStatus } from "@franki/core";
import {
  ABSENT_PHONE,
  INITIAL_PHONE,
  PHONE_LINGER_MS,
  PHONE_POLL_MS,
  type PhoneCallRef,
  type PhoneCallState,
  type PhoneEvent,
  type PhoneView,
  phonePolls,
  phoneStep,
} from "../ui/phone/phone-call";
import type { ApiClient } from "./api";

export const PHONE_STATUS_PATH = "/api/phone/status";
export const PHONE_STATUS_TIMEOUT_MS = 4_000;

export interface PhoneWatchTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PhoneWatchDeps {
  api: ApiClient;
  /** Local monotonic ms (the Browser_Client clock's `mono`). */
  now: () => number;
  timers?: PhoneWatchTimers;
}

const liveTimers: PhoneWatchTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** The turn whose reply has a `make_phone_call` out at `/api/tool`, or null. */
export function pendingPhoneCall(v: VoiceState): PhoneCallRef | null {
  const a = v.active;
  if (a === null || a.pendingTool === null || a.pendingTool.name !== "make_phone_call") return null;
  return { sessionId: a.permit.stamp.sessionId, turnId: a.permit.stamp.turnId };
}

export class PhoneWatch {
  private state: PhoneCallState = INITIAL_PHONE;
  private view: PhoneView = ABSENT_PHONE;
  private readonly listeners = new Set<() => void>();
  private readonly timers: PhoneWatchTimers;
  private timer: unknown = null;
  private reading = false;
  private voicePending = false;
  private stopped = true;

  constructor(private readonly deps: PhoneWatchDeps) {
    this.timers = deps.timers ?? liveTimers;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PhoneView => this.view;

  /** Every new voice snapshot. */
  onVoice(v: VoiceState): void {
    const call = pendingPhoneCall(v);
    if (call !== null) {
      this.voicePending = true;
      this.send({ kind: "requested", call, at: this.deps.now() });
    } else if (this.voicePending) {
      this.voicePending = false;
      this.send({ kind: "settled", at: this.deps.now() });
    }
  }

  /** A typed turn with no call open was answered. It may have placed a phone call. */
  onTypedTurn(call: PhoneCallRef): void {
    this.send({ kind: "probe", call, at: this.deps.now() });
  }

  /** Effect setup. Restartable: Strict Mode runs start, stop, start on one instance. */
  start(): void {
    this.stopped = false;
  }

  /** Sign-out or unmount: nothing is followed and nothing more is read. */
  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.voicePending = false;
    this.state = INITIAL_PHONE;
    this.publish();
  }

  private send(e: PhoneEvent): void {
    if (this.stopped) return;
    const before = this.state;
    this.state = phoneStep(before, e);
    if (this.state !== before) this.publish();
    this.schedule(before);
  }

  private publish(): void {
    const { phase, reason } = this.state;
    if (phase === this.view.phase && reason === this.view.reason) return;
    this.view = phase === "absent" ? ABSENT_PHONE : { phase, reason };
    for (const l of this.listeners) l();
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  /** One timer at a time: the next read while the call is live, or the tick that takes an ended call off the screen. */
  private schedule(before: PhoneCallState): void {
    const s = this.state;
    if (s.call === null) return this.clearTimer();
    if (phonePolls(s)) {
      // A newly tracked call is read at once; after that, every PHONE_POLL_MS.
      const fresh = before.call !== s.call;
      if (fresh) this.clearTimer();
      if (this.timer === null && !this.reading) this.timer = this.timers.setTimeout(() => void this.read(), fresh ? 0 : PHONE_POLL_MS);
      return;
    }
    this.clearTimer();
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.send({ kind: "tick", at: this.deps.now() });
    }, PHONE_LINGER_MS);
  }

  private async read(): Promise<void> {
    this.timer = null;
    const call = this.state.call;
    if (call === null || this.reading || this.stopped) return;
    this.reading = true;
    let status: unknown = "unknown";
    try {
      const r = await this.deps.api.call<{ status?: unknown }>(PHONE_STATUS_PATH, {
        method: "GET",
        query: { sessionId: call.sessionId, turnId: call.turnId },
        timeoutMs: PHONE_STATUS_TIMEOUT_MS,
      });
      if (r.ok) status = r.body?.status;
    } catch {
      status = "unknown";
    }
    this.reading = false;
    if (this.stopped) return;
    const at = this.deps.now();
    this.send({ kind: "status", call, status: isPhoneStatus(status) ? status : "unknown", at });
    // The limits (a dial that never lands, the longest call followed) are checked on the same beat.
    this.send({ kind: "tick", at });
  }
}
