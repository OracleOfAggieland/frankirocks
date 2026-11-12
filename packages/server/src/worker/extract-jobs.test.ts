// The open awaits `ensureExtractJobs` when it closes the prior Session, so the open's tail reserve counts its round
// trips: one read of the Turns, then a transaction of two reads and its commit, whatever the number of Turns.
import type { ID } from "@franki/core";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { callRoute, runScheduled, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { turnRoute } from "../routes/turn";
import { ensureExtractJobs } from "./extract-jobs";

const UID = "owner-1";
const RTT = 75;
const TURNS = 5;

describe("ensureExtractJobs: round trips do not grow with the Turns", () => {
  it(`${TURNS} Turns with no Job: four round trips in all`, async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    for (let i = 1; i <= TURNS; i++) {
      const res = await callRoute(rig, turnRoute, { ...asrTurn(s.stamp, i, `Line number ${i} about my week.`, [{ itemId: `item_${i}`, commitSeq: i }]), judge: "O" });
      expect(res.status).toBe(200);
    }
    await runScheduled(rig);
    // With the Jobs taken away, each Turn's Evidence is read as well (the worst case).
    const jobs = await rig.store.query(UID, { collection: paths.collection(UID, "jobs"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
    await rig.store.transaction(UID, async (tx) => {
      for (const j of jobs) tx.delete(j.path);
    });
    const inner = rig.store;
    const rtt = () => rig.timers.sleep(RTT);
    const distant: StorePort = {
      get: async (uid, path) => (await rtt(), inner.get(uid, path)),
      query: async (uid, spec) => (await rtt(), inner.query(uid, spec)),
      transaction: (uid, fn) =>
        inner.transaction(uid, async (tx) => {
          const r = await fn({ ...tx, get: async (path) => (await rtt(), tx.get(path)), query: async (spec) => (await rtt(), tx.query(spec)) });
          await rtt();
          return r;
        }),
    };
    const run = await settle(ensureExtractJobs(UID, s.sessionId as ID, { store: distant, hasher: rig.deps.hasher, clock: rig.clock }), rig.clock, rig.timers);
    expect(run.value).toHaveLength(TURNS);
    expect(run.elapsedMs).toBe(4 * RTT);
  });
});
