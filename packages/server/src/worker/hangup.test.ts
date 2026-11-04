import type { Job, Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { closeRoute } from "../routes/close";
import { openRoute } from "../routes/open";
import { fail, ok } from "../openai/fake";
import { paths } from "../store/paths";
import { callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { HANGUP_STEADY_MS, hangupBackoff, hangupJobId, runHangupJob } from "./hangup";

const UID = "owner-1";

async function closingSession() {
  const rig = testRig();
  const res = await callRoute(rig, openRoute, { requestId: testId("open1"), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: null });
  const sessionId: string = res.body.sessionId;
  await patchRecord<Session>(rig.store, UID, paths.session(UID, sessionId), { status: "active", registeredCallIds: ["rtc_1", "rtc_2"] });
  rig.openai.script("realtime.calls.hangup", fail(new Error("down")), fail(new Error("down")));
  await callRoute(rig, closeRoute, { requestId: testId("c1"), sessionId, generation: 1, reason: "user" });
  const jobId = hangupJobId(sessionId, rig.deps.hasher);
  const job = async () => (await rig.store.get<Job>(UID, paths.job(UID, jobId)))!.data;
  const session = async () => (await rig.store.get<Session>(UID, paths.session(UID, sessionId)))!.data;
  const run = () => settle(runHangupJob(UID, jobId, rig.deps), rig.clock, rig.timers).then((r) => r.value);
  return { rig, sessionId, jobId, job, session, run };
}

describe("hangup Job (KS07)", () => {
  it("backs off 1, 2, 5, 10 s and then every 60 s", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(hangupBackoff)).toEqual([1_000, 2_000, 5_000, 10_000, HANGUP_STEADY_MS, HANGUP_STEADY_MS, HANGUP_STEADY_MS]);
  });

  it("stays in retry with attempts incremented while hangups fail, and never completes", async () => {
    const { rig, job, session, run } = await closingSession();
    rig.openai.always("realtime.calls.hangup", fail(new Error("still down")));
    const delays: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const before = rig.clock.read().opsClock.now;
      expect(await run()).toBe("retry");
      const j = await job();
      expect(j).toMatchObject({ status: "retry", attempts: i, error: "DEPENDENCY", leaseToken: null });
      delays.push(Date.parse(j.nextAttemptAt) - before);
      // Not due yet: the next attempt is skipped.
      expect(await run()).toBe("skipped");
      rig.clock.advance(Date.parse(j.nextAttemptAt) - rig.clock.read().opsClock.now);
    }
    expect(delays).toEqual([1_000, 2_000, 5_000, 10_000, 60_000, 60_000]);
    expect((await session()).status).toBe("closing");
  });

  it("completes once every call is hung up, and closes the Session with closedAt", async () => {
    const { rig, job, session, run } = await closingSession();
    rig.openai.always("realtime.calls.hangup", ok(null));
    expect(await run()).toBe("complete");
    expect(await job()).toMatchObject({ status: "complete", attempts: 1 });
    expect(await session()).toMatchObject({ status: "closed", closedAt: "2026-11-03T12:00:00.000Z" });
  });

  it("treats a call OpenAI no longer knows (404) as hung up", async () => {
    const { rig, job, run } = await closingSession();
    rig.openai.always("realtime.calls.hangup", fail(Object.assign(new Error("not found"), { status: 404 })));
    expect(await run()).toBe("complete");
    expect((await job()).status).toBe("complete");
  });
});
