// Feature: forget on the wire (brief 048 stage 5): every route waits. While a forget's barrier is up, every door
// answers BARRIER (HTTP 423) and lets nothing in: the turn route (an ordinary turn, a second forget), a trusted tap,
// a tool call, the state route, a receipt, every memory view, the clock advance, and the open, which answers its
// `blocked` state. A forget asked during a reset is refused, on the route and at the fence itself.
//
// The barrier is held up by the forget's own resolve, which fails until the test lets it answer; the forget is asked
// on /api/turn, spoken in a call or typed with no call. The routes are called on a second device's Session, which has
// no call and stays open, so each answer is the barrier's and not a closed Session's. The oracle reads only
// `core/epoch.barrier` and each route's own answer.
import { type CoreEpoch, type ID, type Job, type Session, tsFromMs } from "@franki/core";
import { nrWorldArb, sampleSession, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ensureCoreDocs } from "../core-docs";
import { fail, ok } from "../openai/fake";
import { memoryRoute } from "../routes/memory";
import { openRoute } from "../routes/open";
import { receiptRoute } from "../routes/receipt";
import { seedAdvanceRoute } from "../routes/seed-advance";
import { seedResetRoute } from "../routes/seed-reset";
import { stateRoute } from "../routes/state";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { PERSONA_FIXTURE_ID } from "../seed/persona";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { commitUserTurnForTest, insertTurnForTest } from "../testing/extract-fixtures";
import { callRoute, patchRecord, runScheduled, settle, testRig } from "../testing/fakes";
import { openTestSession } from "../testing/session-fixtures";
import { runDueJobs } from "../worker/tick";
import { fenceForget } from "./fence";
import type { ForgetResolvePort } from "./resolve-port";
import { type RouteWorld, forgetByRoute, forgetText, postTurn, routeWorld, stampOf, turnBody, workUntilForgotten } from "./testing/route-world";
import { WORLD_UID, forgetJobsOf, worldResolver } from "./testing/world";

const UID = WORLD_UID;
const RUNS = Number(process.env.WAITS_RUNS ?? 60);
const DEVICE = testId("waits-device-b");
const DEVICE_TURN = testId("waits-device-turn");

type Door = "turn" | "forget" | "tap" | "tool" | "state" | "receipt" | "memory" | "advance" | "open" | "tick";
const doorArb = fc.constantFrom<Door>("turn", "forget", "tap", "tool", "state", "receipt", "memory", "advance", "open", "tick");
const VIEWS = ["overview", "lab", "strip", "receipt", "item", "why"] as const;

/** A second device: an open Session with no call, and one committed owner turn for the tool door. */
async function addDevice(s: RouteWorld): Promise<void> {
  const { store, clock, hasher } = s.rig.deps;
  await store.transaction(UID, async (tx) => tx.create(paths.session(UID, DEVICE), sampleSession({ uid: UID, status: "active", registeredCallIds: [], callId: null })));
  const committed = await commitUserTurnForTest(store, UID, DEVICE_TURN, "The weather is mild today.", clock, hasher);
  await insertTurnForTest(store, UID, DEVICE, DEVICE_TURN, { seq: 1, evidenceId: committed.eid, text: "The weather is mild today.", parseState: "committed", itemIds: ["item_waits_b"], committedAt: tsFromMs(clock.read().opsClock.now) });
  await patchRecord<Session>(store, UID, paths.session(UID, DEVICE), { nextClientSeq: 2, lastClientSeq: 1, committedParseSeq: 1 });
}

