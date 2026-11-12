import { type CoreEpoch, type CoreState, type Job, type Session, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ownerClock } from "../core-docs";
import { fail, ok } from "../openai/fake";
import { listTenantRows } from "../seed/clear";
import { cloneWorldStart } from "../seed/clock";
import { PERSONA_FIXTURE_ID } from "../seed/persona";
import { paths } from "../store/paths";
import { commitUserTurnForTest } from "../testing/extract-fixtures";
import { callRoute, patchRecord, testRig } from "../testing/fakes";
import { resetAs, stateOf } from "../testing/seed";
import { hangupJobId } from "../worker/hangup";
import { openRoute } from "./open";
import { seedResetRoute } from "./seed-reset";

const UID = "owner-1";
const ZONE = "America/Chicago";

async function openWithCall(rig: ReturnType<typeof testRig>, callIds: string[]) {
  const res = await callRoute(rig, openRoute, { requestId: testId("open1"), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId: null });
  const sessionId: string = res.body.sessionId;
  await patchRecord<Session>(rig.store, UID, paths.session(UID, sessionId), { status: "active", registeredCallIds: callIds, callId: callIds.at(-1)! });
  return sessionId;
}

describe("POST /api/seed/reset", () => {
  it("clones the persona: fixture clock at the latest Friday 08:40, namespace and visit ID stored, barrier down", async () => {
    const rig = testRig();
    const res = await resetAs(rig, UID, "v1", "r1", ZONE);
    expect(res.status).toBe(200);
    const world = cloneWorldStart(rig.clock.read().opsClock.now, ZONE);
    expect(res.body).toEqual({ fixtureNamespace: expect.any(String), worldClock: tsFromMs(world), sessionId: null });
    const state = await stateOf(rig.store, UID);
    expect(state).toMatchObject({ clockMode: "fixture", worldClock: tsFromMs(world), fixtureNamespace: res.body.fixtureNamespace, visitId: testId("visit-v1"), currentZone: ZONE });
    const epoch = (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
    expect(epoch).toMatchObject({ barrier: null, epoch: 2 });
    // The fixture clock: world stands at the clone's Friday while ops moves on.
    rig.clock.advance(3_600_000);
    expect(ownerClock(state, rig.clock).worldClock).toEqual({ now: world, zone: ZONE });
    expect(new Date(world).toLocaleString("en-US", { timeZone: ZONE, weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false })).toBe("Friday 08:40");
  });

  it("replays the same request without a second clone", async () => {
    const rig = testRig();
    const first = await resetAs(rig, UID, "v1", "r1", ZONE);
    const before = await listTenantRows(rig.store, UID);
    const again = await resetAs(rig, UID, "v1", "r1", ZONE);
    expect(again.body).toEqual(first.body);
    expect(await listTenantRows(rig.store, UID)).toEqual(before);
  });

  it("a second visit gets a new namespace, and nothing of the first remains", async () => {
    const rig = testRig();
    const a = await resetAs(rig, UID, "v1", "r1", ZONE);
    const b = await resetAs(rig, UID, "v2", "r2", ZONE);
    expect(b.body.fixtureNamespace).not.toBe(a.body.fixtureNamespace);
    expect((await stateOf(rig.store, UID)).visitId).toBe(testId("visit-v2"));
  });

  it("closes an open call before it clears anything", async () => {
    const rig = testRig();
    expect((await resetAs(rig, UID, "v1", "r1", ZONE)).status).toBe(200);
    const sessionId = await openWithCall(rig, ["rtc_1", "rtc_2"]);
    rig.openai.always("realtime.calls.hangup", ok(null));
    expect((await resetAs(rig, UID, "v2", "r2", ZONE)).status).toBe(200);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(2);
    expect(await rig.store.get(UID, paths.session(UID, sessionId))).toBeNull();
  });

  it("a hangup that fails keeps the barrier and the rows, writes the hangup Job, and asks for a retry", async () => {
    const rig = testRig();
    expect((await resetAs(rig, UID, "v1", "r1", ZONE)).status).toBe(200);
    const sessionId = await openWithCall(rig, ["rtc_1"]);
    rig.openai.always("realtime.calls.hangup", fail(new Error("openai 500")));
    const before = (await listTenantRows(rig.store, UID)).filter((r) => r.path.includes("/evidence/")).length;
    const res = await resetAs(rig, UID, "v2", "r2", ZONE);
    expect(res.status).toBe(503);
    const epoch = (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
    expect(epoch.barrier).toMatchObject({ phase: "close" });
    expect((await listTenantRows(rig.store, UID)).filter((r) => r.path.includes("/evidence/")).length).toBe(before);
    expect((await rig.store.get<Job>(UID, paths.job(UID, hangupJobId(sessionId, rig.deps.hasher))))!.data.kind).toBe("hangup");
    // While the barrier is up the tenant is blocked; the same request retried after the hangup recovers finishes it.
    rig.openai.always("realtime.calls.hangup", ok(null));
    const retry = await resetAs(rig, UID, "v2", "r2", ZONE);
    expect(retry.status).toBe(200);
    expect((await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data.barrier).toBeNull();
  });

  it("refuses an account with data of its own, and changes nothing", async () => {
    const rig = testRig();
    await commitUserTurnForTest(rig.store, UID, testId("t1"), "My dog is called Pip", rig.clock, rig.deps.hasher);
    const before = await listTenantRows(rig.store, UID);
    const res = await resetAs(rig, UID, "v1", "r1", ZONE);
    expect(res.status).toBe(403);
    const after = (await listTenantRows(rig.store, UID)).filter((r) => !r.path.includes("/ledger/"));
    expect(after).toEqual(before.filter((r) => !r.path.includes("/ledger/")));
    expect((await stateOf(rig.store, UID)).clockMode).toBe("live");
  });

  it("refuses with BARRIER while another control operation holds the tenant", async () => {
    const rig = testRig();
    expect((await resetAs(rig, UID, "v1", "r1", ZONE)).status).toBe(200);
    const now = tsFromMs(rig.clock.read().opsClock.now);
    await patchRecord<CoreEpoch>(rig.store, UID, paths.core(UID, "epoch"), { barrier: { opId: testId("forget-op"), phase: "resolve", startedAt: now, deadline: now, queuedOps: [] } });
    const res = await resetAs(rig, UID, "v2", "r2", ZONE);
    expect(res.status).toBe(423);
    expect((await stateOf(rig.store, UID)).visitId).toBe(testId("visit-v1"));
  });

  it("answers SCOPE for a fixture it does not hold", async () => {
    const rig = testRig();
    const res = await callRoute(rig, seedResetRoute, { requestId: testId("r1"), sessionId: null, fixtureId: testId("no-such-fixture"), visitId: testId("v1") });
    expect(res.status).toBe(404);
    expect(PERSONA_FIXTURE_ID).toHaveLength(43);
  });

  it("the clone's state reads back as valid core/state", async () => {
    const rig = testRig();
    await resetAs(rig, UID, "v1", "r1", ZONE);
    const state: CoreState = await stateOf(rig.store, UID);
    expect(state.coverage).toMatchObject({ state: "complete", missingRanges: [] });
  });
});
