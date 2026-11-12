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
  /** The phone on Franki's wall: the words under it, and what it is to a screen reader. */
  phone: {
    dialing: "Dialing",
    ringing: "Ringing",
    talking: "On the phone",
    ended: "Call ended",
    missed: {
      busy: "Line busy",
      noAnswer: "No answer",
      failed: "No connection",
      unconfirmed: "Unconfirmed",
    },
    label: {
      dialing: "Franki is dialing a phone call",
      ringing: "The phone Franki called is ringing",
      talking: "Franki is on the phone",
      ended: "Franki’s phone call ended",
      missed: "Franki’s phone call didn’t connect",
    },
  },
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
    /** A hard rule's Forget, once armed: kept short so the button never changes size. */
    armedRule: "Tap again",
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
  company: { name: "Company mode", walkedIn: "Someone walked in", alone: "We're alone" },
  forgetLast: "Forget last thing",
  forgetLastPending: "Forgetting",
  /** The backdrop's fig label words, after "FIG. n ·". */
  scenery: { mains: "the mains", specimens: "specimens", slab: "the slab", bench: "the bench" },
  areas: ["Time and work", "Food and health", "Money", "People", "Goals"] as const,
  /** Brief 020: the screen on real memory data. */
  memory: {
    /** Chips are code constants; a chip's words go down the typed path as the owner's own (spec §15). */
    chips: { whatDoYouKnow: "What do you know about me?" },
    readout: { title: "What I know", empty: "Nothing yet. Tell me something and I'll keep it." },
    lab: {
      read: "Read emails",
      guessed: "Guessed private things",
      said: "Said",
      /** Spec §11: the floor reads every line at once, and the Lab says so. */
      floorRecall: "I read every line I keep at once, up to 200, instead of searching.",
    },
    /** The strip's last terminal while no comparison figure has a source. */
    stripResult: "Compared",
    goneAsk: { title: "A quick check", question: "Did you want that deleted?", yes: "Yes", no: "No" },
    /** Where a `why` root came from, by Evidence kind code (review 028 finding 9); `other` for a code not listed. */
    sources: {
      turn: "You said",
      message: "An email",
      calendar: "Your calendar",
      transaction: "Your bank",
      receipt: "A receipt",
      note: "A note",
      task: "A task",
      food: "A food log",
      other: "A source",
    },
  },
} as const;
