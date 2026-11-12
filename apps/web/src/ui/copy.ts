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

/** Every Surface and control string (R16, R17.4). */
export const COPY = {
  card: {
    yes: "Yes",
    notNow: "Not now",
    checkedFor: "Checked for",
    sources: "Sources",
    ingredients: "Ingredients",
    lockedRule: "Locked rule",
    rows: "Rows behind this number",
    total: "Total",
    when: "When",
    what: "What",
    amount: "Amount",
  },
  strip: {
    terminals: ["Noticed", "Connected", "Suggested", "You said yes"] as const,
    label: "Loop progress",
  },
  jar: { open: "What I know" },
  sheet: {
    title: "What I know",
    hardRules: "Your rules",
    guessed: "Guessed",
    from: "From",
    wrong: "Wrong",
    forget: "Forget",
    quiet: "Don't bring it up",
    close: "Close",
    confirmRule: "Tap again to remove this rule",
  },
  lab: { title: "The Lab", none: "—", limits: "What I can't do yet", on: "Counting", off: "No counts yet" },
  receipt: {
    title: "Receipt",
    blocked: "Blocked now",
    cleaned: "Cleaned up",
    done: "Done",
    notYet: "Not yet",
    kept: "Kept",
    safetyRules: (n: number) => `${n} safety ${n === 1 ? "rule" : "rules"}`,
    touched: "Touched",
  },
  time: { simulated: "Simulated:" },
  captions: { toggle: "Captions" },
  sound: { toggle: "Sound effects" },
  auth: { signIn: "Sign in to wake Franki", signOut: "Sign out", about: "About Franki" },
  typed: { open: "Type to Franki", label: "Type to Franki", send: "Send" },
  call: {
    start: "Call Franki",
    hangUp: "Hang up",
    mute: "Mute microphone",
    unmute: "Unmute microphone",
    muted: "Your microphone is muted.",
    retry: "Try again",
    /** Inline call errors, one per failed step; plain and short, no internals. */
    errors: {
      open: "Franki couldn't connect. Press call to try again.",
      close: "You've hung up. The line will close on its own.",
    },
    notSetUp: "Calls aren't set up here yet.",
  },
  cursor: { toggle: "Lab spider" },
  company: { walkedIn: "Someone walked in", alone: "We're alone" },
  forgetLast: "Forget last thing",
  areas: ["Time and work", "Food and health", "Money", "People", "Goals"] as const,
} as const;
