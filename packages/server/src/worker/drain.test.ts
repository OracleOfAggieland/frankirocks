import { type Job, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { commitUserTurnForTest } from "../testing/extract-fixtures";
import { patchRecord, settle, testRig } from "../testing/fakes";
import { DRAIN_POLL_MAX_MS, drainExtractJobs } from "./drain";
import { EXTRACT_LEASE_MS } from "./extract";

const UID = "owner-1";

/**
 * An Extract_Job leased by another worker for the full extract lease, and a drain whose lease polls are counted.
 * The job names Evidence that does not exist, so an attempt the drain makes ends at the worker's first check.
 */
async function leasedElsewhere() {
  const rig = testRig();
  const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "My dog is called Pip", rig.clock, rig.deps.hasher);
  const jobPath = paths.job(UID, turn.jobId);
  const leaseUntil = tsFromMs(rig.clock.read().opsClock.now + EXTRACT_LEASE_MS);
  await patchRecord<Job>(rig.store, UID, jobPath, { status: "leased", leaseToken: testId("other-worker"), leaseUntil, generation: 1, sourceIds: [testId("no-evidence")] });
  let polls = 0;
  const inner = rig.store;
  const store: StorePort = {
    get: (u, p) => inner.get(u, p),
    query: (u, q) => {
      if (q.where.some((f) => f.field === "status" && f.value === "leased")) polls++;
      return inner.query(u, q);
    },
    transaction: (u, fn) => inner.transaction(u, fn),
  };
  const drain = () => settle(drainExtractJobs(UID, { ...rig.deps, store }), rig.clock, rig.timers);
  const job = async () => (await rig.store.get<Job>(UID, jobPath))!.data;
  return { rig, jobPath, drain, job, polls: () => polls };
}

describe("extract drain while a job is leased elsewhere", () => {
  it("polls a dead worker's lease about once a second, then requeues and runs the job as the lease expires", async () => {
    const { rig, drain, job, polls } = await leasedElsewhere();
    const { elapsedMs } = await drain();
    expect(elapsedMs).toBe(EXTRACT_LEASE_MS);
    // Claimed by this drain (generation 2) and released by its attempt.
    expect(await job()).toMatchObject({ generation: 2, leaseToken: null });
    expect(rig.openai.requestsTo("responses.create")).toHaveLength(0);
    // Waits of 100, 200, 400 and 800 ms, then 1 s: about 80 polls over the 75 s lease (every 100 ms it was 750).
    expect(polls()).toBeLessThanOrEqual(EXTRACT_LEASE_MS / DRAIN_POLL_MAX_MS + 10);
  });

  it("sees a job that finishes elsewhere soon after it does, from the short first polls", async () => {
    const { rig, jobPath, drain, polls } = await leasedElsewhere();
    // The other worker commits 250 ms in; the drain looks at 0, 100 and 300 ms.
    void rig.timers.sleep(250).then(() => patchRecord<Job>(rig.store, UID, jobPath, { status: "complete", leaseToken: null, leaseUntil: null }));
    const { elapsedMs } = await drain();
    expect(elapsedMs).toBe(300);
    expect(polls()).toBe(3);
  });
});
