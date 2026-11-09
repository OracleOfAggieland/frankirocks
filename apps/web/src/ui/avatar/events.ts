// The Event_Controller (lab-ui-foundation R6.2, R6.9, R8.3, R8.4; design "Event_Controller").
// A pure reducer driven by Frame_Time: no Wall_Clock_Read and no timers. The only code that starts
// and clears Avatar_Events.
import type { AvatarState } from "@franki/core";
import { EVENT_MS } from "../motion";
import type { AvatarEvent, TimedEvent } from "./types";

export type EventInput =
  | { kind: "frame"; at: number }
  | { kind: "state"; state: AvatarState; at: number }
  | { kind: "event"; event: TimedEvent; at: number }
  | { kind: "await"; approvalId: string; at: number }
  /** The approval was answered or removed. */
  | { kind: "approvalDone"; approvalId: string; at: number }
  | { kind: "signOut"; at: number };

export interface EventState {
  /** Latest Frame_Time seen. */
  now: number | null;
  state: AvatarState;
  /** The Visit's wake has started. */
  woke: boolean;
  timed: { event: TimedEvent; startedAt: number } | null;
  /** The approval being waited for. */
  awaiting: string | null;
}

export const initialEventState: EventState = { now: null, state: "closed", woke: false, timed: null, awaiting: null };

function expire(s: EventState): EventState {
  if (s.timed === null || s.now === null) return s;
  return s.now - s.timed.startedAt >= EVENT_MS[s.timed.event] ? { ...s, timed: null } : s;
}

function startWake(s: EventState, now: number): EventState {
  return s.woke ? s : { ...s, woke: true, timed: { event: "wake", startedAt: now } };
}

export function reduceEvents(prev: EventState, input: EventInput): EventState {
  // Rule 1: time never moves backward. A non-finite Frame_Time is ignored.
  const at = Number.isFinite(input.at) ? input.at : (prev.now ?? 0);
  const now = prev.now === null ? at : Math.max(prev.now, at);
  // Rule 2: expiry runs on every input.
  let s = expire({ ...prev, now });

  switch (input.kind) {
    case "frame":
      return s;
    case "state":
      s = { ...s, state: input.state };
      if (input.state === "connecting") s = startWake(s, now); // Rule 3
      if (input.state === "closed") s = { ...s, awaiting: null }; // Rule 5
      return s;
    case "event":
      if (input.event === "wake") return startWake(s, now); // Rule 3
      if (s.timed?.event === "wake") return s; // Rule 4: dropped during wake
      return { ...s, timed: { event: input.event, startedAt: now } };
    case "await":
      return { ...s, awaiting: input.approvalId };
    case "approvalDone":
      return s.awaiting === input.approvalId ? { ...s, awaiting: null } : s;
    case "signOut":
      return { ...s, timed: null, awaiting: null };
  }
}

/** Rule 6: the single Avatar_Event the Look_Mapper sees. */
export function currentEvent(s: EventState): { event: AvatarEvent | null; eventElapsedMs: number; firstConnecting: boolean } {
  if (s.timed !== null) {
    return {
      event: s.timed.event,
      eventElapsedMs: Math.max(0, (s.now ?? s.timed.startedAt) - s.timed.startedAt),
      firstConnecting: s.timed.event === "wake",
    };
  }
  if (s.awaiting !== null) return { event: "await-approval", eventElapsedMs: 0, firstConnecting: false };
  return { event: null, eventElapsedMs: 0, firstConnecting: false };
}
