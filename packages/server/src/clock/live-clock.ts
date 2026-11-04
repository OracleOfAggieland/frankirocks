import { type ClockPair, type ClockPort, livePair } from "@franki/core";

/**
 * The live Clock_Port. This file is on the clock allow-list (scripts/clock-allowlist.json):
 * it is the only Server_Library file that reads the wall clock.
 * One read feeds both clocks, so worldClock.now === opsClock.now (contracts §1: live world=ops).
 */
export function liveClock(zone = "UTC"): ClockPair {
  return livePair(Date.now(), zone);
}

export const liveClockPort: ClockPort = { read: () => liveClock() };
