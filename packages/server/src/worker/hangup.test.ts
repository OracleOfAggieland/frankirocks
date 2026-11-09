import { type Job, type Session, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { closeRoute } from "../routes/close";
import { openRoute } from "../routes/open";
import { fail, never, ok } from "../openai/fake";
import { paths } from "../store/paths";
import { T0_MS, callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { HANGUP_STEADY_MS, JOB_HANGUP_DEADLINE_MS, driveHangupJob, ensureHangupJob, hangupBackoff, hangupJobId, runHangupJob } from "./hangup";
import { LEASE_MS } from "./jobs";

const UID = "owner-1";
const gone = () => fail(Object.assign(new Error("not found"), { status: 404 }));

async function closingSession(callIds: string[] = ["rtc_1", "rtc_2"]) {
  const rig = testRig();
  const res = await callRoute(rig, openRoute, { requestId: testId("open1"), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: null });
  const sessionId: string = res.body.sessionId;
  await patchRecord<Session>(rig.store, UID, paths.session(UID, sessionId), { status: "active", registeredCallIds: callIds });
  // The close answers `closing` with the Job written; its background driver is left unrun, so each test drives
  // the Job itself.
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

  it("driveHangupJob stops at once when the Job is complete, and after the four backoff steps otherwise", async () => {
    const { rig, jobId, job, session } = await closingSession();
    rig.openai.always("realtime.calls.hangup", fail(new Error("still down")));
    const drive = () => settle(driveHangupJob(UID, jobId, rig.deps), rig.clock, rig.timers).then((r) => r.value);
    expect(await drive()).toBe("retry");
    expect((await job()).attempts).toBe(5);
    rig.openai.always("realtime.calls.hangup", ok(null));
    rig.clock.advance(HANGUP_STEADY_MS);
    expect(await drive()).toBe("complete");
    expect((await session()).status).toBe("closed");
    expect(await drive()).toBe("skipped");
  });

  it("treats a call OpenAI no longer knows (404) as hung up", async () => {
    const { rig, job, run } = await closingSession();
    rig.openai.always("realtime.calls.hangup", gone());
    expect(await run()).toBe("complete");
    expect((await job()).status).toBe("complete");
  });

  it("hangs up every call at once, so four slow 404s take one call's time, not four", async () => {
    const { rig, job, session, run } = await closingSession(["rtc_1", "rtc_2", "rtc_3", "rtc_4"]);
    // Each answers 404 after 8 s, as a just-ended call does: 32 s one after another, past the 30 s lease.
    const starts: number[] = [];
    rig.deps.openai = {
      call: async (endpoint, body) => {
        starts.push(rig.clock.read().opsClock.now);
        await rig.timers.sleep(8_000);
        return rig.openai.call(endpoint, body);
      },
    };
    rig.openai.always("realtime.calls.hangup", gone());
    const t0 = rig.clock.read().opsClock.now;
    expect(await run()).toBe("complete");
    expect(starts).toEqual([t0, t0, t0, t0]);
    expect(rig.clock.read().opsClock.now - t0).toBe(8_000);
    expect(await job()).toMatchObject({ status: "complete", attempts: 1 });
    expect((await session()).status).toBe("closed");
  });

  it("ends an attempt at its one deadline when no call answers, however many calls, well inside the lease", async () => {
    const { rig, job, run } = await closingSession(["rtc_1", "rtc_2", "rtc_3", "rtc_4"]);
    rig.openai.always("realtime.calls.hangup", never());
    const t0 = rig.clock.read().opsClock.now;
    expect(await run()).toBe("retry");
    expect(rig.clock.read().opsClock.now - t0).toBe(JOB_HANGUP_DEADLINE_MS);
    expect(JOB_HANGUP_DEADLINE_MS).toBeLessThan(LEASE_MS);
    expect(await job()).toMatchObject({ status: "retry", attempts: 1, error: "DEPENDENCY" });
  });

  it("an attempt that lost its lease reports requeued, not complete, and commits nothing", async () => {
    const { rig, jobId, job, session } = await closingSession();
    const answers: ((value: unknown) => void)[] = [];
    rig.deps.openai = { call: () => new Promise((resolve) => answers.push(resolve)) };
    let closed = 0;
    const running = runHangupJob(UID, jobId, rig.deps, async () => {
      closed++;
    });
    while (answers.length < 2) await new Promise((r) => setImmediate(r));
    // Q18 requeued the expired lease and another runner claimed it while these hangups were in flight.
    const leased = await job();
    await patchRecord<Job>(rig.store, UID, paths.job(UID, jobId), { leaseToken: testId("other-lease"), generation: leased.generation + 1 });
    for (const answer of answers) answer(null);
    expect(await running).toBe("requeued");
    expect(await job()).toMatchObject({ status: "leased", leaseToken: testId("other-lease"), attempts: 0 });
    expect((await session()).status).toBe("closing");
    expect(closed).toBe(0);
  });

  describe("ensureHangupJob on an existing Job (a later close)", () => {
    async function ensureAgain(patch: Partial<Job>) {
      const { rig, sessionId, jobId, job } = await closingSession();
      await patchRecord<Job>(rig.store, UID, paths.job(UID, jobId), patch);
      const before = await job();
      const now = rig.clock.read().opsClock.now;
      await rig.store.transaction(UID, (tx) => ensureHangupJob(tx, UID, sessionId, 1, now, rig.deps.hasher));
      return { before, after: await job(), now: tsFromMs(now) };
    }

    it("makes a queued or retry Job waiting for a later attempt due now", async () => {
      for (const status of ["queued", "retry"] as const) {
        const { after, now } = await ensureAgain({ status, attempts: 5, nextAttemptAt: tsFromMs(T0_MS + HANGUP_STEADY_MS) });
        expect(after).toMatchObject({ status, attempts: 5, nextAttemptAt: now, leaseToken: null });
      }
    });

    it("puts a lease that expired with its runner back to retry, due now", async () => {
      const { after, now } = await ensureAgain({ status: "leased", leaseToken: testId("dead-runner"), leaseUntil: tsFromMs(T0_MS - 1), generation: 1 });
      expect(after).toMatchObject({ status: "retry", leaseToken: null, leaseUntil: null, nextAttemptAt: now, generation: 1 });
    });

    it("leaves a live lease to its runner", async () => {
      const { before, after } = await ensureAgain({ status: "leased", leaseToken: testId("live-runner"), leaseUntil: tsFromMs(T0_MS + LEASE_MS), generation: 1 });
      expect(after).toEqual(before);
    });
  });
});
