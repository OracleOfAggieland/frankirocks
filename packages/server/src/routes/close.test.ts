import { type Job, type Session, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fail, never, ok } from "../openai/fake";
import { paths } from "../store/paths";
import { commitUserTurnForTest, insertTurnForTest } from "../testing/extract-fixtures";
import { callRoute, patchRecord, recordingSchedule, runScheduled, testRig } from "../testing/fakes";
import { extractJobId } from "../worker/extract-jobs";
import { hangupJobId } from "../worker/hangup";
import { LEASE_MS } from "../worker/jobs";
import { closeRoute } from "./close";
import { openRoute } from "./open";

const UID = "owner-1";

async function opened(callIds: string[] = []) {
  const rig = testRig();
  const res = await callRoute(rig, openRoute, { requestId: testId("open1"), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: null });
  const sessionId: string = res.body.sessionId;
  if (callIds.length > 0) await patchRecord<Session>(rig.store, UID, paths.session(UID, sessionId), { status: "active", registeredCallIds: callIds, callId: callIds.at(-1)! });
  let n = 0;
  const close = (overrides: Record<string, unknown> = {}) =>
    callRoute(rig, closeRoute, { requestId: testId(`close${++n}`), sessionId, generation: 1, reason: "user", ...overrides });
  const session = async () => (await rig.store.get<Session>(UID, paths.session(UID, sessionId)))!.data;
  return { rig, sessionId, close, session };
}

