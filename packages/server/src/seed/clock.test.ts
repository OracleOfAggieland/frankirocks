import { describe, expect, it } from "vitest";
import { CLONE_MINUTE, addDays, cloneWorldStart, localDate, localInstant, localMinute, weekdayOf } from "./clock";

const ms = (iso: string) => Date.parse(iso);

describe("seed clock", () => {
  it("the clone starts on the latest Friday 08:40 at or before now", () => {
    // Wednesday 2026-11-11 15:00 New York: last Friday is 2026-11-06.
    const start = cloneWorldStart(ms("2026-11-11T20:00:00Z"), "America/New_York");
    expect(localDate(start, "America/New_York")).toBe("2026-11-06");
    expect(localMinute(start, "America/New_York")).toBe(CLONE_MINUTE);
  });

  it("on a Friday before 08:40 it goes back a week, and at 08:40 exactly it is today", () => {
    const zone = "Asia/Tokyo";
    expect(localDate(cloneWorldStart(ms("2026-11-12T23:00:00Z"), zone), zone)).toBe("2026-11-06"); // Fri 08:00 JST
    expect(cloneWorldStart(ms("2026-11-12T23:40:00Z"), zone)).toBe(ms("2026-11-12T23:40:00Z")); // Fri 08:40 JST
  });

  it("dates step by calendar day across a DST change", () => {
    expect(addDays("2026-11-06", -7)).toBe("2026-10-30");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOf("2026-11-06")).toBe(5);
    // US clocks fall back on 2026-11-01: 08:40 local stays 08:40 local on both sides.
    for (const d of ["2026-10-30", "2026-11-06"]) expect(localMinute(localInstant(d, CLONE_MINUTE, "America/Chicago"), "America/Chicago")).toBe(CLONE_MINUTE);
  });

  it("a local time inside a spring-forward gap moves forward, never back", () => {
    const zone = "America/New_York";
    const t = localInstant("2026-03-08", 150, zone); // 02:30 does not exist
    expect(localDate(t, zone)).toBe("2026-03-08");
    expect(localMinute(t, zone)).toBeGreaterThanOrEqual(180);
  });
});
