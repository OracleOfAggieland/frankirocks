/**
 * The browser Clock_Port (R6; design "Time"). This file is on the clock allow-list (scripts/clock-allowlist.json):
 * it is the only Browser_Client file that reads time. opsClock is a monotonic read (`performance.timeOrigin +
 * performance.now()`) plus an offset to the server's opsClock, learned from server instants seen in responses.
 * While clockMode is live, worldClock.now equals opsClock.now (contracts §1 Clocks), as on the server.
 */
import { type ClockPair, type ClockPort, livePair } from "@franki/core";

export interface MonotonicSource {
  /** Milliseconds since the Unix epoch at the page's time origin. */
  timeOrigin: number;
  /** Milliseconds since the time origin; never goes backwards. */
  now(): number;
}

export interface BrowserClock extends ClockPort {
  /** Local monotonic time in ms (for round-trip timing; not an opsClock value). */
  mono(): number;
  /**
   * Aligns opsClock with a server opsClock instant carried in a response. `sentAt` and `receivedAt` are `mono()`
   * values around the request; the server instant is taken to fall at the middle of the round trip.
   */
  syncToServer(serverOpsMs: number, sentAt: number, receivedAt: number): void;
  /** The current offset added to the local reading, in ms. */
  offsetMs(): number;
}

export interface BrowserClockOptions {
  zone?: string;
  monotonic?: MonotonicSource;
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function createBrowserClock(options: BrowserClockOptions = {}): BrowserClock {
  const source: MonotonicSource = options.monotonic ?? { timeOrigin: performance.timeOrigin, now: () => performance.now() };
  const zone = options.zone ?? browserZone();
  let offset = 0;
  const mono = () => source.now();
  const local = () => source.timeOrigin + source.now();
  return {
    read(): ClockPair {
      return livePair(Math.round(local() + offset), zone);
    },
    mono,
    syncToServer(serverOpsMs, sentAt, receivedAt) {
      if (!Number.isFinite(serverOpsMs) || !(receivedAt >= sentAt)) return;
      const localAtServerInstant = source.timeOrigin + sentAt + (receivedAt - sentAt) / 2;
      offset = serverOpsMs - localAtServerInstant;
    },
    offsetMs: () => offset,
  };
}
