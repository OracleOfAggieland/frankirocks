import { describe, expect, it } from "vitest";
import { createBrowserClock } from "./clock";

function fakeMonotonic(timeOrigin: number) {
  let t = 0;
  return { source: { timeOrigin, now: () => t }, advance: (ms: number) => (t += ms) };
}

describe("browser Clock_Port", () => {
  it("reads one instant into both clocks (live world = ops)", () => {
    const m = fakeMonotonic(1_800_000_000_000);
    const clock = createBrowserClock({ zone: "America/Chicago", monotonic: m.source });
    m.advance(250);
    expect(clock.read()).toEqual({ worldClock: { now: 1_800_000_000_250, zone: "America/Chicago" }, opsClock: { now: 1_800_000_000_250 } });
  });

  it("aligns to a server instant at the middle of the round trip", () => {
    const m = fakeMonotonic(1_800_000_000_000);
    const clock = createBrowserClock({ zone: "UTC", monotonic: m.source });
    const sentAt = clock.mono();
    m.advance(200);
    // The server stamped its time 100 ms into the round trip; its clock runs 5 s ahead of the local one.
    clock.syncToServer(1_800_000_005_100, sentAt, clock.mono());
    expect(clock.offsetMs()).toBe(5000);
    expect(clock.read().opsClock.now).toBe(1_800_000_005_200);
    m.advance(1000);
    expect(clock.read().opsClock.now).toBe(1_800_000_006_200);
  });

  it("ignores a sync with a backwards round trip", () => {
    const m = fakeMonotonic(0);
    const clock = createBrowserClock({ zone: "UTC", monotonic: m.source });
    clock.syncToServer(10_000, 50, 10);
    expect(clock.offsetMs()).toBe(0);
  });
});
