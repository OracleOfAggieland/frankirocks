/**
 * Clock_Port types (contracts §1 Clocks). Core never reads the wall clock; callers pass a ClockPair in.
 *
 * `now` values are integer milliseconds since the Unix epoch. They serialize to RFC3339 UTC on the wire.
 */
export interface ClockPair {
  /** Semantic time: occurredAt, assertedAt, validity. Equal to opsClock.now while clockMode is "live". */
  worldClock: { now: number; zone: string };
  /** Operational time: createdAt/updatedAt, leases, deadlines, expiries. */
  opsClock: { now: number };
}

/** The injected source of time. Only allow-listed implementations read the wall clock. */
export interface ClockPort {
  read(): ClockPair;
}

/** Builds a live ClockPair from one wall-clock reading, so world and ops hold the identical instant (R6.2). */
export function livePair(nowMs: number, zone: string): ClockPair {
  return { worldClock: { now: nowMs, zone }, opsClock: { now: nowMs } };
}

/** Returns the pair with worldClock.zone replaced (zone comes from core/state.currentZone). */
export function withZone(pair: ClockPair, zone: string): ClockPair {
  return { worldClock: { now: pair.worldClock.now, zone }, opsClock: { now: pair.opsClock.now } };
}

export interface FakeClockInit {
  world: number;
  ops: number;
  zone: string;
}

/** Test Clock_Port (R6.5). Time only moves when the test moves it. */
export interface FakeClock extends ClockPort {
  /** Moves opsClock.now forward by `ms` (a non-negative integer). worldClock is unchanged. */
  advance(ms: number): void;
  /** Sets worldClock.now independently of opsClock. */
  setWorld(nowMs: number): void;
  setZone(zone: string): void;
}

export function createFakeClock(init: FakeClockInit): FakeClock {
  assertInstant(init.world, "world");
  assertInstant(init.ops, "ops");
  let world = init.world;
  let ops = init.ops;
  let zone = init.zone;
  return {
    read: () => ({ worldClock: { now: world, zone }, opsClock: { now: ops } }),
    advance(ms) {
      if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError("advance needs a non-negative integer of ms");
      ops += ms;
    },
    setWorld(nowMs) {
      assertInstant(nowMs, "world");
      world = nowMs;
    },
    setZone(next) {
      zone = next;
    },
  };
}

function assertInstant(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be an integer millisecond instant`);
}
