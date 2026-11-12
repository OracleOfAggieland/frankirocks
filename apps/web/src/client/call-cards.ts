/** Holds the cards the last tool answer of a call brought, for the Card_Dock (brief 044, item 1). */
import type { Card, Stamp, VoiceState } from "@franki/core";
import { type ShownCallCards, callCardsStay } from "../ui/call-cards";

export class CallCardShelf {
  private shown: ShownCallCards | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ShownCallCards | null => this.shown;

  /** A tool answer's cards that already fit the call (`toolCardsThatFit`). An answer with no cards changes nothing. */
  show(cards: readonly Card[], stamp: Stamp): void {
    if (cards.length === 0) return;
    this.set({ key: stamp.turnId, sessionId: stamp.sessionId, generation: stamp.generation, cards });
  }

  /** Told every call state: cards from a Session or generation the call has left go. */
  onVoice(call: Pick<VoiceState, "session">): void {
    if (this.shown !== null && !callCardsStay(this.shown, call)) this.set(null);
  }

  clear(): void {
    if (this.shown !== null) this.set(null);
  }

  private set(next: ShownCallCards | null): void {
    this.shown = next;
    for (const l of this.listeners) l();
  }
}
