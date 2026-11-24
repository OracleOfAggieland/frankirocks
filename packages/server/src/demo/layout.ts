/**
 * Where a demo fixture's lines fall in time (brief 054, R12.7). The simulators date every line exactly as
 * `seed/build.ts` does, from the visit's world start and zone, which the simulator token carries. So a seeded row and
 * its simulated twin fall on the same instant and civil date. Pure: no clock is read; the world start is the token's.
 */
import { FIXTURES } from "../seed/persona";
import { localDate, relInstant } from "../seed/clock";
import type { DemoProfile, RelTime, SeedFixture } from "../seed/fixture";
import type { SimToken } from "./token";

export interface SimLayout {
  /** A fixture that has `demo`. */
  fixture: SeedFixture;
  demo: DemoProfile;
  zone: string;
  worldStart: number;
  /** `localDate(worldStart, zone)`: the clone's Friday. */
  friday: string;
  /** `relInstant(friday, rel, zone)`, as the seed builder places a line. */
  at(rel: RelTime): number;
}

/** The layout a token names, or null when it names no fixture, or one with no demo profile. */
export function layoutOf(t: SimToken, fixtures: ReadonlyMap<string, SeedFixture> = FIXTURES): SimLayout | null {
  const fixture = fixtures.get(t.fixtureId);
  if (fixture === undefined || fixture.demo === undefined) return null;
  const friday = localDate(t.worldStart, t.zone);
  return { fixture, demo: fixture.demo, zone: t.zone, worldStart: t.worldStart, friday, at: (rel) => relInstant(friday, rel, t.zone) };
}
