/**
 * The judge spike's live clock (brief 006 item 4). The harness is a tool outside the app, so it reads time here:
 * a monotonic clock (`performance.now()`) for every measured instant, and the wall clock once per run for the
 * date in the output. This is the only spike file listed in scripts/clock-allowlist.json; everything else in
 * scripts/judge-spike takes time from a `HarnessClock`, and the clock check scans the folder.
 */
import { performance } from "node:perf_hooks";

export interface HarnessClock {
  /** Monotonic milliseconds. */
  now(): number;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(handle: unknown): void;
}

export const liveClock: HarnessClock = {
  now: () => performance.now(),
  setTimer: (ms, fn) => setTimeout(fn, Math.max(0, ms)),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The run's date, ISO 8601 UTC, read once for the output file. */
export const wallDateIso = (): string => new Date().toISOString();
