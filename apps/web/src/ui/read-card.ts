import type { Card } from "@franki/core";
import type { CardProps } from "./surface-props";

/** The same card can arrive with a tool reply or on a later session poll. */
export function readCardProps(card: Card, id: string): Extract<CardProps, { kind: "read" }> {
  return {
    kind: "read", id, title: card.title, lines: [...card.lines], sources: [], onOpenSource: () => {},
    ...("citations" in card ? { citationsByLine: [card.citations] } : {}),
  };
}
