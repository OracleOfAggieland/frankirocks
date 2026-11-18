// A proactive line from the time bolt, shown the way a typed reply shows (brief 027): its words on the Reply_Line,
// its cards in the Card_Dock. Pure.
import type { Card } from "@franki/core";
import type { ReplyEntry } from "../turn-copies";
import type { CardProps } from "../surface-props";
import { readCardProps } from "../read-card";

/** A shown proactive line: its words, its cards, and how many typed entries there were when it came. */
export interface ShownProactive {
  key: string;
  text: string;
  cards: readonly Card[];
  atEntries: number;
}

/**
 * The entries the Reply_Line reads. A proactive line is the latest reply until the next typed line: it rides after
 * an empty user entry, so the earlier reply does not join it and the capsule remounts.
 */
export function replyEntries<E extends ReplyEntry>(typed: readonly E[], shown: ShownProactive | null): readonly ReplyEntry[] {
  if (shown === null || typed.length !== shown.atEntries || shown.text.trim() === "") return typed;
  return [...typed, { role: "user", text: "" }, { role: "franki", text: shown.text }];
}

/** Spoken reply cards as they appear in the dock. */
export function proactiveCards(shown: ShownProactive | null): CardProps[] {
  if (shown === null) return [];
  return shown.cards
    .filter((c) => c.title.trim() !== "" || c.lines.some((l) => l.trim() !== ""))
    .map((c) => readCardProps(c, `proactive-${c.id}`));
}
