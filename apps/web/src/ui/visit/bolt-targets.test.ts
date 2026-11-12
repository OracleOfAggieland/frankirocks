import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BOLT_TARGETS_MAX, boltTargets, localInstant } from "./bolt-targets";

const CHI = "America/Chicago";
const FRI_0840 = localInstant(2026, 11, 6, 8, 40, CHI);

describe("boltTargets", () => {
  it("from the clone's Friday 08:40 offers tonight, tomorrow morning, Thursday at 6 PM and three weeks on", () => {
    const t = boltTargets(FRI_0840, CHI);
    expect(t.map((x) => x.label)).toEqual(["Today, 6 PM", "Tomorrow, 9 AM", "Thursday, 6 PM", "Three weeks on"]);
    expect(t[0]!.toMs).toBe(localInstant(2026, 11, 6, 18, 0, CHI));
    expect(t[2]!.toMs).toBe(localInstant(2026, 11, 12, 18, 0, CHI));
    expect(t[3]!.toMs).toBe(FRI_0840 + 21 * 86_400_000);
  });

  it("at 6 PM the evening target is tomorrow's", () => {
    const t = boltTargets(localInstant(2026, 11, 12, 18, 0, CHI), CHI);
    expect(t[0]).toMatchObject({ id: "morning", label: "Tomorrow, 9 AM" });
    expect(t[1]).toMatchObject({ id: "evening", label: "Tomorrow, 6 PM" });
  });

  it("finds a local wall time on both sides of a daylight change", () => {
    // Chicago leaves daylight time on Nov 1, 2026.
    expect(new Date(localInstant(2026, 11, 2, 18, 0, CHI)).toISOString()).toBe("2026-11-03T00:00:00.000Z");
    expect(new Date(localInstant(2026, 10, 30, 18, 0, CHI)).toISOString()).toBe("2026-10-30T23:00:00.000Z");
  });

  it("is empty for a clock that is not a real instant, and falls back to UTC for an unknown zone", () => {
    expect(boltTargets(Number.NaN, "UTC")).toEqual([]);
    expect(boltTargets(Date.UTC(2026, 10, 6, 8, 40), "Not/AZone").map((x) => x.label)[0]).toBe("Today, 6 PM");
  });

  it("for any world clock and zone: every target is after it, sorted, distinct and capped", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }),
        fc.constantFrom("UTC", CHI, "America/Los_Angeles", "Europe/London", "Asia/Kolkata", "Pacific/Auckland", "Australia/Lord_Howe"),
        (world, zone) => {
          const t = boltTargets(world, zone);
          expect(t.length).toBeGreaterThan(0);
          expect(t.length).toBeLessThanOrEqual(BOLT_TARGETS_MAX);
          for (let i = 0; i < t.length; i++) {
            expect(t[i]!.toMs).toBeGreaterThan(world);
            if (i > 0) expect(t[i]!.toMs).toBeGreaterThan(t[i - 1]!.toMs);
          }
          expect(t.at(-1)!.id).toBe("threeWeeks");
        },
      ),
      { numRuns: 500 },
    );
  });
});
