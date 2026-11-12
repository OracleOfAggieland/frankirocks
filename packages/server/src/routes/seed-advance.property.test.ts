// Feature: one-shot time (brief 023), property "The world clock only moves forward, the ops clock is never changed
// by a jump, and a jump under a barrier changes nothing" (contracts §6 POST /api/seed/advance "monotone world,
// barrier 423, force tick"; §1 Clocks "opsClock ... stays on wall time"; KS09). For any sequence of jumps by any
// amount, forward or back, with or without a forget's barrier up, on one seeded clone (built once; only the inputs
// vary): the world clock never goes back; a forward jump lands exactly on `to`; every ops-domain time the jump wrote
// (`updatedAt`, a moment's `leaseUntil`) is on the ops clock, never the world's; and under a barrier the jump answers
// 423 and no row changes but its own request entry.
import { type CoreEpoch, type Moment, OPEN_LEASE_MS, canonicalJSON, msFromTs, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { listTenantRows } from "../seed/clear";
import { paths } from "../store/paths";
import { callRoute, patchRecord, type TestRig, testRig } from "../testing/fakes";
import { resetAs, stateOf } from "../testing/seed";
import { seedAdvanceRoute } from "./seed-advance";

const UID = "owner-1";
const MINUTE = 60_000;

let rig: TestRig;
let namespace: string;
let n = 0;

beforeAll(async () => {
  rig = testRig();
  namespace = (await resetAs(rig, UID, "v1", "r1", "America/Chicago")).body.fixtureNamespace;
});

const rowsBy = async () => new Map((await listTenantRows(rig.store, UID)).map((r) => [r.path, canonicalJSON(r.data)]));

describe("one-shot time: the jump", () => {
  it("moves the world forward only, never the ops clock, and nothing under a barrier", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -3 * 24 * 60, max: 3 * 24 * 60 }), fc.integer({ min: 0, max: 4 }).map((b) => b === 0), async (deltaMinutes, barrier) => {
        const requestId = testId(`advance-${n++}`);
        const world0 = msFromTs((await stateOf(rig.store, UID)).worldClock!);
        const to = world0 + deltaMinutes * MINUTE;
        if (barrier) {
          const now = tsFromMs(rig.clock.read().opsClock.now);
          await patchRecord<CoreEpoch>(rig.store, UID, paths.core(UID, "epoch"), { barrier: { opId: testId("forget"), phase: "fence", startedAt: now, deadline: now, queuedOps: [] } });
        }
        const before = await rowsBy();
        const res = await callRoute(rig, seedAdvanceRoute, { requestId, fixtureNamespace: namespace, to: tsFromMs(to) }, { token: `token:${UID}` });
        const opsAfter = rig.clock.read().opsClock.now;
        const world1 = msFromTs((await stateOf(rig.store, UID)).worldClock!);
        expect(world1).toBeGreaterThanOrEqual(world0);

        if (barrier) {
          expect(res.status).toBe(423);
          const after = await rowsBy();
          const own = [...after.keys()].filter((p) => p.includes("/ledger/") && !before.has(p));
          expect(own.length).toBeLessThanOrEqual(1);
          for (const [path, json] of before) if (!path.includes("/ledger/")) expect(after.get(path)).toBe(json);
          for (const path of after.keys()) if (!path.includes("/ledger/")) expect(before.has(path)).toBe(true);
          await patchRecord<CoreEpoch>(rig.store, UID, paths.core(UID, "epoch"), { barrier: null });
          return;
        }
        if (deltaMinutes < 0) {
          expect(res.status).toBe(400);
          expect(world1).toBe(world0);
          return;
        }
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(world1).toBe(to);
        for (const r of await listTenantRows(rig.store, UID)) {
          const d = r.data as { updatedAt?: string };
          if (typeof d.updatedAt === "string") expect(msFromTs(d.updatedAt)).toBeLessThanOrEqual(opsAfter);
          if (r.path.includes("/moments/")) {
            const m = r.data as Moment;
            if (m.leaseUntil !== null) expect(msFromTs(m.leaseUntil)).toBeLessThanOrEqual(opsAfter + OPEN_LEASE_MS);
          }
        }
      }),
      { numRuns: 1000 },
    );
  }, 600_000);
});
