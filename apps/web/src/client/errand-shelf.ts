/**
 * Brief 049 part A: holds what the call's last state poll said of the owner's errands (the running word and the
 * cards), for the stage and the Card_Dock. Cleared when the call moves to another Session or generation, on a reset or on sign-out; between calls only
 * the running word goes.
 */
import type { ErrandsView, SS, VoiceState } from "@franki/core";
import { NO_ERRANDS_SHOWN, type ShownErrands, shownErrands } from "../ui/errands/errand-view";

const same = (a: ShownErrands, b: ShownErrands) => a.sessionId === b.sessionId && a.generation === b.generation && JSON.stringify([a.running, a.cards]) === JSON.stringify([b.running, b.cards]);

export class ErrandShelf {
  private shown: ShownErrands = NO_ERRANDS_SHOWN;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ShownErrands => this.shown;

  /** A state poll's answer for the call's own Session and generation. */
  onState(stamp: Pick<SS, "sessionId" | "generation">, view: ErrandsView | undefined): void {
    const next = shownErrands(stamp, view);
    if (!same(next, this.shown)) this.set(next);
  }

  /** Told every call state: what belongs to a Session or generation the call has left goes. */
  onVoice(call: Pick<VoiceState, "session">): void {
    const s = call.session;
    if (this.shown === NO_ERRANDS_SHOWN) return;
    if (s !== null && (s.sessionId !== this.shown.sessionId || s.generation !== this.shown.generation)) this.set(NO_ERRANDS_SHOWN);
    // Between calls nothing polls: the running word goes, and the cards stay as the call's own cards do.
    else if (s === null && this.shown.running.length > 0) this.set({ ...this.shown, running: [] });
  }

  clear(): void {
    if (this.shown !== NO_ERRANDS_SHOWN) this.set(NO_ERRANDS_SHOWN);
  }

  private set(next: ShownErrands): void {
    this.shown = next;
    for (const l of this.listeners) l();
  }
}
