// Fixtures for the Specimens_Page only (lab-ui-foundation R20.1, R20.5). Example props, never shown on
// the Main_Screen. The sentinel lets scripts/specimens-absent.mjs prove no fixture reached a production build.
import type { AvatarState } from "@franki/core";
import type { AvatarEvent, AvatarInput } from "../../../ui/avatar/types";
import type {
  CardProps,
  KnownItem,
  LabProps,
  MoteKind,
  ReceiptProps,
  StripProps,
  TimeBadgeProps,
  TurnCopies,
} from "../../../ui/surface-props";

export const SPECIMENS_SENTINEL_9c41 = "SPECIMENS_SENTINEL_9c41";

const noop = () => {};

export const STATES: readonly AvatarState[] = ["closed", "connecting", "listening", "thinking", "speaking", "recovery"];
export const EVENTS: readonly (AvatarEvent | null)[] = [null, "wake", "present-card", "await-approval", "celebrate"];

export function avatarInput(state: AvatarState, event: AvatarEvent | null, opts: { ghost?: boolean; reduced: boolean; firstConnecting?: boolean }): AvatarInput {
  return {
    state,
    micMuted: opts.ghost ?? false,
    outputMuted: false,
    inputLevel: state === "listening" ? 0.5 : 0,
    outputLevel: state === "speaking" ? 0.6 : 0,
    event,
    eventElapsedMs: 0,
    firstConnecting: opts.firstConnecting ?? event === "wake",
    reducedMotion: opts.reduced,
  };
}

const sources = [
  { id: "bank", label: "Bank · 6 purchases" },
  { id: "cal", label: "Calendar · 4 meetings" },
];

export const CARDS: CardProps[] = [
  {
    kind: "source",
    id: "card-source",
    title: "Takeout nights",
    sources,
    onOpenSource: noop,
    body: "Mostly on nights with meetings after 6.",
    figures: [
      { label: "This month", value: "$115 less", sourceId: "bank" },
      { label: "Late meetings", value: "4", sourceId: "cal" },
    ],
  },
  { kind: "approval", id: "card-approval", title: "Hold Thursday evening", sources: [], onOpenSource: noop, effect: "I'll block 6 to 8 PM on Thursday in your calendar.", onYes: noop, onNotNow: noop },
  {
    kind: "food",
    id: "card-food",
    title: "Dinner pick",
    sources: [],
    onOpenSource: noop,
    choice: "Pad thai with tofu, no peanuts",
    ingredients: ["rice noodles", "tofu", "egg", "lime"],
    checkedFor: [
      { person: "Sam", rules: [{ id: "rule-peanut", person: "Sam", text: "No peanuts" }] },
      { person: "You", rules: [{ id: "rule-shellfish", person: "You", text: "No shellfish" }] },
    ],
  },
  {
    kind: "ask",
    id: "card-ask",
    title: "Which one should I forget?",
    sources: [],
    onOpenSource: noop,
    question: "You have two dentist notes. Which one goes?",
    options: [
      { id: "older", label: "The older one" },
      { id: "both", label: "Both" },
    ],
    onAnswer: noop,
  },
  { kind: "read", id: "card-read", title: "Your list", sources: [], onOpenSource: noop, lines: ["Milk", "Eggs", "Basil"] },
];

export const STRIP_FILLS: StripProps["filled"][] = [0, 1, 2, 3, 4, 5];
export const STRIP_RESULT = "$115 less";

const MOTE_KINDS: MoteKind[] = ["told", "guessed", "rule", "private"];
export const MOTES_ALL_KINDS = MOTE_KINDS.map((kind, i) => ({ id: `mote-${i}`, kind }));
export const MOTES_OVER_CAP = Array.from({ length: 60 }, (_, i) => ({ id: `cap-${i}`, kind: MOTE_KINDS[i % 4] }));

export const KNOWN_ITEMS: KnownItem[] = [
  { id: "k-rule", area: "Food and health", text: "Sam: no peanuts", from: "You said so on a call", guessed: false, hardRule: true },
  { id: "k-time", area: "Time and work", text: "Late meetings on Thursdays", from: "Calendar", guessed: false, hardRule: false },
  { id: "k-food", area: "Food and health", text: "You like spicy food", from: "Guessed from orders", guessed: true, hardRule: false },
  { id: "k-money", area: "Money", text: "Saving for a bike", from: "Call on Monday", guessed: false, hardRule: false },
  { id: "k-people", area: "People", text: "Sam is your partner", from: "Call on Monday", guessed: false, hardRule: false },
  { id: "k-goals", area: "Goals", text: "Run a 10k in spring", from: "Notes", guessed: true, hardRule: false },
];

export const LAB: LabProps = {
  counters: [
    { id: "read", label: "Read emails", value: 128 },
    { id: "guessed", label: "Guessed private things", value: 3 },
    { id: "said", label: "Said", value: null },
  ],
  limits: ["I can't read texts yet.", "Bank data is a day behind."],
};

export const RECEIPT: ReceiptProps = {
  blocked: true,
  cleaned: true,
  kept: [{ kind: "safety rule", count: 1 }],
  touched: [
    { kind: "conversation turns", count: 3 },
    { kind: "memories", count: 2 },
    { kind: "sources", count: 1 },
  ],
};

/** Thu 6:00 PM in Chicago. */
export const TIME_BADGE: TimeBadgeProps = { simulated: true, instantMs: Date.UTC(2026, 10, 6, 0, 0, 0), zone: "America/Chicago" };

export const CHIPS = ["What do you know about me?", "What's on tonight?", "Forget that"] as const;

export const CAPTION_LINE = { id: "cap-1", text: "Pip sounds like a good dog." };

export const TURN_COPIES: TurnCopies = {
  reply: "Pip it is.",
  caption: CAPTION_LINE,
  typedText: "my dog is called Pip",
  cards: [CARDS[4]],
  jarItems: KNOWN_ITEMS.slice(0, 2),
};

export const REPLY_ENTRIES = [
  { role: "user" as const, text: "my dog is called Pip" },
  { role: "franki" as const, text: "Pip it is." },
];
