/**
 * Timers for deadlines and races (design "No route awaits background work it doesn't own"). A deadline is a span
 * of opsClock time, so tests run on virtual time: the fake timers in ../testing/fakes.ts resolve a sleep only when
 * the test moves the fake clock past it.
 */
export interface Timers {
  /** Resolves after `ms` of opsClock time. */
  sleep(ms: number): Promise<void>;
}

/** Live timers. `setTimeout` schedules a callback; it does not read the wall clock. */
export const liveTimers: Timers = {
  sleep: (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, Math.max(0, ms));
      (t as { unref?: () => void }).unref?.();
    }),
};

export class DeadlineError extends Error {
  constructor(readonly ms: number) {
    super(`deadline of ${ms} ms passed`);
    this.name = "DeadlineError";
  }
}

/** Resolves with `work`, or rejects with DeadlineError once `ms` passes. The work itself is not cancelled. */
export function withDeadline<T>(work: Promise<T>, ms: number, timers: Timers): Promise<T> {
  return Promise.race([work, timers.sleep(ms).then(() => Promise.reject(new DeadlineError(ms)))]);
}

/** True when `work` settles within `ms`; false when the limit wins. The work keeps running either way. */
export async function raceLimit(work: Promise<unknown>, ms: number, timers: Timers): Promise<boolean> {
  const done = work.then(
    () => true,
    () => true,
  );
  return Promise.race([done, timers.sleep(ms).then(() => false)]);
}
