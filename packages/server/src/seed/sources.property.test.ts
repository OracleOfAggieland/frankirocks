/**
 * Sources hold (brief 019 "Sources hold"; spec §10 hero fixture). For any visitor zone and any clock, after the load:
 * every number the hero pattern uses traces to named bank and calendar rows. The window is 21 local dates with at
 * least 14 covered; six posted takeout purchases total exactly $186.00; exactly four of them, $126.00, fall on nights
 * with an accepted, timed, busy meeting at or after 18:00, each with an evening purchase time, and each names that
 * meeting's calendar row.
 *
 * Runs: RUNS (each case loads the persona once, about 0.2 s).
 */
import type { Evidence } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testRig } from "../testing/fakes";
import { SEED_ZONES, evidenceOf } from "../testing/seed";
import { addDays, cloneWorldStart, localDate } from "./clock";
import { heroSources } from "./hero-check";
import { loadSeed } from "./load";
import { PERSONA } from "./persona";

const RUNS = 40;
const UID = "owner-1";
const YEAR_MS = 365 * 86_400_000;
const OPS_FROM = Date.UTC(2026, 0, 1);
const LATE_TITLES = ["Ops review: West Coast carriers", "Vendor call: Marrow Line Shipping", "Quarter planning", "Carrier escalation call"];

describe("the hero's sources hold", () => {
  it("$186 in the window, four late-meeting nights for $126, every number on named rows", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...SEED_ZONES), fc.integer({ min: OPS_FROM, max: OPS_FROM + 2 * YEAR_MS }), async (zone, now) => {
        const rig = testRig();
        rig.clock.advance(Math.max(0, now - rig.clock.read().opsClock.now));
        const worldStart = cloneWorldStart(rig.clock.read().opsClock.now, zone);
        const rows = await loadSeed(rig.deps, UID, { fixture: PERSONA, namespace: rig.deps.hasher.id(["ns", now]), zone, worldStart, core: { epoch: 1, policyRev: 1 } });
        const friday = localDate(worldStart, zone);
        expect(rows.window).toEqual({ from: addDays(friday, -21), to: addDays(friday, -1) });
        const evidence = await evidenceOf(rig.store, UID);
        const byId = new Map(evidence.map((e) => [e.id, e.data] as [string, Evidence]));
        const hero = heroSources(evidence, rows.window, zone);
        expect(hero.coveredDates).toBeGreaterThanOrEqual(14);
        expect(hero.purchases.map((p) => p.cents).sort((a, b) => a - b)).toEqual([2400, 2800, 3000, 3400, 3400, 3600]);
        expect(hero.totalCents).toBe(18_600);
        expect(hero.lateCount).toBe(4);
        expect(hero.lateCents).toBe(12_600);
        for (const p of hero.purchases) {
          const bank = byId.get(p.eid)!;
          expect(bank.kind).toBe("transaction");
          expect(bank.title).not.toBeNull();
          if (p.meetingEid === null) continue;
          const meeting = byId.get(p.meetingEid)!;
          expect(meeting.kind).toBe("calendar");
          expect(LATE_TITLES).toContain(meeting.title);
        }
        expect(new Set(hero.purchases.filter((p) => p.meetingEid !== null).map((p) => p.meetingEid)).size).toBe(4);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);
});
