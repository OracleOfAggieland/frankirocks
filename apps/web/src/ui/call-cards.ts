// Brief 044, item 1: the cards a tool answer brings during a call, and when they may be shown. Pure.
//
// The voice machine stays pure and never carries card content: the Voice_Client passes a tool answer's cards to the
// screen through `toolCardsThatFit`, and the tool output to the machine. A card is shown only while its stamp still
// fits the call: the same Session and generation as the call's current one, and no narrowing since it was asked.
// The server decides what a card may hold (company, an unknown audience); this file adds and removes no content.
import type { Card, Infer, Stamp, ToolResponse, VoiceState } from "@franki/core";
import type { CardProps } from "./surface-props";

type Call = Pick<VoiceState, "phase" | "session" | "deck">;

/**
 * The cards to show from one tool answer, or none. `sent` is the stamp the tool request carried. Fails closed: an
 * answer that is not `ready`, has no result, or whose request or answer names another Session or generation than
 * the call's current one (a swap, a narrowing that swapped, a hang-up) shows nothing. So does one asked before the
 * call's Deck raised its policy revision or epoch (a narrowing seen before the swap).
 */
export function toolCardsThatFit(call: Call, sent: Stamp, res: Infer<typeof ToolResponse>): readonly Card[] {
  if (res.status !== "ready" || res.result === null || !("cards" in res.result)) return [];
  const session = call.session;
  if (call.phase === "CLOSED" || session === null) return [];
  const fits = (s: Stamp) => s.sessionId === session.sessionId && s.generation === session.generation;
  if (!fits(sent) || !fits(res.stamp)) return [];
  if (call.deck !== null && (call.deck.policyRev > sent.policyRev || call.deck.epoch > sent.epoch)) return [];
  return res.result.cards;
}

/** The call cards on the screen: the tool answer's cards and the call they came in. */
export interface ShownCallCards {
  key: string;
  sessionId: string;
  generation: number;
  cards: readonly Card[];
}

/** The call's cards as read cards: their title and lines, no actions and no sources to open (as a proactive line's). */
export function callCardProps(shown: ShownCallCards | null): CardProps[] {
  if (shown === null) return [];
  return shown.cards
    .filter((c) => c.title.trim() !== "" || c.lines.some((l) => l.trim() !== ""))
    .map((c) => ({ kind: "read" as const, id: `call-${shown.key}-${c.id}`, title: c.title, lines: [...c.lines], sources: [], onOpenSource: () => {} }));
}

/**
 * Whether the shown call cards still belong on the screen as the call moves on. They leave the way a proactive
 * line's cards do (replaced by the next, cleared by a reset, a forget or sign-out), and also, failing closed, when
 * the call is on another Session or generation: a swap, a narrowing, or a new call.
 */
export function callCardsStay(shown: ShownCallCards, call: Pick<VoiceState, "session">): boolean {
  const s = call.session;
  return s === null || (s.sessionId === shown.sessionId && s.generation === shown.generation);
}
