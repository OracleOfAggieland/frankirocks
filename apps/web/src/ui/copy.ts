// Every Surface string and avatar label (lab-ui-foundation R5.4, R17.4). Short, second person,
// sentence case. scripts/copy-check.mjs keeps the Banned_Cause_Words out.
import type { AvatarState } from "@franki/core";

/** Short call-status labels for the polite announcement (design "Announcements"). */
export const CALL_STATUS = {
  idle: "Call idle",
  connecting: "Connecting",
  connected: "Call connected",
  hangingUp: "Hanging up",
  reconnecting: "Reconnecting",
} as const;

/** Accessible avatar labels, from the Avatar_State alone (R5.4). */
export const AVATAR_LABELS: Record<AvatarState, string> = {
  closed: "Franki is asleep",
  connecting: "Franki is waking up",
  listening: "Franki is listening",
  thinking: "Franki is thinking",
  speaking: "Franki is speaking",
  recovery: "Franki is having trouble connecting",
};