const barrierOf = async (s: { rig: { store: RouteWorld["rig"]["store"] } }) => (await s.rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data.barrier;
const isBarrier = (res: { status: number; body: any }) => res.status === 423 && (res.body?.error === "BARRIER" || res.body?.error?.code === "BARRIER");

/** Knocks on one door; returns what it answered, or null when the answer was the barrier's. */
async function knock(s: RouteWorld, door: Door, n: number): Promise<string | null> {
  const { rig } = s;
  const go = async (route: Parameters<typeof callRoute>[1], body: unknown, req?: Parameters<typeof callRoute>[3]) => (await settle(callRoute(rig, route, body, req), rig.clock, rig.timers)).value;
  const stamp = await stampOf(s, DEVICE);
  const said = (res: { status: number; body: any }) => (isBarrier(res) ? null : `${res.status} ${JSON.stringify(res.body).slice(0, 400)}`);
  switch (door) {
    case "turn":
      return said(await postTurn(s, turnBody(stamp, 2, "What should I cook tonight?", `waits-turn-${n}`, {})));
    case "forget":
      rig.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
      return said(await postTurn(s, turnBody(stamp, 2, forgetText(s.w, s.w.target), `waits-forget-${n}`, {})));
    case "tap":
      return said(await postTurn(s, { ...turnBody(stamp, 2, "", `waits-tap-${n}`, {}), source: "trustedTap", transcript: "", uiControl: { verb: "company", targetIds: [] } }));
    case "tool":
      return said(await go(toolRoute, { requestId: testId(`waits-tool-${n}`), stamp: { ...stamp, turnId: DEVICE_TURN }, callId: `call_${n}`, tool: { name: "recall", args: { purpose: "answer", query: "weather", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "both" } } }));
    case "state":
      return said(await go(stateRoute, { sessionId: DEVICE, generation: stamp.generation, seen: { epoch: stamp.epoch, policyRev: stamp.policyRev, bundleRev: stamp.bundleRev, rulesRev: stamp.rulesRev }, ackStamp: null, speechStartedOpsAt: null }));
    case "receipt":
      return said(await go(receiptRoute, { requestId: testId(`waits-rcpt-${n}`), stamp: { ...stamp, turnId: DEVICE_TURN }, responseId: `resp_${n}`, kind: "transcript", momentIds: [], noteIds: [], pendingId: null, permitKind: null, text: "It is mild out." }));
    case "memory": {
      for (const view of VIEWS) {
        const qs = new URLSearchParams({ view, ...(view === "item" || view === "why" ? { id: s.memoryIds[0]! } : {}) });
        const res = await go(memoryRoute, undefined, { method: "GET", url: `http://localhost:3000/api/memory?${qs}`, origin: null });
        if (!isBarrier(res)) return `memory ${view}: ${said(res)}`;
      }
      return null;
    }
    case "advance": {
      const to = tsFromMs(rig.clock.read().worldClock.now + 3_600_000);
      return said(await go(seedAdvanceRoute, { requestId: testId(`waits-adv-${n}`), fixtureNamespace: testId("waits-ns"), to }));
    }
    case "open": {
      const res = await go(openRoute, { requestId: testId(`waits-open-${n}`), initiator: "user", previousSessionId: DEVICE, clientZone: "America/Chicago", visitId: null });
      return res.status === 200 && res.body.state === "blocked" && res.body.deck === null && res.body.proactive === null ? null : `${res.status} ${JSON.stringify(res.body).slice(0, 400)}`;
    }
    case "tick":
      await runScheduled(rig);
      await settle(runDueJobs(s.ctx), rig.clock, rig.timers);
      return null;
  }
}

async function run(w: Parameters<typeof routeWorld>[0], inCall: boolean, doors: Door[]): Promise<void> {
  const s = await routeWorld(w, inCall);
  let held = true;
  const inner = worldResolver(s);
  const resolver: ForgetResolvePort = {
    resolve: async (input) => {
      if (held) throw new Error("the resolve is held by the test");
      return inner.resolve(input);
    },
  };
  (s.rig.deps as { forgetResolve?: ForgetResolvePort }).forgetResolve = resolver;
  await addDevice(s);
  const why = `${inCall ? "spoken in a call" : "typed, no call"}; doors: ${doors.join(", ")}`;
  const res = await forgetByRoute(s, w.target, "forget");
  expect(res.status, `${why}\n${JSON.stringify(res.body)}`).toBe(200);
  const opId = (await barrierOf(s))?.opId;
  expect(opId, `no barrier after the forget\n${why}`).toBeDefined();

  const jobsBefore = (await forgetJobsOf(s.rig.store)).length;
  for (let i = 0; i < doors.length; i++) {
    s.rig.clock.advance(1_000);
    const b = await barrierOf(s);
    expect(b?.opId, `the barrier came down while the resolve was held (before door ${i}, ${doors[i]})\n${why}`).toBe(opId);
    const answer = await knock(s, doors[i]!, i);
    if (answer !== null) expect.fail(`door ${i} (${doors[i]}) did not wait for the barrier: ${answer}\n${why}`);
  }
  // A second forget during this one is refused at the route: no job, no queued op.
  expect((await forgetJobsOf(s.rig.store)).length, `a door let a second forget in\n${why}`).toBe(jobsBefore);
  expect((await barrierOf(s))?.queuedOps ?? [], why).toEqual([]);

  // Once the resolve answers, the forget finishes and the doors open again.
  held = false;
  expect(await workUntilForgotten(s), `the forget never finished\n${why}`).toBe(true);
  expect(await barrierOf(s), why).toBeNull();
  for (const door of ["state", "memory", "open"] as const) {
    const answer = await knock(s, door, 1_000);
    expect(answer, `${door} still waits after the barrier came down\n${why}`).not.toBeNull();
  }
}

describe("every route waits (brief 048 stage 5)", () => {
  it("while a forget's barrier is up, every door answers BARRIER and the open answers blocked", async () => {
    await fc.assert(fc.asyncProperty(nrWorldArb, fc.boolean(), fc.array(doorArb, { minLength: 1, maxLength: 12 }), async (w, inCall, doors) => run(w, inCall, doors)), { numRuns: RUNS });
  }, 1_200_000);

  it("a forget during a reset is refused: on the route, and at the fence", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (spoken) => {
        const rig = testRig();
        await ensureCoreDocs(UID, rig.deps, "America/Chicago");
        // The reset finds a call it cannot hang up, so it fails retryably and its barrier stays (seed/reset.ts step 2).
        const first = await openTestSession(rig);
        await patchRecord<Session>(rig.store, UID, paths.session(UID, first.sessionId), { callId: "rtc_reset", registeredCallIds: ["rtc_reset"] });
        rig.openai.always("realtime.calls.hangup", fail(Object.assign(new Error("hang-up failed (test)"), { status: 500 })));
        rig.openai.always("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
        rig.openai.always("responses.create", fail(new Error("no model answer")));
        const reset = (await settle(callRoute(rig, seedResetRoute, { requestId: testId("waits-reset"), sessionId: null, fixtureId: PERSONA_FIXTURE_ID, visitId: testId("waits-visit"), clientZone: "America/Chicago" }), rig.clock, rig.timers)).value;
        const barrier = (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data.barrier;
        expect(barrier, `the reset left no barrier: ${reset.status} ${JSON.stringify(reset.body)}`).not.toBeNull();

        // A device whose Session is still open asks to forget, on the route.
        await rig.store.transaction(UID, async (tx) => tx.create(paths.session(UID, DEVICE), sampleSession({ uid: UID, status: "active", registeredCallIds: [], callId: null })));
        const epoch = (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
        const core = (await rig.store.get<{ bundleRev: number }>(UID, paths.core(UID, "bundle")))!.data;
        const rules = (await rig.store.get<{ rulesRev: number }>(UID, paths.core(UID, "rules")))!.data;
        const stamp = { sessionId: DEVICE, epoch: epoch.epoch, policyRev: epoch.policyRev, bundleRev: core.bundleRev, rulesRev: rules.rulesRev, generation: 1 };
        const body = turnBody(stamp, 1, "Forget what I said about my brother.", "waits-reset-forget", { spoken });
        const res = (await settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers)).value;
        expect(isBarrier(res), `the forget during a reset answered ${res.status} ${JSON.stringify(res.body)}`).toBe(true);

        // At the fence itself (the door any later control route uses).
        const fenced = await fenceForget(rig.store, UID, { sessionId: DEVICE as ID, requestId: "waits-reset-fence", requestTurnIds: [] }, rig.clock.read().opsClock.now, rig.deps.hasher);
        expect(fenced.kind, "a forget fenced during a reset").toBe("refused");

        const after = (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data.barrier;
        expect(after?.opId).toBe(barrier!.opId);
        expect(after?.queuedOps ?? []).toEqual([]);
        const jobs = await rig.store.query<Job>(UID, { collection: paths.collection(UID, "jobs"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
        expect(jobs.filter((j) => j.data.kind === "forget")).toEqual([]);
      }),
      { numRuns: 4 },
    );
  }, 600_000);
});
