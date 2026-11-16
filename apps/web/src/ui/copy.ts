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
    close: "Close",
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
  lab: { title: "The Lab", none: "—", on: "Counting", off: "No counts yet" },
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
      // Brief 044, item 2: the server said this visit is over (a reset made a new one); the visit reloads.
      visit: "This visit has ended. Loading the current one.",
    },
    notSetUp: "Calls aren't set up here yet.",
  },
  cursor: { toggle: "Lab spider" },
  company: {
    name: "Company mode",
    walkedIn: "Someone walked in",
    alone: "We're alone",
    // Brief 044, item 3: why a tap did not change the mode. The toggle keeps showing what the server last said.
    noAnswer: "Not changed: the server did not answer.",
    movedOn: "Not changed: the session moved on. Try again.",
    betweenCalls: "Not changed: the call is reconnecting. Try again in a moment.",
  },
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
  /** Brief 027: the visit, the time bolt, start over and the sheet on real data. */
  visit: {
    cloning: "Setting up your month",
    resetting: "Starting over",
    endingCall: "Ending the call first",
    failed: {
      clone: "Your month didn't load.",
      interrupted: "Your month didn't finish loading.",
      barrier: "Franki is busy forgetting something. Try again in a moment.",
    },
    retry: "Try again",
    startOver: "Start over",
    confirm: { question: "Start over with a fresh month? What you added goes.", yes: "Start over", no: "Keep this month" },
    bolt: {
      label: "Jump ahead",
      waiting: "Waiting for Franki to finish",
      moving: "Moving the clock",
      didNotMove: "The clock didn't move. Try again.",
      today: "Today",
      tomorrow: "Tomorrow",
      weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const,
      evening: "6 PM",
      morning: "9 AM",
      weekOn: "A week on",
      threeWeeksOn: "Three weeks on",
    },
  },
  sheetData: {
    /** Items whose area no view names yet (brief 020: no predicate-to-area source). */
    unsorted: "Other things",
    /** Where an item came from, when its why view did not answer. */
    fromUnknown: "a source I can't show right now",
    open: "What I know",
    loading: "Reading what I know",
    failed: "I couldn't read that just now.",
  },
  /** Brief 046 part B: the way in and the bank sheet. Plaid's own screen takes the bank sign-in. */
  bank: {
    open: "Bank",
    title: "Your bank",
    close: "Close",
    readOnly: "I can read your bank's transactions. I can't move money.",
    plaid: "You sign in to your bank with Plaid, so I never see your bank password.",
    connect: "Connect a bank",
    reading: "Reading your banks",
    readFailed: "I couldn't read your banks just now.",
    retry: "Try again",
    none: "No bank connected yet.",
    preparing: "Getting Plaid ready",
    linking: "Plaid is open",
    connecting: "Connecting your bank",
    disconnecting: "Disconnecting",
    unnamed: "Your bank",
    /** The lamp beside a bank, in words for screen readers. */
    lamp: { on: "Reading", off: "Not reading" },
    importing: "Importing transactions",
    lastRead: (when: string) => `Last read ${when}`,
    notRead: "Not read yet",
    needsReconnect: "This bank needs a new sign-in. Disconnect it, then connect it again.",
    accountsLabel: "Accounts",
    /** "Checking ••1234": the account's name and its last four. */
    account: (name: string, mask: string | null) => (mask === null ? name : `${name} ••${mask}`),
    disconnect: "Disconnect",
    confirm: "Disconnect this bank? I'll remove it at Plaid and stop reading it.",
    yes: "Yes",
    notNow: "Not now",
    limit: (n: number) => `That's the most banks I can read at once (${n}).`,
    notes: {
      linkClosed: "Plaid closed. No bank was connected.",
      linkFailed: "Plaid didn't finish. No bank was connected.",
      tokenFailed: "I couldn't reach Plaid just now. Try again in a moment.",
      limit: "You've connected the most banks I can read at once.",
      connected: "Your bank is connected.",
      alreadyConnected: "That bank was already connected.",
      connectRefused: "That didn't connect. You can try again.",
      connectUnknown: "I couldn't confirm that. Here are your banks as I read them now.",
      disconnected: "Disconnected. I no longer read that bank.",
      disconnectFailed: "I couldn't disconnect it just now.",
      disconnectUnknown: "I couldn't confirm that. Here are your banks as I read them now.",
    },
  },
  /** Brief 049 part B: the read-only Google connection's sheet and its callback page. */
  google: {
    open: "Google",
    title: "Your Google account",
    close: "Close",
    readOnly: "I can read your Gmail and your Google Calendar. I can't send, change or delete anything.",
    signIn: "You sign in on Google's own page, so I never see your Google password.",
    onRead: "I keep only what I read to answer you, not your whole mailbox.",
    connect: "Connect Google",
    connectAgain: "Connect again",
    reading: "Reading your Google connection",
    readFailed: "I couldn't read your Google connection just now.",
    retry: "Try again",
    notConfigured: "Google isn't set up on this server yet.",
    none: "Not connected yet.",
    starting: "Opening Google",
    authorizing: "Google's sign-in is open. Finish there, then come back.",
    stopWaiting: "Stop waiting",
    disconnecting: "Disconnecting",
    /** The lamp beside the account, in words for screen readers. */
    lamp: { on: "Reading", off: "Not reading" },
    partsLabel: "What I can read",
    part: {
      mail: { off: "Gmail: not connected", connected: "Gmail: connected", expired: "Gmail: needs a new sign-in" },
      calendar: { off: "Calendar: not connected", connected: "Calendar: connected", expired: "Calendar: needs a new sign-in" },
    },
    needsReconnect: "Google needs a new sign-in. Connect again.",
    connectedSince: (when: string) => `Connected ${when}`,
    disconnect: "Disconnect",
    confirm: "Disconnect Google? I'll revoke my access at Google and stop reading your mail and calendar.",
    yes: "Yes",
    notNow: "Not now",
    notes: {
      popupBlocked: "Your browser blocked Google's pop-up. Allow pop-ups for this site, then try again.",
      startFailed: "I couldn't reach Google just now. Try again in a moment.",
      connected: "Google is connected.",
      nothingGranted: "You didn't allow mail or calendar, so nothing was connected.",
      denied: "Google didn't connect. Nothing was shared.",
      refused: "That didn't connect. You can try again.",
      connectUnknown: "I couldn't confirm that. Here's your connection as I read it now.",
      timedOut: "That took too long. Here's your connection as I read it now.",
      stopped: "Stopped waiting. Here's your connection as I read it now.",
      disconnected: "Disconnected. I no longer read your Google account.",
      disconnectFailed: "I couldn't disconnect it just now.",
      disconnectUnknown: "I couldn't confirm that. Here's your connection as I read it now.",
    },
    /** The callback page, in Google's pop-up. Nothing from the address bar is ever shown. */
    callback: {
      title: "Connecting Google",
      working: "Connecting your Google account",
      done: "Done. You can close this pop-up.",
      failed: "That didn't connect. You can close this pop-up and try again.",
    },
  },
  /** Brief 047: the radio on the stage and its globe of stations. */
  radio: {
    /** The radio on the stage: what its button is to a screen reader, by what a press would do. */
    prop: {
      turnOn: "Turn on the radio",
      openGlobe: "Open the radio globe",
      closeGlobe: "Close the radio globe",
      /** Shown as words when the 3D radio can't be drawn. */
      fallback: "Radio",
    },
    panel: {
      title: "Franki’s radio",
      close: "Close the radio globe",
      off: "Turn the radio off",
      previous: "Previous station",
      next: "Next station",
      spin: "Spin the globe",
      volume: "Volume",
      retry: "Try again",
      globe: "A globe of radio stations. Drag to spin it, and press a light to tune in.",
      place: (city: string, country: string) => `${city}, ${country}`,
      tuneTo: (name: string, city: string) => `Tune to ${name}, ${city}`,
      /** Shown in place of the globe when it can't be drawn. */
      list: "Stations",
    },
    /** The one word beside the station's name. */
    signal: {
      silent: "Off",
      tuning: "Tuning",
      playing: "On air",
      noSignal: "No signal",
      tapToPlay: "Tap to play",
    },
  },
  // Brief 051: the X-ray machine on the stage and its screen.
  xray: {
    /** The machine on the stage: what its button is to a screen reader, by what a press would do. */
    prop: {
      turnOn: "Turn on the X-ray machine",
      turnOff: "Turn off the X-ray machine",
      /** Shown as words when the 3D machine can't be drawn. */
      fallback: "X-ray",
    },
    panel: {
      title: "Franki’s X-ray",
      close: "Turn off the X-ray",
      flip: "Flip the camera",
      retry: "Try again",
      resume: "Start again",
      /** What the picture is, to a screen reader. */
      picture: "Your camera’s picture, drawn as an X-ray.",
      /** Shown while the tracker looks for someone. */
      hint: "Hold up a hand, or point it at a friend.",
      /** Always on the screen while it is open. */
      note: "A toy, not a medical scan. The picture stays on this device.",
    },
    /** The few words beside the title. */
    signal: {
      dark: "Off",
      asking: "Allow the camera",
      warming: "Warming up",
      searching: "Looking for bones",
      seeing: "X-ray on",
      filmOnly: "Film only",
      blocked: "Camera blocked",
      noCamera: "No camera",
      paused: "Paused",
    },
    /** One line in the middle of the screen when there is no moving picture, or no bones. */
    help: {
      blocked: "Allow the camera for this site in your browser, then try again.",
      noCamera: "Franki can’t find a camera to use here.",
      paused: "The camera turned off while you were away.",
      filmOnly: "The bones didn’t load, so this is the film alone.",
    },
  },
  // Brief 049 part A, rulings 11 and 12: the word on the stage while an errand runs.
  errands: {
    running: { mail: "Checking your mail", calendar: "Checking your calendar", both: "Checking your mail and calendar" },
  },
} as const;
