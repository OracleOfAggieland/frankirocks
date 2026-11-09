import { describe, expect, it } from "vitest";
import { badgeTime } from "./format-time";

// 2026-11-05T23:00:00Z is a Thursday.
const THU_23_UTC = Date.UTC(2026, 10, 5, 23, 0, 0);

describe("badgeTime", () => {
  it("formats the instant in the supplied zone", () => {
    expect(badgeTime(THU_23_UTC, "America/Chicago")).toBe("Thu 5:00 PM");
    expect(badgeTime(THU_23_UTC, "Europe/Berlin")).toBe("Fri 12:00 AM");
    expect(badgeTime(THU_23_UTC, "UTC")).toBe("Thu 11:00 PM");
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(badgeTime(THU_23_UTC, "Not/AZone")).toBe("Thu 11:00 PM");
  });
});
