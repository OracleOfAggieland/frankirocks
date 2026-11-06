import { type Job, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { commitUserTurnForTest } from "../testing/extract-fixtures";
import { type TestRig, failingStore, patchRecord, settle, testRig } from "../testing/fakes";
import { runExtractJob } from "./extract";
import { ensureHangupJob } from "./hangup";
import { type Lease, claimJob } from "./jobs";
import { runDueJobs } from "./tick";

const UID = "owner-1";

async function queuedExtractJob() {
  const rig = testRig();
  const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "My dog is called Pip", rig.clock, rig.deps.hasher);
  const job = async (jobId = turn.jobId) => (await rig.store.get<Job>(UID, paths.job(UID, jobId)))!.data;
  return { rig, jobId: turn.jobId, job };
}

/** A store on which a rival runner claims `jobId` once, after the first claim has read the job and before it commits. */
function rivalClaims(rig: TestRig, jobId: string): { store: StorePort; rival: () => Lease | null | undefined } {
  const inner = rig.store;
  let rival: Lease | null | undefined;
  const store: StorePort = {
    get: (u, p) => inner.get(u, p),
    query: (u, q) => inner.query(u, q),
    transaction: (u, fn) =>
      inner.transaction(u, async (tx) => {
        const result = await fn(tx);
        const lease = result as unknown as Partial<Lease> | null;
        if (rival === undefined && lease?.jobId === jobId && lease.token !== undefined) {
          rival = await claimJob(inner, u, jobId, rig.clock.read().opsClock.now, rig.deps.hasher);
        }
        return result;
      }),
  };
  return { store, rival: () => rival };
}

describe("claimJob races (two runners at one due time)", () => {
  it("two claims at once: one gets the lease, the other gets null instead of a staleRevision error", async () => {
    const { rig, jobId, job } = await queuedExtractJob();
    const now = rig.clock.read().opsClock.now;
    const claims = await Promise.all([claimJob(rig.store, UID, jobId, now, rig.deps.hasher), claimJob(rig.store, UID, jobId, now, rig.deps.hasher)]);
    const won = claims.filter((c) => c !== null);
    expect(won).toHaveLength(1);
    expect(await job()).toMatchObject({ status: "leased", leaseToken: won[0]!.token, generation: 1 });
  });

  it("a claim whose job another runner claimed between its read and its commit returns null", async () => {
    const { rig, jobId, job } = await queuedExtractJob();
    const { store, rival } = rivalClaims(rig, jobId);
    expect(await claimJob(store, UID, jobId, rig.clock.read().opsClock.now, rig.deps.hasher)).toBeNull();
    expect(rival()).not.toBeNull();
    expect(await job()).toMatchObject({ status: "leased", leaseToken: rival()!.token });
  });

  it("other store errors still throw", async () => {
    const { rig, jobId } = await queuedExtractJob();
    const store = failingStore(rig.store, () => true);
    await expect(claimJob(store, UID, jobId, rig.clock.read().opsClock.now, rig.deps.hasher)).rejects.toThrow("injected commit failure");
  });

  it("the extract worker skips a job it lost to another runner, with no model call", async () => {
    const { rig, jobId } = await queuedExtractJob();
    const { store, rival } = rivalClaims(rig, jobId);
    expect(await runExtractJob(UID, jobId, { ...rig.deps, store })).toBe("skipped");
    expect(rival()).not.toBeNull();
    expect(rig.openai.requestsTo("responses.create")).toHaveLength(0);
  });

  it("tick's Q17 skips a hangup Job it lost to another runner and still drains the extract Jobs", async () => {
    const { rig, jobId: extractJob, job } = await queuedExtractJob();
    // The Extract_Job names missing Evidence, so its attempt ends at the worker's first check.
    await patchRecord<Job>(rig.store, UID, paths.job(UID, extractJob), { sourceIds: [testId("no-evidence")] });
    const now = rig.clock.read().opsClock.now;
    const hangupJob = await rig.store.transaction(UID, (tx) => ensureHangupJob(tx, UID, testId("s1"), 1, now, rig.deps.hasher));
    const { store, rival } = rivalClaims(rig, hangupJob);
    await settle(runDueJobs({ uid: UID, deps: { ...rig.deps, store }, schedule: rig.sched.schedule }), rig.clock, rig.timers);
    expect(await job(hangupJob)).toMatchObject({ status: "leased", leaseToken: rival()!.token });
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(0);
    // The drain claimed the Extract_Job (generation 1) and its attempt released the lease.
    expect(await job(extractJob)).toMatchObject({ generation: 1, leaseToken: null });
  });

  it("tick's Q17 still drains the extract Jobs when a hangup attempt's commit loses a race", async () => {
    const { rig, jobId: extractJob, job } = await queuedExtractJob();
    await patchRecord<Job>(rig.store, UID, paths.job(UID, extractJob), { sourceIds: [testId("no-evidence")] });
    const now = rig.clock.read().opsClock.now;
    const hangupJob = await rig.store.transaction(UID, (tx) => ensureHangupJob(tx, UID, testId("s1"), 1, now, rig.deps.hasher));
    const inner = rig.store;
    let raced = false;
    const store: StorePort = {
      get: (u, p) => inner.get(u, p),
      query: (u, q) => inner.query(u, q),
      transaction: (u, fn) =>
        inner.transaction(u, async (tx) => {
          const result = await fn(tx);
          // The attempt's commit: another writer (Q13's expiry close, say) changes the Job before it lands.
          if (!raced && result === "complete") {
            raced = true;
            await patchRecord<Job>(inner, u, paths.job(u, hangupJob), { updatedAt: tsFromMs(now + 1) });
          }
          return result;
        }),
    };
    await settle(runDueJobs({ uid: UID, deps: { ...rig.deps, store }, schedule: rig.sched.schedule }), rig.clock, rig.timers);
    expect(raced).toBe(true);
    expect(await job(hangupJob)).toMatchObject({ status: "leased" });
    expect(await job(extractJob)).toMatchObject({ generation: 1, leaseToken: null });
  });
});
