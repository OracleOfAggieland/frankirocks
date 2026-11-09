/**
 * A virtual clock for the fake transport (brief 006 item 4): timers fire in order of their virtual due time, and
 * time jumps straight to the next timer once all pending promise work has settled. A dry run of 60 lines that
 * would take minutes in real time finishes at once, with the same timings on every run.
 */
import type { HarnessClock } from "./clock";

interface Timer {
  at: number;
  seq: number;
  fn: () => void;
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

export class VirtualClock implements HarnessClock {
  private t = 0;
  private seq = 0;
  private timers: Timer[] = [];

  now(): number {
    return this.t;
  }

  setTimer(ms: number, fn: () => void): unknown {
    const timer = { at: this.t + Math.max(0, ms), seq: this.seq++, fn };
    this.timers.push(timer);
    return timer;
  }

  clearTimer(handle: unknown): void {
    this.timers = this.timers.filter((t) => t !== handle);
  }

  /** Drives timers until `work` settles, and returns its result. Throws if work waits with no timer left. */
  async run<T>(work: Promise<T>): Promise<T> {
    let done = false;
    const tracked = work.finally(() => {
      done = true;
    });
    tracked.catch(() => {});
    while (!done) {
      await settle();
      if (done) break;
      if (this.timers.length === 0) {
        await settle();
        if (done) break;
        if (this.timers.length === 0) throw new Error("virtual clock: work is waiting but no timer is set");
        continue;
      }
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers.shift()!;
      this.t = next.at;
      next.fn();
    }
    return tracked;
  }
}
