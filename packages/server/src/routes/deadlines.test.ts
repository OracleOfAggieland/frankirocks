/**
 * Route deadlines (R11.2, R13.6, R14.5, R22.12; design "Session open" step 2, "Route deadlines"). Fake_OpenAI never
 * answers and an Extract_Job is queued. Times are measured on the fake opsClock, with the scheduled work still
 * pending when the route returns.
 */
import type { Job } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { never } from "../openai/fake";
import { paths } from "../store/paths";
import { commitUserTurnForTest } from "../testing/extract-fixtures";
import { callRoute, runScheduled, testRig } from "../testing/fakes";
import { openTestSession } from "../testing/session-fixtures";
import { OPEN_DRAIN_LIMIT_MS, openRoute } from "./open";
import { stateRoute } from "./state";

const UID = "owner-1";

async function stuckRig() {
  const rig = testRig();
  const s = await openTestSession(rig);
  const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "My dog is called Pip", rig.clock, rig.deps.hasher);
  rig.openai.always("responses.create", never());
  rig.openai.always("realtime.calls.hangup", never());
  const job = async () => (await rig.store.get<Job>(UID, paths.job(UID, turn.jobId)))!.data;
  return { rig, s, turn, job };
}

describe("route deadlines", () => {
  it("state returns within 1.5 s and open within 5 s when Fake_OpenAI never answers", async () => {
    const { rig, s, job } = await stuckRig();

    // A new ops minute, so the state route's tick is due too; it must only be scheduled.
    rig.clock.advance(60_000);
    const state = await callRoute(rig, stateRoute, {
      sessionId: s.sessionId,
      generation: 1,
      seen: { epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1 },
      ackStamp: null,
      speechStartedOpsAt: null,
    });
    expect(state.status).toBe(200);
    expect(state.elapsedMs).toBeLessThan(1_500);
    expect(rig.sched.pending).toBeGreaterThan(0);
    expect((await job()).status).toBe("queued");

    const open = await callRoute(rig, openRoute, { requestId: testId("open2"), initiator: "user", previousSessionId: s.sessionId, clientZone: "UTC", visitId: null });
    expect(open.status).toBe(200);
    expect(open.body.state).toBe("connecting");
    expect(open.elapsedMs).toBeLessThan(5_000);
    // The drain lost the 3,000 ms race; the job is still running in the background.
    expect(open.elapsedMs).toBeGreaterThanOrEqual(OPEN_DRAIN_LIMIT_MS);
    expect((await job()).status).toBe("leased");
    expect(rig.sched.pending).toBeGreaterThan(0);
  });

  it("the drain that lost the race finishes later and leaves the job visible as retry", async () => {
    const { rig, job } = await stuckRig();
    rig.clock.advance(60_000);
    await callRoute(rig, openRoute, { requestId: testId("open2"), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: null });
    await runScheduled(rig);
    // Both the call and the repair hit the 10 s deadline: the job waits for its next attempt.
    expect(await job()).toMatchObject({ status: "retry", attempts: 1, error: "DEPENDENCY" });
  });
});
