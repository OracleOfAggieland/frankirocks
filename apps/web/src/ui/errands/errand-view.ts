/**
 * Brief 049 part A, rulings 11 and 12: what the screen shows of the owner's errands, from the state poll's `errands`
 * view. Pure. The running word is S0 and names only what is being looked through; the cards are the server's,
 * already gated, each line with its source.
 */
import type { Card, ErrandAbout, ErrandsView, SS } from "@franki/core";
import type { CardProps } from "../surface-props";
import { COPY } from "../copy";

export interface ShownErrands {
  sessionId: string;
  generation: number;
  running: readonly ErrandAbout[];
  cards: readonly Card[];
}

export const NO_ERRANDS_SHOWN: ShownErrands = { sessionId: "", generation: 0, running: [], cards: [] };

/** The poll's view as the screen holds it, for the Session that answered. */
export function shownErrands(stamp: Pick<SS, "sessionId" | "generation">, view: ErrandsView | undefined): ShownErrands {
  return { sessionId: stamp.sessionId, generation: stamp.generation, running: view?.running ?? [], cards: view?.cards ?? [] };
}

/** The word on the stage while an errand runs, or null. */
export function errandWord(shown: ShownErrands): string | null {
  const mail = shown.running.includes("mail");
  const calendar = shown.running.includes("calendar");
  if (mail && calendar) return COPY.errands.running.both;
  if (mail) return COPY.errands.running.mail;
  if (calendar) return COPY.errands.running.calendar;
  return null;
}

/** The errands' cards for the Card_Dock. No links: a source is a line of text. */
export function errandCardProps(shown: ShownErrands): CardProps[] {
  return shown.cards
    .filter((c) => c.title.trim() !== "" || c.lines.some((l) => l.trim() !== ""))
    .map((c) => ({ kind: "read" as const, id: `errand-${c.id}`, title: c.title, lines: [...c.lines], sources: [], onOpenSource: () => {} }));
}
