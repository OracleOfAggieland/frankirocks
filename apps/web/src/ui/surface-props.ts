// Surface props (lab-ui-foundation R15, R16, R17.5; design "Data Models"). Browser-side props only:
// nothing here is a Record, written to Firestore or sent on the wire. Type-only module.

/** "Bank · 6 purchases" */
export interface SourceTag {
  id: string;
  label: string;
}

/** A hard rule, shown with a Seal. */
export interface HardRule {
  id: string;
  person: string;
  text: string;
}

interface CardBase {
  id: string;
  title: string;
  sources: SourceTag[];
  onOpenSource: (id: string) => void;
}

export type CardProps =
  | (CardBase & { kind: "source"; body: string; figures: { label: string; value: string; sourceId: string }[] })
  | (CardBase & { kind: "approval"; effect: string; onYes: () => void; onNotNow: () => void })
  | (CardBase & {
      kind: "food";
      choice: string;
      ingredients: string[];
      checkedFor: { person: string; rules: HardRule[] }[];
      onRemoveRule?: (id: string) => void;
    })
  | (CardBase & { kind: "ask"; question: string; options: { id: string; label: string }[]; onAnswer: (id: string) => void })
  | (CardBase & { kind: "read"; lines: string[] });

export type CardKind = CardProps["kind"];

export interface StripProps {
  open: boolean;
  filled: 0 | 1 | 2 | 3 | 4 | 5;
  resultLabel: string;
}

export type MoteKind = "told" | "guessed" | "rule" | "private";

/** At most JAR_CAP motes are drawn. */
export interface JarProps {
  motes: { id: string; kind: MoteKind }[];
  onOpen: () => void;
}

export type Area = "Time and work" | "Food and health" | "Money" | "People" | "Goals";

export interface KnownItem {
  id: string;
  area: Area;
  text: string;
  from: string;
  guessed: boolean;
  hardRule: boolean;
}

export interface WhatIKnowProps {
  items: KnownItem[];
  onWrong: (id: string) => void;
  onForget: (id: string) => void;
  onQuiet: (id: string) => void;
  onClose: () => void;
}

export interface LabProps {
  counters: { id: string; label: string; value: number | null }[];
  limits: string[];
}

/** Kinds and counts only, never text of a forgotten item (R16.7). */
export interface ReceiptProps {
  /** forgetReceipt.blockedAt != null */
  blocked: boolean;
  /** forgetReceipt.cleanupCompleteAt != null */
  cleaned: boolean;
  /** From retainedRuleIds.length. */
  kept: { kind: "safety rule"; count: number }[];
  /** From touched[]: collection mapped to a plain kind label. */
  touched: { kind: ReceiptKind; count: number }[];
}

export type ReceiptKind = "conversation turns" | "memories" | "sources" | "other records";

export interface TimeBadgeProps {
  simulated: boolean;
  instantMs: number;
  zone: string;
}

export interface CaptionsProps {
  on: boolean;
  line: { id: string; text: string } | null;
  onToggle: () => void;
}

export interface ChipsProps {
  chips: readonly string[];
  disabled: boolean;
  onChip: (text: string) => void;
}

export interface TurnCopies {
  reply: string | null;
  caption: { id: string; text: string } | null;
  typedText: string;
  cards: CardProps[];
  jarItems: KnownItem[];
}
