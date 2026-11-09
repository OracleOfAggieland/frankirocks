import { afterEach, describe, expect, it, vi } from "vitest";
import { liveClock, liveClockPort } from "./live-clock";

const T = Date.parse("2026-11-03T12:00:00.123Z");

describe("liveClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes world and ops from one wall-clock read", () => {
    const read = vi.spyOn(Date, "now").mockReturnValueOnce(T).mockReturnValueOnce(T + 1);
    const pair = liveClock("America/Chicago");
    expect(read).toHaveBeenCalledTimes(1);
    expect(pair).toEqual({ worldClock: { now: T, zone: "America/Chicago" }, opsClock: { now: T } });
    read.mockRestore();
  });

  it("defaults the zone to UTC and keeps millisecond precision", () => {
    vi.useFakeTimers({ now: T });
    const pair = liveClockPort.read();
    expect(pair.worldClock.zone).toBe("UTC");
    expect(new Date(pair.opsClock.now).toISOString()).toBe("2026-11-03T12:00:00.123Z");
  });
});
