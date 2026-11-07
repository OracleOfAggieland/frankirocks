// Announcements (lab-ui-foundation R4.6, R18.5 to R18.8; design "Announcements"). Pure.
import type { VoiceState } from "@franki/core";
import { CALL_STATUS } from "./copy";

export interface AnnounceView {
  avatar: string;
  call: string;
  error: string | null;
}

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/**
 * One polite announcement for one render, or null when nothing changed. Changed parts join in the
 * fixed order avatar, call, error. A cleared error is not announced; the first render announces nothing.
 */
export function announcement(prev: AnnounceView | null, next: AnnounceView): string | null {
  if (prev === null) return null;
  const parts: string[] = [];
  if (next.avatar !== prev.avatar) parts.push(sentence(next.avatar));
  if (next.call !== prev.call) parts.push(sentence(next.call));
  if (next.error !== prev.error && next.error !== null) parts.push(sentence(next.error));
  return parts.length === 0 ? null : parts.join(" ");
}

/** The short call-status label for a Voice_State. */
export function callStatus(voice: Pick<VoiceState, "phase" | "hangingUp">): string {
  if (voice.hangingUp) return CALL_STATUS.hangingUp;
  switch (voice.phase) {
    case "CLOSED":
      return CALL_STATUS.idle;
    case "CONNECTING":
    case "CONFIGURING":
      return CALL_STATUS.connecting;
    case "RECOVERY":
      return CALL_STATUS.reconnecting;
    default:
      return CALL_STATUS.connected;
  }
}
