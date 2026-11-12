/**
 * Reset is total (brief 019 "Reset is total"; contracts §1 Clocks "Reset ... clears all tenant rows (paged Q28,
 * subcollections too), reseeds before unblock"). For any rows written before it (Sessions with turns, Evidence,
 * Memories with lineage, Jobs, ledger rows, and more than one page of them), after a reset the tenant holds exactly
 * the seed: the seed's own rows, the five core documents and the reset's own request entry, and nothing else.
 *
 * Runs: RUNS (each case writes up to 230 rows, then clones the persona, about 0.4 s).
 */
import { type CoreEpoch, type CoreState, tsFromMs } from "@franki/core";
import { sampleJob, sampleLedgerDecision, sampleSession, sampleTurn, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { linkedEvidence, linkedMemory } from "../store/conformance";
import { paths } from "../store/paths";
import { requestKey } from "../ledger/request";
import { testRig } from "../testing/fakes";
import { resetAs, snapshotOf, stateOf } from "../testing/seed";
import { buildSeed } from "./build";
import { cloneWorldStart } from "./clock";
import { PERSONA, PERSONA_FIXTURE_ID } from "./persona";

const RUNS = 25;
const UID = "owner-1";
const ZONE = "America/Chicago";

const before = fc.record({
  sessions: fc.integer({ min: 0, max: 3 }),
  turnsEach: fc.integer({ min: 0, max: 4 }),
  memories: fc.integer({ min: 0, max: 5 }),
  jobs: fc.integer({ min: 0, max: 120 }),
  ledger: fc.integer({ min: 0, max: 105 }),
});

describe("seed reset is total", () => {
  it("after a reset the tenant holds exactly the seed", async () => {
    await fc.assert(
      fc.asyncProperty(before, async (b) => {
        const rig = testRig();
        // An earlier visit's clone: only a tenant already in fixture mode (or empty) may be reset.
        expect((await resetAs(rig, UID, "old", "old", ZONE)).status).toBe(200);
        // Rows from before: they must all be gone after the reset.
        await rig.store.transaction(UID, async (tx) => {
          for (let s = 0; s < b.sessions; s++) {
            const sid = testId(`s${s}`);
            tx.create(paths.session(UID, sid), sampleSession({ uid: UID, status: "closed" }));
            for (let t = 0; t < b.turnsEach; t++) tx.create(paths.turn(UID, sid, testId(`s${s}t${t}`)), sampleTurn({ uid: UID, sessionId: sid, seq: t }));
          }
          for (let m = 0; m < b.memories; m++) {
            const ev = linkedEvidence(rig.deps.hasher, `pre${m}`, `I said thing number ${m}`);
            tx.create(paths.evidence(UID, ev.eid), { ...ev.record, uid: UID });
            tx.create(paths.memory(UID, testId(`pm${m}`)), { ...linkedMemory(rig.deps.hasher, ev), uid: UID });
          }
        });
        for (let start = 0; start < b.jobs; start += 50) {
          await rig.store.transaction(UID, async (tx) => {
            for (let j = start; j < Math.min(b.jobs, start + 50); j++) tx.create(paths.job(UID, testId(`pj${j}`)), { ...sampleJob(), uid: UID });
          });
        }
        for (let start = 0; start < b.ledger; start += 50) {
          await rig.store.transaction(UID, async (tx) => {
            for (let l = start; l < Math.min(b.ledger, start + 50); l++) tx.create(paths.ledger(UID, testId(`pl${l}`)), { ...sampleLedgerDecision(), uid: UID });
          });
        }

        const res = await resetAs(rig, UID, "new", "new", ZONE);
        expect(res.status).toBe(200);
        const state: CoreState = await stateOf(rig.store, UID);
        const epoch = (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
        expect(state).toMatchObject({ clockMode: "fixture", fixtureNamespace: res.body.fixtureNamespace, visitId: testId("visit-new") });
        expect(epoch.barrier).toBeNull();

        const expected = await buildSeed(PERSONA, {
          uid: UID,
          namespace: res.body.fixtureNamespace,
          zone: ZONE,
          worldStart: cloneWorldStart(rig.clock.read().opsClock.now, ZONE),
          opsNow: rig.clock.read().opsClock.now,
          core: { epoch: epoch.epoch, policyRev: epoch.policyRev },
          hasher: rig.deps.hasher,
        });
        const body = { requestId: testId("req-new"), sessionId: null, fixtureId: PERSONA_FIXTURE_ID, visitId: testId("visit-new") };
        const own = requestKey(UID, "reset", body.requestId, body, rig.deps.hasher).path;
        const want = new Set([
          ...expected.groups.flatMap((g) => g.writes.map((w) => w.path)),
          ...["epoch", "state", "counters", "rules", "bundle"].map((d) => `users/${UID}/core/${d}`),
          own,
        ]);
        const have = (await snapshotOf(rig.store, UID)).map(([p]) => p);
        expect(have.filter((p) => !want.has(p))).toEqual([]);
        expect([...want].filter((p) => !have.includes(p))).toEqual([]);
        expect(state.worldClock).toBe(tsFromMs(cloneWorldStart(rig.clock.read().opsClock.now, ZONE)));
      }),
      { numRuns: RUNS },
    );
  }, 600_000);
});
