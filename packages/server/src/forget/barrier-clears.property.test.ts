// Feature: forget, part two (brief 047, ruling 6): the barrier clears only when it may. For any order of call-close
// answers (closed, failed, or none), steps, retries and a second forget that queues, after every step: when the
// barrier is down, every forget job has passed resume, every call it recorded is confirmed closed, every surviving
// Memory and Evidence row is at the current epoch, and no queued op is waiting for a job. The barrier is never down
// between a promoted op and its job.
import type { CoreEpoch, Evidence, ID, Memory } from "@franki/core";
import { nrWorldArb } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { type CallCloseAnswer, fakeCallClose } from "./close-port";
import { forgetJobId } from "./fence";
import { WORLD_UID, allDone, forgetJobsOf, forgetMemory, oracleDerivatives, stepAll, storeWorld } from "./testing/world";

const answerArb = fc.constantFrom<CallCloseAnswer>("closed", "failed", undefined);

async function allRows<T>(store: Parameters<typeof forgetJobsOf>[0], collection: "memories" | "evidence"): Promise<{ id: string; data: T }[]> {
  return store.query<T>(WORLD_UID, { collection: paths.collection(WORLD_UID, collection), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
}

describe("the barrier clears only when it may (brief 047, ruling 6)", () => {
  it("is down only after closed calls, a finished closure, restamped survivors and an empty queue", async () => {
    await fc.assert(
      fc.asyncProperty(nrWorldArb, fc.array(answerArb, { maxLength: 6 }), fc.option(fc.integer({ min: 0, max: 12 }), { nil: null }), async (w, answers, secondAt) => {
        const s = await storeWorld(w);
        const { store, hasher } = s.rig.deps;
        const closer = fakeCallClose((_sid, attempt) => answers[attempt - 1] ?? "closed");
        const ops: { opId: ID; jobId: ID }[] = [];
        const first = await forgetMemory(s, w.target, "barrier-1");
        if (first.kind === "refused") throw new Error("refused");
        ops.push({ opId: first.opId, jobId: first.jobId });
        const gone = oracleDerivatives(w, w.target);
        for (let step = 0; step < 200; step++) {
          if (step === secondAt) {
            const free = w.memories.map((_, i) => i).filter((i) => !gone.has(i));
            if (free.length > 0) {
              const r = await forgetMemory(s, free[w.secondPick % free.length]!, "barrier-2");
              if (r.kind !== "refused") ops.push({ opId: r.opId, jobId: forgetJobId(r.opId, hasher) });
            }
          }
          await stepAll(s, closer);
          const epoch = (await store.get<CoreEpoch>(WORLD_UID, paths.core(WORLD_UID, "epoch")))!.data;
          if (epoch.barrier === null) {
            const jobs = await forgetJobsOf(store);
            for (const op of ops) {
              const j = jobs.find((x) => x.id === op.jobId);
              expect(j, `op ${op.opId} has no job while the barrier is down`).toBeDefined();
              const p = j!.job.payload;
              if (p.kind !== "forget") throw new Error("not a forget job");
              expect(["purge", "done"], `job at ${p.phase} while the barrier is down`).toContain(p.phase);
              for (const c of p.closeCalls) expect(c.state, `call of ${c.sessionId} not closed while the barrier is down`).toBe("closed");
            }
            for (const m of await allRows<Memory>(store, "memories")) {
              if (["active", "scheduled", "history", "alleged"].includes(m.data.status)) expect(m.data.epoch, `memory ${m.id} below the epoch`).toBe(epoch.epoch);
            }
            for (const e of await allRows<Evidence>(store, "evidence")) {
              if (e.data.status === "retained") expect(e.data.epoch, `evidence ${e.id} below the epoch`).toBe(epoch.epoch);
            }
          }
          if (secondAt !== null && step > secondAt && (await allDone(store))) break;
          if (secondAt === null && (await allDone(store))) break;
        }
      }),
      { numRuns: 150 },
    );
  }, 600_000);
});
