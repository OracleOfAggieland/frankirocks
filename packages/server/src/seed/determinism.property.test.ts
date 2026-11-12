/**
 * Seed determinism (brief 019 "Determinism"). The same fixture, namespace, zone and clock give the same rows, byte
 * for byte, in two separate stores; a different namespace gives the same persona under disjoint Evidence IDs.
 *
 * Runs: RUNS (each case loads the persona three times, about 0.5 s).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testRig } from "../testing/fakes";
import { SEED_ZONES, snapshotOf } from "../testing/seed";
import { cloneWorldStart } from "./clock";
import { loadSeed } from "./load";
import { PERSONA } from "./persona";

const RUNS = 20;
const UID = "owner-1";
const YEAR_MS = 365 * 86_400_000;
const OPS_FROM = Date.UTC(2026, 0, 1);

async function loaded(zone: string, now: number, ns: number) {
  const rig = testRig();
  rig.clock.advance(Math.max(0, now - rig.clock.read().opsClock.now));
  await loadSeed(rig.deps, UID, { fixture: PERSONA, namespace: rig.deps.hasher.id(["ns", ns]), zone, worldStart: cloneWorldStart(rig.clock.read().opsClock.now, zone), core: { epoch: 3, policyRev: 2 } });
  return snapshotOf(rig.store, UID);
}

describe("seed determinism", () => {
  it("same inputs give the same rows; another namespace gives disjoint Evidence IDs", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...SEED_ZONES), fc.integer({ min: OPS_FROM, max: OPS_FROM + 2 * YEAR_MS }), fc.integer({ min: 1, max: 1000 }), async (zone, now, ns) => {
        const a = await loaded(zone, now, ns);
        const b = await loaded(zone, now, ns);
        expect(a.length).toBeGreaterThan(0);
        expect(b).toEqual(a);
        const c = await loaded(zone, now, ns + 1);
        expect(c.length).toBe(a.length);
        const eids = (rows: [string, string][]) => new Set(rows.map(([p]) => p).filter((p) => p.includes("/evidence/")));
        const ea = eids(a);
        for (const p of eids(c)) expect(ea.has(p)).toBe(false);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);
});
