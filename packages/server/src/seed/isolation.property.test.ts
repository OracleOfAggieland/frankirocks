/**
 * Seed isolation (brief 019 "Isolation"). For any two visits in two tenants and any order of resets, loads and
 * stray writes: no read by one visit returns a row of the other. Every row a tenant holds carries its own uid and
 * path, every seeded Evidence derives from that tenant's current namespace, and a visit that was reset reads its
 * own seed.
 *
 * Runs: RUNS (each case clones the persona up to four times through the route, about 0.3 s each).
 */
import { type CoreState, type Evidence } from "@franki/core";
import { sampleSession, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { listTenantRows } from "./clear";
import { seedIds } from "./build";
import { PERSONA } from "./persona";
import { paths } from "../store/paths";
import { testRig } from "../testing/fakes";
import { resetAs, stateOf } from "../testing/seed";

const RUNS = 25;
const UIDS = ["visitor-a", "visitor-b"] as const;

const op = fc.record({ who: fc.constantFrom(...UIDS), kind: fc.constantFrom("reset", "reset", "stray"), visit: fc.integer({ min: 1, max: 3 }) });

describe("seed isolation", () => {
  it("no read by one visit returns a row of the other", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 4 }), async (ops) => {
        const rig = testRig();
        const resetDone = new Set<string>();
        for (const [i, o] of ops.entries()) {
          if (o.kind === "reset") {
            const res = await resetAs(rig, o.who, `${o.who}-${o.visit}`, `${i}`);
            expect(res.status).toBe(200);
            resetDone.add(o.who);
          } else {
            await rig.store.transaction(o.who, async (tx) => tx.create(paths.session(o.who, testId(`stray-${i}`)), sampleSession({ uid: o.who })));
          }
        }
        for (const uid of UIDS) {
          const rows = await listTenantRows(rig.store, uid);
          for (const r of rows) {
            expect(r.path.startsWith(`users/${uid}/`)).toBe(true);
            expect((r.data as { uid: string }).uid).toBe(uid);
          }
          if (!resetDone.has(uid)) continue;
          const state: CoreState = await stateOf(rig.store, uid);
          expect(state.fixtureNamespace).not.toBeNull();
          const ids = seedIds(state.fixtureNamespace!, rig.deps.hasher);
          const evidence = rows.filter((r) => r.path.includes("/evidence/")) as unknown as { id: string; data: Evidence }[];
          expect(evidence.length).toBeGreaterThan(0);
          // Every Evidence the tenant holds is a line of its own current namespace: nothing of another visit's.
          const own = new Set(PERSONA.lines.map((l) => ids.logical(l.id)));
          for (const e of evidence) expect(own.has(e.data.logicalId)).toBe(true);
          expect(new Set(evidence.map((e) => e.data.logicalId)).size).toBe(own.size);
        }
      }),
      { numRuns: RUNS },
    );
  }, 600_000);
});
