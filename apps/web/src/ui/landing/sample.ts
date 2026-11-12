// The sample month the front door's stage acts out (brief 015, package H2). Sample data appears only on the front
// door, under the "Sample data" plate; nothing in the lab imports this file. Every number traces to rows here:
// the six takeout purchases add up to $186.
import type { CardProps, KnownItem, LabProps, MoteKind, ReceiptProps, SourceTag } from "../surface-props";

export type TagId = "bank" | "calendar";
export type CardId = "takeout" | "dinners" | "list" | "weeks";

/** One row behind a source tag. The same shape as SourceRows' rows. */
export interface SampleRow {
  id: string;
  when: string;
  what: string;
  amount: string;
}

export const SAMPLE_TAGS: Readonly<Record<TagId, SourceTag>> = {
  bank: { id: "bank", label: "Bank · 6 purchases" },
  calendar: { id: "calendar", label: "Calendar · 4 meetings" },
};

/** The six takeout purchases this month. */
export const TAKEOUT_ROWS: readonly SampleRow[] = [
  { id: "t1", when: "Tue 3", what: "Noodle bar", amount: "$30" },
  { id: "t2", when: "Thu 5", what: "Burrito shop", amount: "$28" },
  { id: "t3", when: "Mon 9", what: "Pizza", amount: "$34" },
  { id: "t4", when: "Thu 12", what: "Thai kitchen", amount: "$34" },
  { id: "t5", when: "Sat 14", what: "Falafel stand", amount: "$24" },
  { id: "t6", when: "Thu 19", what: "Curry house", amount: "$36" },
];

/** The rows behind each source of each card, by card ID and then source ID. */
export const SAMPLE_ROWS: Readonly<Record<string, Readonly<Record<string, readonly SampleRow[]>>>> = {
  takeout: { bank: TAKEOUT_ROWS },
};

const WEEKS_TAG: SourceTag = { id: "bank-weeks", label: "Bank · 3 weeks" };

export const GROCERY_LIST: readonly string[] = ["Chicken thighs", "Brown rice", "Bell peppers", "Black beans", "Corn tortillas", "Chili flakes"];

export interface CardHandlers {
  onYes: () => void;
  onNotNow: () => void;
  onOpenSource: (id: string) => void;
}

/** The card behind each ID, with the stage's handlers. */
export function sampleCard(id: CardId, h: CardHandlers): CardProps {
  switch (id) {
    case "takeout":
      return {
        kind: "source",
        id,
        title: "Takeout nights",
        body: "Mostly on nights with meetings after 6.",
        figures: [
          { label: "This month", value: "$186", sourceId: "bank" },
          { label: "Late meetings", value: "4", sourceId: "calendar" },
        ],
        sources: [SAMPLE_TAGS.bank, SAMPLE_TAGS.calendar],
        onOpenSource: h.onOpenSource,
      };
    case "dinners":
      return {
        kind: "approval",
        id,
        title: "Three quick dinners",
        effect: "I'll plan three quick dinners for your late-meeting nights and add the groceries to your list.",
        sources: [],
        onYes: h.onYes,
        onNotNow: h.onNotNow,
        onOpenSource: h.onOpenSource,
      };
    case "list":
      return { kind: "read", id, title: "Your list", lines: [...GROCERY_LIST], sources: [], onOpenSource: h.onOpenSource };
    case "weeks":
      return {
        kind: "source",
        id,
        title: "Three weeks on",
        body: "$71, down from $186 over the same three weeks.",
        figures: [{ label: "Takeout", value: "$115 less", sourceId: WEEKS_TAG.id }],
        sources: [WEEKS_TAG],
        onOpenSource: h.onOpenSource,
      };
  }
}

/** The strip's last terminal. */
export const STRIP_RESULT = "$115 less";

/** The item the visitor watches Franki forget. */
export const FORGOTTEN_ID = "brother";

/**
 * What Franki knows on the sample month: one of each kind the jar draws (a rule, something told, a guess, and the
 * private item the forget step removes), few enough that the whole sheet fits beside Franki on the stage.
 */
export const KNOWN_ITEMS: readonly KnownItem[] = [
  { id: "shellfish", area: "Food and health", text: "You: no shellfish", from: "you", guessed: false, hardRule: true },
  { id: "late-meetings", area: "Time and work", text: "Late meetings on Thursdays", from: "Calendar", guessed: false, hardRule: false },
  { id: "spicy", area: "Food and health", text: "You like spicy food", from: "your food orders", guessed: true, hardRule: false },
  { id: FORGOTTEN_ID, area: "People", text: "Your brother is having a hard time", from: "a conversation", guessed: false, hardRule: false },
];

/** Pure. The jar's mote for a known item: brass for a rule, dashed for a guess, frosted for something private. */
export function moteKindOf(item: KnownItem): MoteKind {
  if (item.hardRule) return "rule";
  if (item.guessed) return "guessed";
  if (item.area === "People") return "private";
  return "told";
}

export const KNOWN_MOTES: readonly { id: string; kind: MoteKind }[] = KNOWN_ITEMS.map((i) => ({ id: i.id, kind: moteKindOf(i) }));

export const LAB_COUNTERS: LabProps["counters"] = [
  { id: "read", label: "Read emails", value: 128 },
  { id: "guessed", label: "Guessed private things", value: 3 },
  { id: "said", label: "Said", value: null },
];

export const SAMPLE_RECEIPT: ReceiptProps = {
  blocked: true,
  cleaned: true,
  kept: [{ kind: "safety rule", count: 1 }],
  touched: [
    { kind: "conversation turns", count: 1 },
    { kind: "memories", count: 1 },
  ],
};
