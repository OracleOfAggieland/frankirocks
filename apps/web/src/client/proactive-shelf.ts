/** Holds the last proactive line the time bolt brought, for the Reply_Line and the Card_Dock (brief 027). */
import type { Proactive } from "@franki/core";
import type { ShownProactive } from "../ui/visit/proactive-view";

export class ProactiveShelf {
  private shown: ShownProactive | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ShownProactive | null => this.shown;

  /** `atEntries`: how many typed entries the conversation holds now. */
  show(p: Proactive, atEntries: number): void {
    this.set({ key: p.turnId, text: p.whisper.text, cards: p.cards, atEntries });
  }

  clear(): void {
    if (this.shown !== null) this.set(null);
  }

  private set(next: ShownProactive | null): void {
    this.shown = next;
    for (const l of this.listeners) l();
  }
}