describe("POST /api/session/close", () => {
  it("closes a Session with no calls at once", async () => {
    const { close, session } = await opened();
    const res = await close();
    expect(res.body).toEqual({ state: "closed" });
    expect(await session()).toMatchObject({ status: "closed", closedAt: "2026-11-03T12:00:00.000Z" });
  });

  it("answers closing with its hangup Job already written, before any hangup", async () => {
    const { rig, sessionId, close, session } = await opened(["rtc_1", "rtc_2", "rtc_3"]);
    rig.openai.always("realtime.calls.hangup", ok(null));
    const res = await close();
    expect(res.body).toEqual({ state: "closing" });
    expect(res.elapsedMs).toBeLessThanOrEqual(1_500);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(0);
    expect(await session()).toMatchObject({ status: "closing", closedAt: null });
    const job = (await rig.store.get<Job>(UID, paths.job(UID, hangupJobId(sessionId, rig.deps.hasher))))!.data;
    expect(job).toMatchObject({ kind: "hangup", status: "queued", sourceIds: [sessionId] });
    expect(job.payload).toMatchObject({ kind: "work", task: "hangup", targets: [{ type: "session", id: sessionId }] });
  });

  it("after the response, hangs up every registered call ID and sets closed with closedAt", async () => {
    const { rig, sessionId, close, session } = await opened(["rtc_1", "rtc_2", "rtc_3"]);
    rig.openai.always("realtime.calls.hangup", ok(null));
    await close();
    await runScheduled(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup").map((r) => (r.body as { callId: string }).callId).sort()).toEqual(["rtc_1", "rtc_2", "rtc_3"]);
    expect(await session()).toMatchObject({ status: "closed", closedAt: "2026-11-03T12:00:00.000Z" });
    expect((await rig.store.get<Job>(UID, paths.job(UID, hangupJobId(sessionId, rig.deps.hasher))))!.data).toMatchObject({ status: "complete", attempts: 1 });
    expect(rig.logs.filter((l) => l.event === "hangup.call")).toHaveLength(3);
  });

  it("failing hangups retry after 1, 2, 5 and 10 s, then stay closing for tick's 60 s retries", async () => {
    const { rig, sessionId, close, session } = await opened(["rtc_1"]);
    rig.openai.always("realtime.calls.hangup", fail(new Error("openai 500")));
    const res = await close();
    expect(res.body).toEqual({ state: "closing" });
    const t0 = rig.clock.read().opsClock.now;
    await runScheduled(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(5);
    expect(rig.clock.read().opsClock.now - t0).toBe(18_000);
    expect(await session()).toMatchObject({ status: "closing", closedAt: null });
    expect((await rig.store.get<Job>(UID, paths.job(UID, hangupJobId(sessionId, rig.deps.hasher))))!.data).toMatchObject({ status: "retry", attempts: 5, error: "DEPENDENCY" });
  });

  it("a hangup that recovers on a retry closes the Session then", async () => {
    const { rig, close, session } = await opened(["rtc_1"]);
    rig.openai.script("realtime.calls.hangup", fail(new Error("openai 500")), fail(new Error("openai 500")));
    rig.openai.always("realtime.calls.hangup", ok(null));
    await close();
    await runScheduled(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(3);
    expect(await session()).toMatchObject({ status: "closed", closedAt: "2026-11-03T12:00:03.000Z" });
  });

  it("answers closing within 1.5 s even when a hangup never answers", async () => {
    const { rig, close } = await opened(["rtc_1"]);
    rig.openai.always("realtime.calls.hangup", never());
    const res = await close();
    expect(res.body).toEqual({ state: "closing" });
    expect(res.elapsedMs).toBeLessThanOrEqual(1_500);
  });

  it("a second close while closing answers closing again and keeps one Job", async () => {
    const { rig, close } = await opened(["rtc_1"]);
    rig.openai.always("realtime.calls.hangup", never());
    expect((await close()).body).toEqual({ state: "closing" });
    const jobs = rig.store.countUnder(paths.collection(UID, "jobs"));
    expect((await close()).body).toEqual({ state: "closing" });
    expect(rig.store.countUnder(paths.collection(UID, "jobs"))).toBe(jobs);
  });

  it("a second close makes a Job waiting for tick's 60 s retry due now, and drives it to closed", async () => {
    const { rig, sessionId, close, session } = await opened(["rtc_1"]);
    const job = async () => (await rig.store.get<Job>(UID, paths.job(UID, hangupJobId(sessionId, rig.deps.hasher))))!.data;
    rig.openai.always("realtime.calls.hangup", fail(new Error("openai 500")));
    await close();
    await runScheduled(rig);
    const now = rig.clock.read().opsClock.now;
    expect(await job()).toMatchObject({ status: "retry", attempts: 5, nextAttemptAt: tsFromMs(now + 60_000) });
    rig.openai.always("realtime.calls.hangup", ok(null));
    expect((await close()).body).toEqual({ state: "closing" });
    await runScheduled(rig);
    expect(await session()).toMatchObject({ status: "closed", closedAt: tsFromMs(now) });
    expect(await job()).toMatchObject({ status: "complete", attempts: 6 });
  });

  it("a later close leaves a live lease to its runner, and requeues one whose runner died", async () => {
    const { rig, sessionId, close, session } = await opened(["rtc_1"]);
    const jobPath = paths.job(UID, hangupJobId(sessionId, rig.deps.hasher));
    const job = async () => (await rig.store.get<Job>(UID, jobPath))!.data;
    rig.openai.always("realtime.calls.hangup", ok(null));
    await close();
    // The process making the first attempt dies holding the lease: its scheduled work never runs.
    rig.sched = recordingSchedule();
    await patchRecord<Job>(rig.store, UID, jobPath, { status: "leased", leaseToken: testId("runner-1"), leaseUntil: tsFromMs(rig.clock.read().opsClock.now + LEASE_MS), generation: 1 });
    const leased = await job();

    expect((await close()).body).toEqual({ state: "closing" });
    await runScheduled(rig);
    expect(await job()).toEqual(leased);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(0);

    rig.clock.advance(LEASE_MS);
    expect((await close()).body).toEqual({ state: "closing" });
    await runScheduled(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(1);
    expect(await job()).toMatchObject({ status: "complete", attempts: 1, generation: 2, leaseToken: null });
    expect((await session()).status).toBe("closed");
  });

  it("an already closed Session answers closed with no hangup and closedAt unchanged (R14.6)", async () => {
    const { rig, close, session } = await opened(["rtc_1"]);
    rig.openai.always("realtime.calls.hangup", ok(null));
    await close();
    await runScheduled(rig);
    const closedAt = (await session()).closedAt;
    expect(closedAt).not.toBeNull();
    const hangups = rig.openai.requestsTo("realtime.calls.hangup").length;
    rig.clock.advance(10_000);
    expect((await close()).body).toEqual({ state: "closed" });
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(hangups);
    expect((await session()).closedAt).toBe(closedAt);
  });

  it("rejects a wrong generation with STALE and an unknown Session with SCOPE, changing nothing (R14.7)", async () => {
    const { close, session } = await opened(["rtc_1"]);
    const before = await session();
    expect((await close({ generation: 2 })).body.error).toBe("STALE");
    expect((await close({ sessionId: testId("other") })).body.error).toBe("SCOPE");
    expect(await session()).toEqual(before);
  });

  it("another Owner's Session is out of scope", async () => {
    const { rig, sessionId } = await opened();
    const res = await callRoute(rig, closeRoute, { requestId: testId("c"), sessionId, generation: 1, reason: "user" }, { token: "token:owner-2" });
    expect(res.body.error).toBe("SCOPE");
  });

  it("ensures exactly one Extract_Job per committed user Turn on close (R14.5)", async () => {
    const { rig, sessionId, close } = await opened();
    const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "I like tea", rig.clock, rig.deps.hasher);
    // Remove the job the fixture wrote, so close has to create it.
    const jobId = extractJobId(turn.eid, rig.deps.hasher);
    expect(jobId).toBe(turn.jobId);
    const missing = testId("t2");
    const turn2 = await commitUserTurnForTest(rig.store, UID, missing, "I run on Sundays", rig.clock, rig.deps.hasher);
    await insertTurnForTest(rig.store, UID, sessionId, testId("t1"), { seq: 1, evidenceId: turn.eid });
    await insertTurnForTest(rig.store, UID, sessionId, testId("t2"), { seq: 2, evidenceId: turn2.eid });
    await insertTurnForTest(rig.store, UID, sessionId, testId("a2"), { seq: 2, role: "assistant", evidenceId: null, sourceClass: "M" });
    const jobsBefore = rig.store.countUnder(paths.collection(UID, "jobs"));
    await close();
    await close();
    expect(rig.store.countUnder(paths.collection(UID, "jobs"))).toBe(jobsBefore);
    expect(await rig.store.get(UID, paths.job(UID, turn2.jobId))).not.toBeNull();
    expect(rig.sched.pending).toBeGreaterThan(0);
  });

  it("creates the Extract_Job for a committed user Turn that lacks one", async () => {
    const { rig, sessionId, close } = await opened();
    const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "I like tea", rig.clock, rig.deps.hasher);
    // A second Evidence row with no job: copy the first under a new ID.
    const eid = testId("ev-nojob");
    const ev = (await rig.store.get(UID, paths.evidence(UID, turn.eid)))!.data as Record<string, unknown>;
    await rig.store.transaction(UID, async (tx) => tx.create(paths.evidence(UID, eid), { ...ev, fieldSlices: (ev.fieldSlices as { eid: string }[]).map((s) => ({ ...s, eid })) }));
    await insertTurnForTest(rig.store, UID, sessionId, testId("t9"), { seq: 1, evidenceId: eid });
    expect(await rig.store.get(UID, paths.job(UID, extractJobId(eid, rig.deps.hasher)))).toBeNull();
    await close();
    expect((await rig.store.get<Job>(UID, paths.job(UID, extractJobId(eid, rig.deps.hasher))))?.data).toMatchObject({ kind: "extract", status: "queued", sourceIds: [eid] });
  });
});
