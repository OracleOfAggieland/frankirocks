/**
 * Brief 049 part A: holds what the call's last state poll said of the owner's errands (the running word and the
 * cards), for the stage and the Card_Dock. Cleared when the call moves to another Session or generation, on a reset,
 * on a completed forget (App's `forget`) or on sign-out; between calls only the running word goes.
 *
 * Review fix V6: an answer with no `errands` view (the server ran out of its poll's budget) keeps what is shown; an
 * answer that no longer lists a card (dropped, expired or forgotten on the server) removes it at once; and a card no
 * poll has listed for `ERRAND_SHELF_KEEP_MS` goes by itself, so one left between calls does not stay for good.
 */
import { ERRAND_CARD_KEEP_MS, type ErrandsView, type SS, type VoiceState } from "@franki/core";
import { NO_ERRANDS_SHOWN, type ShownErrands, shownErrands } from "../ui/errands/errand-view";

/** How long a card stays on the shelf after the last poll that listed it: the server's own card window. */
export const ERRAND_SHELF_KEEP_MS = ERRAND_CARD_KEEP_MS;

const same = (a: ShownErrands, b: ShownErrands) => a.sessionId === b.sessionId && a.generation === b.generation && JSON.stringify([a.running, a.cards]) === JSON.stringify([b.running, b.cards]);

export interface ErrandShelfDeps {
  /** Monotonic milliseconds (the app passes `clock.mono()`). */
  now: () => number;
  /** Runs `fn` after `ms`; returns a cancel. */
  setTimer: (fn: () => void, ms: number) => () => void;
}

/** The timer the app uses; the clock is always passed in (the app passes `clock.mono()`). */
const DEFAULT_TIMER: Pick<ErrandShelfDeps, "setTimer"> = {
  setTimer: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export class ErrandShelf {
  private shown: ShownErrands = NO_ERRANDS_SHOWN;
  private seenAt = new Map<string, number>();
  private cancel: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private readonly deps: ErrandShelfDeps;

  constructor(deps: Pick<ErrandShelfDeps, "now"> & Partial<ErrandShelfDeps>) {
    this.deps = { ...DEFAULT_TIMER, ...deps };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ShownErrands => this.shown;

  /** A state poll's answer for the call's own Session and generation. No view: keep what is shown. */
  onState(stamp: Pick<SS, "sessionId" | "generation">, view: ErrandsView | undefined): void {
    if (view === undefined && stamp.sessionId === this.shown.sessionId && stamp.generation === this.shown.generation) return;
    const next = shownErrands(stamp, view);
    const now = this.deps.now();
    this.seenAt = new Map(next.cards.map((c) => [c.id, now]));
    if (!same(next, this.shown)) this.set(next);
    this.arm();
  }

  /** Told every call state: what belongs to a Session or generation the call has left goes. */
  onVoice(call: Pick<VoiceState, "session">): void {
    const s = call.session;
    if (this.shown === NO_ERRANDS_SHOWN) return;
    if (s !== null && (s.sessionId !== this.shown.sessionId || s.generation !== this.shown.generation)) this.clear();
    // Between calls nothing polls: the running word goes, and the cards stay until they expire.
    else if (s === null && this.shown.running.length > 0) this.set({ ...this.shown, running: [] });
  }

  clear(): void {
    this.seenAt.clear();
    this.cancel?.();
    this.cancel = null;
    if (this.shown !== NO_ERRANDS_SHOWN) this.set(NO_ERRANDS_SHOWN);
  }

  /** Removes the cards past their keep, then waits for the next one to be due. */
  private sweep = (): void => {
    this.cancel = null;
    const now = this.deps.now();
    const kept = this.shown.cards.filter((c) => now - (this.seenAt.get(c.id) ?? now) < ERRAND_SHELF_KEEP_MS);
    if (kept.length !== this.shown.cards.length) {
      for (const c of this.shown.cards) if (!kept.includes(c)) this.seenAt.delete(c.id);
      this.set(kept.length === 0 && this.shown.running.length === 0 ? NO_ERRANDS_SHOWN : { ...this.shown, cards: kept });
    }
    this.arm();
  };

  private arm(): void {
    this.cancel?.();
    this.cancel = null;
    if (this.seenAt.size === 0) return;
    const due = Math.min(...this.seenAt.values()) + ERRAND_SHELF_KEEP_MS - this.deps.now();
    this.cancel = this.deps.setTimer(this.sweep, Math.max(0, due));
  }

  private set(next: ShownErrands): void {
    this.shown = next;
    for (const l of this.listeners) l();
  }
}
