// Every string on the front door at `/` and on the 404 and error pages (brief 015). Short, second person,
// sentence case. It claims only what the product does, names life areas and never other companies' products,
// and calls a pattern a pattern. scripts/copy-check.mjs keeps the Banned_Cause_Words out.
import type { StepId, ToyState } from "./landing/steps";

export interface StepCopy {
  /** The small mono line above the title, or null. */
  readonly kicker: string | null;
  readonly title: string;
  readonly body: string;
  /** Something Franki says out loud in this step, shown as a quote. */
  readonly says?: string;
  /** A short nudge under the body. */
  readonly hint?: string;
}

export const LANDING = {
  bar: {
    home: "Franki, back to the top",
    links: [
      { id: "loop", label: "The loop" },
      { id: "memory", label: "The memory" },
      { id: "rules", label: "House rules" },
      { id: "build", label: "The build" },
    ],
    wake: "Wake Franki",
    skip: "Skip to the story",
    /** The bar's section links, named apart from the rail's, which lists the same sections. */
    nav: "On this page",
  },
  rail: {
    label: "Sections",
    terminals: [
      { id: "top", label: "Meet Franki" },
      { id: "loop", label: "The loop" },
      { id: "memory", label: "The memory" },
      { id: "rules", label: "House rules" },
      { id: "build", label: "The build" },
      { id: "wake", label: "Wake Franki" },
    ],
  },
  hero: {
    eyebrow: "A friendly Frankenstein ghost you talk to",
    /** The headline in three parts; `stitched` is the one italic word, with the stitched underline. */
    headline: { before: "Your whole life,", stitched: "stitched", after: "together." },
    lede: "Franki joins your inbox, calendar, meals and money with one memory. It notices what lines up across them, says it out loud, and acts only when you say yes.",
    wake: "Wake Franki",
    tour: "Watch a loop close",
    alive: "It's alive!",
    scroll: "Scroll to start the tour",
  },
  stage: {
    label: "Demonstration with sample data",
    plate: "Sample data",
    fig: "The lab, on a sample month",
    toyLabel: "Pick a state",
    toy: {
      listening: "Listening",
      thinking: "Thinking",
      muted: "Muted",
      celebrate: "Celebrate",
    } satisfies Record<ToyState, string>,
  },
  sections: {
    loop: {
      eyebrow: "The loop",
      title: "Watch one loop close.",
      body: "Notice, connect, suggest, act with your OK, celebrate. Here it is on a sample month.",
    },
    memory: {
      eyebrow: "The memory",
      title: "A memory you can open.",
      body: "Everything Franki knows sits in a jar on the bench.",
    },
    rules: {
      eyebrow: "House rules",
      title: "Six rules, wired in.",
      body: "These hold in every part of the lab.",
    },
    build: {
      eyebrow: "The build",
      title: "Stitched together with Kiro.",
      body: "Franki was built spec first. Every part below is in the repo for anyone to read.",
    },
    wake: {
      title: "Throw the switch.",
      signature: "Franki Rocks at making your life easier.",
      lever: "Wake Franki",
      walkIn: "Or walk in",
      note: "You'll sign in with Google on the next screen.",
    },
  },
  steps: {
    hero: { kicker: null, title: "", body: "" },
    talk: {
      kicker: "Voice first",
      title: "Talk. Don't type.",
      body: "Voice goes in. Voice and expression come out. The eyes do the acting, the bolts spark while Franki thinks, and a muted Franki turns to ghost.",
      hint: "Pick a state and watch.",
    },
    noticed: {
      kicker: "01 Noticed",
      title: "Franki notices.",
      body: "Six takeout orders this month. Every number on screen carries its source, and a tap opens the rows behind it.",
    },
    connected: {
      kicker: "02 Connected",
      title: "Then connects.",
      body: "Four late meetings sit on the same nights. Franki calls that a pattern and names where it came from. It never calls it a cause.",
    },
    suggested: {
      kicker: "03 Suggested",
      title: "Says it out loud.",
      says: "You spent $186 on takeout this month, mostly on nights with meetings after 6. Want me to plan three quick dinners for those nights and put the groceries on your list?",
      body: "Text shows up only when there's something to read or approve.",
    },
    approve: {
      kicker: "04 Your OK",
      title: "Nothing moves without your yes.",
      body: "Say yes or tap it. Either way the action waits for you, and it leaves an audit entry.",
      hint: "Go on, tap Yes.",
    },
    yes: {
      kicker: "You said yes",
      title: "Done, and written down.",
      body: "Three quick dinners planned for the late nights. The groceries are on your list.",
    },
    result: {
      kicker: "05 The win",
      title: "$71, down from $186.",
      body: "$115 less over the same three weeks. Franki celebrates the win with you.",
    },
    jar: {
      kicker: "The jar",
      title: "One jar. One memory.",
      body: "Each mote is something Franki knows. Solid if you told it, dashed if it guessed, brass if it's one of your rules.",
    },
    know: {
      kicker: "What I know",
      title: "See where each thing came from.",
      body: "Open the jar. Every item names its source, and you get three plain choices: Wrong, Forget, or Don't bring it up.",
    },
    forget: {
      kicker: "Forget",
      title: "Forget means gone.",
      body: "Gone from the next thought on. The receipt lists what kind of thing was removed and how many, never the words. Your safety rules stay.",
    },
  } satisfies Record<StepId, StepCopy>,
  rules: [
    {
      id: "allergies",
      title: "Allergies are hard rules.",
      body: "Checked on every food choice, for everyone at the table. If Franki can't check, it won't suggest.",
    },
    {
      id: "money",
      title: "Money is read-only.",
      body: "Franki can read your spending. No tool that moves money exists.",
    },
    {
      id: "patterns",
      title: "Patterns, never causes.",
      body: "Franki tells you what lines up, from at least two weeks of data, with the sources named.",
    },
    {
      id: "forget",
      title: "Forget means gone.",
      body: "Gone from the next thought on. \"Don't bring it up\" is the other choice: kept, and quiet.",
    },
    {
      id: "email",
      title: "Email can inform. It can't give orders.",
      body: "Nothing in your inbox can change what Franki believes about you, or what it's allowed to do.",
    },
    {
      id: "yes",
      title: "Your yes, on the record.",
      body: "Every action needs your OK first and leaves an audit entry after.",
    },
  ],
  build: {
    wordmark: "FRANKIROCKS",
    figure: "Franki, anatomy of the build",
    parts: [
      { id: "skeleton", part: "Skeleton", feature: "Specs", body: "Requirements, design and tasks, written before the code.", pointsAt: "centre line" },
      { id: "brain", part: "Brain", feature: "Steering", body: "The rules every change reads first.", pointsAt: "head" },
      { id: "reflexes", part: "Reflexes", feature: "Hooks", body: "Guards that stop a bad write before it lands.", pointsAt: "neck bolts" },
      { id: "immune", part: "Immune system", feature: "Property tests", body: "Generated cases that hunt for the one input that breaks a rule.", pointsAt: "outer edge" },
    ],
  },
  /** The 404 page. The title is `titleStart` then `titleWord` in italic. */
  notFound: {
    docTitle: "Empty room · Franki",
    titleStart: "This room is",
    titleWord: "empty",
    body: "Franki isn't here. The page you're after may have moved, or was never built.",
    fig: "the slab, empty",
    home: "Back to the front door",
    lab: "Go to the lab",
  },
  /** The error page, in the same shape. */
  error: {
    docTitle: "A fuse blew · Franki",
    titleStart: "A fuse",
    titleWord: "blew",
    body: "Something in the lab tripped. Put a new one in and try again.",
    fig: "the main fuse, blown",
    retry: "Try again",
    home: "Back to the front door",
  },
} as const;
