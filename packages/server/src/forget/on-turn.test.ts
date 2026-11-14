// Brief 048 stage 3: a forget admitted on /api/turn fences in the turn's own transaction, hangs up every call and is
// driven by the route inside FORGET_ROUTE_BUDGET_MS.
import { type CoreEpoch, type Evidence, type Job, type Session, type Turn } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { hangupJobId } from "../worker/hangup";
import { fakeForgetResolve } from "./resolve-port";

const UID = "owner-1";
const items = (n: number) => [{ itemId: `item_${n}`, commitSeq: n }];
type Rig = ReturnType<typeof testRig>;

async function rig(): Promise<{ rig: Rig; s: Awaited<ReturnType<typeof openTestSession>>; resolve: ReturnType<typeof fakeForgetResolve> }> {
  const r = testRig();
  const resolve = fakeForgetResolve(() => ({ resolution: "none", remove: [], candidateIds: [], entityIds: [], topicKeys: [], needsMore: false, clarification: null }));
  r.deps.forgetResolve = resolve;
  const s = await openTestSession(r);
  return { rig: r, s, resolve };
}
const post = (r: Rig, body: unknown) => settle(callRoute(r, turnRoute, body), r.clock, r.timers).then((x) => x.value);
const jobs = async (r: Rig) => (await r.store.query<Job>(UID, { collection: paths.collection(UID, "jobs"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).map((j) => j.data);
const evidence = async (r: Rig) => (await r.store.query<Evidence>(UID, { collection: paths.collection(UID, "evidence"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).map((e) => e.data);

describe("forget on /api/turn (brief 048 rulings 3 to 6)", () => {
  it("a spoken forget in a call: the request turn dies with no Evidence, the call's Session closes, its hangup Job is due, the forget job runs", async () => {
    const { rig: r, s, resolve } = await rig();
    await patchRecord<Session>(r.store, UID, paths.session(UID, s.sessionId), { callId: "rtc_1", registeredCallIds: ["rtc_1"] });
    r.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
    const res = await post(r, asrTurn(s.stamp, 1, "forget what I said about my brother", items(1)));
    expect(res.body).toMatchObject({ status: "blocked", permit: null, notes: [] });

    const turn = (await r.store.get<Turn>(UID, paths.turn(UID, s.sessionId, testId("turn-1"))))!.data;
    expect(turn).toMatchObject({ state: "dead", evidenceId: null, rootSlices: [] });
    expect((await evidence(r)).some((e) => e.turnId === testId("turn-1"))).toBe(false);
    const all = await jobs(r);
    expect(all.some((j) => j.kind === "extract")).toBe(false);
    expect(all.find((j) => j.kind === "forget")).toBeDefined();
    const hangup = await r.store.get<Job>(UID, paths.job(UID, hangupJobId(s.sessionId, r.deps.hasher)));
    expect(hangup).not.toBeNull();
    const session = (await r.store.get<Session>(UID, paths.session(UID, s.sessionId)))!.data;
    expect(["closing", "closed"]).toContain(session.status);
    // The route drove the job: its own resolver read the request by ID, after the commit.
    expect(resolve.calls.length).toBeGreaterThan(0);
    expect(resolve.calls[0]!.request.quote).toContain("brother");
  });

  it("a typed forget with no call open: a postCommitControl ack, no call to hang up, the barrier is up or already cleared", async () => {
    const { rig: r, s } = await rig();
    r.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
    const res = await post(r, typedTurn(s.stamp, 1, "forget what I said about my brother"));
    expect(res.body).toMatchObject({ permit: { kind: "postCommitControl", scope: "ack" } });
    const turn = (await r.store.get<Turn>(UID, paths.turn(UID, s.sessionId, testId("turn-1"))))!.data;
    expect(turn).toMatchObject({ state: "dead", evidenceId: null });
    expect((await jobs(r)).filter((j) => j.kind === "hangup")).toHaveLength(0);
    const epoch = (await r.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
    expect(epoch.epoch).toBeGreaterThan(1);
  });

  it("counts the store round trips of one forget through the route", async () => {
    const { rig: r, s } = await rig();
    await patchRecord<Session>(r.store, UID, paths.session(UID, s.sessionId), { callId: "rtc_1", registeredCallIds: ["rtc_1"] });
    r.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
    const n = { get: 0, query: 0, transaction: 0 };
    const store = r.store as unknown as Record<"get" | "query" | "transaction", (...a: unknown[]) => Promise<unknown>>;
    for (const k of ["get", "query", "transaction"] as const) {
      const f = store[k]!.bind(r.store);
      store[k] = (...a: unknown[]) => ((n[k] += 1), f(...a));
    }
    await post(r, asrTurn(s.stamp, 1, "forget what I said about my brother", items(1)));
    r.deps.log("test.forgetRoundTrips", n);
    if (process.env.FORGET_TRIPS) console.log("forget route round trips", JSON.stringify(n), JSON.stringify((await jobs(r)).map((j) => [j.kind, j.status, (j.payload as { phase?: string }).phase])));
    expect(n.transaction).toBeGreaterThan(0);
  });
});
