/**
 * Brief 038, new property 2: the first clone is the same as any later one. For any client zone and any ops time, a
 * fresh user's first reset (no open before it, the zone only in the request) and a reset after an open has set the
 * zone give the same rows, the same zone on core/state, the same world clock (Friday 08:40 in that zone), and the
 * seeded interview at 14:00 local on that Friday.
 *
 * Runs: RUNS, over every IANA zone the runtime knows. Each case resets a three-line slice of the persona twice.
 */
import { type CoreState, type Evidence, msFromTs } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ensureCoreDocs } from "../core-docs";
import { paths } from "../store/paths";
import { testRig } from "../testing/fakes";
import { SEED_ZONES, resetFresh, snapshotOf } from "../testing/seed";
import { localDate, localMinute, weekdayOf } from "./clock";
import type { SeedFixture } from "./fixture";
import { FIXTURES, PERSONA } from "./persona";

const RUNS = 1000;
const UID = "visitor-1";
const DAY_MS = 86_400_000;
const FIXTURE_ID = "seed-first-clone-fixture-000000000000000000";
const FIXTURE: SeedFixture = {
  ...PERSONA,
  id: FIXTURE_ID,
  lines: [PERSONA.lines.find((l) => l.kind === "turn")!, PERSONA.lines.find((l) => l.id === "cal-interview")!, PERSONA.lines.find((l) => l.kind === "bank")!],
};
(FIXTURES as Map<string, SeedFixture>).set(FIXTURE_ID, FIXTURE);

const ZONES = [...new Set([...SEED_ZONES, ...Intl.supportedValuesOf("timeZone")])];

async function clone(zone: string, offsetMs: number, openFirst: boolean) {
  const rig = testRig();
  rig.clock.advance(offsetMs);
  // An open before the reset is what set the zone in the tests before brief 038.
  if (openFirst) await ensureCoreDocs(UID, rig.deps, zone);
  const res = await resetFresh(rig, UID, "v1", "r1", zone, FIXTURE_ID);
  expect(res.status).toBe(200);
  const state = (await rig.store.get<CoreState>(UID, paths.core(UID, "state")))!.data;
  const rows = (await snapshotOf(rig.store, UID)).filter(([p]) => !p.includes("/core/"));
  return { res, state, rows };
}

describe("Property: the first clone is the same as any later one (brief 038)", () => {
  it("a first reset with no open lays the clone out in the request's zone, as a later reset does", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ZONES), fc.integer({ min: 0, max: 730 * DAY_MS }), async (zone, offsetMs) => {
        const first = await clone(zone, offsetMs, false);
        const later = await clone(zone, offsetMs, true);
        expect(first.res.body).toEqual(later.res.body);
        expect(first.rows).toEqual(later.rows);
        const pick = (s: CoreState) => ({ currentZone: s.currentZone, homeZone: s.homeZone, clockMode: s.clockMode, worldClock: s.worldClock, coverage: s.coverage });
        expect(pick(first.state)).toEqual(pick(later.state));
        expect(first.state.currentZone).toBe(zone);

        const world = msFromTs(first.state.worldClock!);
        const friday = localDate(world, zone);
        expect(weekdayOf(friday)).toBe(5);
        expect(localMinute(world, zone)).toBe(8 * 60 + 40);
        const interview = first.rows
          .filter(([p]) => p.includes("/evidence/"))
          .map(([, json]) => JSON.parse(json) as Evidence)
          .find((e) => e.isCurrentProvider && e.observation?.kind === "calendar");
        if (interview?.observation?.kind !== "calendar") throw new Error("no current interview row");
        expect(localDate(msFromTs(interview.observation.start), zone)).toBe(friday);
        expect(localMinute(msFromTs(interview.observation.start), zone)).toBe(14 * 60);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);
});
