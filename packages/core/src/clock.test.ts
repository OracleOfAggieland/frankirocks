import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createFakeClock, livePair, withZone } from "./clock";

const T = Date.parse("2026-11-03T12:00:00Z");

describe("fake Clock_Port", () => {
  it("starts at the given world instant, ops instant and zone", () => {
    const clock = createFakeClock({ world: T, ops: T + 5, zone: "America/Chicago" });
    expect(clock.read()).toEqual({ worldClock: { now: T, zone: "America/Chicago" }, opsClock: { now: T + 5 } });
  });

  it("returns the same values on every read until changed", () => {
    const clock = createFakeClock({ world: T, ops: T, zone: "UTC" });
    expect(clock.read()).toEqual(clock.read());
  });

  it("advances opsClock only, by a non-negative amount", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1e7 }), { maxLength: 20 }), (steps) => {
        const clock = createFakeClock({ world: T, ops: T, zone: "UTC" });
        for (const step of steps) clock.advance(step);
        const pair = clock.read();
        expect(pair.opsClock.now).toBe(T + steps.reduce((a, b) => a + b, 0));
        expect(pair.worldClock.now).toBe(T);
      }),
    );
  });

  it("rejects negative or fractional advances", () => {
    const clock = createFakeClock({ world: T, ops: T, zone: "UTC" });
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(0.5)).toThrow(RangeError);
    expect(clock.read().opsClock.now).toBe(T);
  });

  it("sets worldClock separately from opsClock", () => {
    const clock = createFakeClock({ world: T, ops: T, zone: "UTC" });
    clock.setWorld(T + 86_400_000);
    clock.setZone("Europe/London");
    expect(clock.read()).toEqual({ worldClock: { now: T + 86_400_000, zone: "Europe/London" }, opsClock: { now: T } });
  });
});

describe("livePair and withZone", () => {
  it("live world and ops hold the identical instant", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800_000 }), (now) => {
        const pair = livePair(now, "UTC");
        expect(pair.worldClock.now).toBe(pair.opsClock.now);
      }),
    );
  });

  it("withZone changes only the zone", () => {
    const pair = withZone(livePair(T, "UTC"), "Asia/Tokyo");
    expect(pair).toEqual({ worldClock: { now: T, zone: "Asia/Tokyo" }, opsClock: { now: T } });
  });
});
