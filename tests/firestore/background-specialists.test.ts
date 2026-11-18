import { randomUUID } from "node:crypto";
import { OpenResponse, StateResponse, ToolResponse, TurnResponse } from "@franki/core";
import { testId } from "@franki/core/testing";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, expect, it, vi } from "vitest";
import { liveTimers } from "../../packages/server/src/clock/timers";
import type { OpenAIPort } from "../../packages/server/src/openai/fake";
import { completed } from "../../packages/server/src/openai/responses";
import { saveCarrierEvent } from "../../packages/server/src/phone/callback";
import type { Dial } from "../../packages/server/src/phone/twilio";
import { openRoute } from "../../packages/server/src/routes/open";
import { type RouteSpec, parseWith, runRoute } from "../../packages/server/src/routes/runtime";
import { stateRoute } from "../../packages/server/src/routes/state";
import { toolRoute } from "../../packages/server/src/routes/tool";
import { turnRoute } from "../../packages/server/src/routes/turn";
import { type WebSearchEntry, runWebSearchTask, webSearchId } from "../../packages/server/src/search/tasks";
import { FirestoreStore } from "../../packages/server/src/store/firestore-store";
import { paths } from "../../packages/server/src/store/paths";
import { TEST_ENV, fakeRequest, testRig } from "../../packages/server/src/testing/fakes";
import { asrTurn } from "../../packages/server/src/testing/session-fixtures";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Run with the Firestore emulator");
const app = initializeApp({ projectId: "demo-franki" }, "background-specialists");
const db = getFirestore(app);
afterAll(() => deleteApp(app));

it("commits another spoken turn while a leased search and carrier callbacks update the same session", async () => {
  const uid = randomUUID();
  const rig = testRig({
    ...TEST_ENV, TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "test",
    TWILIO_PHONE_NUMBER: "+14155550100", OPENAI_PROJECT_ID: "proj_test", OPENAI_WEBHOOK_SECRET: "test",
    FRANKI_PHONE_REPORT_ORIGIN: "https://frankirocks.com",
  });
  const sid = "CA" + "a".repeat(32);
  const dial = vi.fn<Dial>().mockResolvedValue(sid);
  const finding = { text: "The gallery opens at ten.", sources: [{ title: "Gallery hours", url: "https://example.org/gallery" }] };
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const hostedSearch = vi.fn(async () => {
    enter();
    await released;
    return { ...completed(finding.text), webSearchFindings: [finding] };
  });
  const openai: OpenAIPort = {
    call(endpoint, body, options) {
      const tools = (body as { tools?: { type: string }[] }).tools;
      if (endpoint === "responses.create" && tools?.some((t) => t.type === "web_search")) return hostedSearch();
      return rig.openai.call(endpoint, body, options);
    },
  };
  const deps = { ...rig.deps, openai, dial, timers: liveTimers, store: new FirestoreStore(db, rig.deps.hasher) };
  const ctx = { uid, deps, schedule: rig.sched.schedule };
  async function post<T>(route: RouteSpec<T>, body: unknown) {
    const res = await runRoute(route, fakeRequest({ token: "token:" + uid, body }), deps, ctx.schedule);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  }
  const opened = parseWith(OpenResponse, await post(openRoute, {
    requestId: testId("open"), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: null,
  }));
  const { sessionId, generation, deck } = opened;
  if (!deck) throw new Error("Expected an open session");
  const seen = { epoch: deck.epoch, policyRev: deck.policyRev, rulesRev: deck.rulesRev, bundleRev: deck.bundleRev };
  const stamp = { sessionId, generation, ...seen };
  const say = async (seq: number, transcript: string) => parseWith(TurnResponse, await post(turnRoute, {
    ...asrTurn(stamp, seq, transcript, [{ itemId: "audio-" + seq, commitSeq: seq }]), judge: "O",
  }));
  const poll = async () => parseWith(StateResponse, await post(stateRoute, {
    sessionId, generation, seen, ackStamp: null, speechStartedOpsAt: null, includeSpecialists: true, includeTaskActivity: true,
  }));
  const first = await say(1, "Call 415 555 0123 and ask for the shop hours.");
  await post(toolRoute, { requestId: testId("phone"), stamp: first.stamp, callId: "phone", tool: { name: "make_phone_call", args: {} } });
  expect(dial).toHaveBeenCalledTimes(1);
  const dialId = dial.mock.calls[0]![2];
  await saveCarrierEvent(deps, uid, { dialId, sid, status: "ringing" });
  const second = await say(2, "What are the City Gallery hours in Austin?");
  const start = parseWith(ToolResponse, await post(toolRoute, { requestId: testId("search"), stamp: second.stamp, callId: "search",
    tool: { name: "search_web", args: { query: "City Gallery hours", local: true, location: "Austin" } },
  }));
  expect(start.result).toMatchObject({ name: "search_web", state: "started" });
  expect(hostedSearch).not.toHaveBeenCalled();
  const taskId = webSearchId(ctx, second.stamp);
  const worker = runWebSearchTask(ctx, taskId);
  try {
    await Promise.race([entered, worker.then(() => { throw new Error("Worker returned without starting search"); })]);
    // A duplicate dispatch races the outstanding provider request and must finish on its own lease read.
    await runWebSearchTask(ctx, taskId);
    expect(await poll()).toMatchObject({
      phoneActivity: [{ dialId, status: "ringing", completion: "active" }], webSearch: { status: "searching", cards: [] }, proactive: null,
    });
    const third = await say(3, "Tell me a story while we wait.");
    expect(third.permit).not.toBeNull();
    await saveCarrierEvent(deps, uid, { dialId, sid, status: "completed" });
    await saveCarrierEvent(deps, uid, { dialId, sid, status: "ringing" });
    expect(await poll()).toMatchObject({
      stamp, phoneActivity: [{ dialId, status: "ended", completion: "awaitingReport" }], webSearch: { status: "searching" }, proactive: null,
    });
  } finally {
    release();
    await worker;
  }
  expect(await poll()).toMatchObject({
    stamp, phoneActivity: [{ dialId, status: "ended" }],
    webSearch: { status: "found", cards: [{ lines: [finding.text], citations: finding.sources }] }, proactive: null,
  });
  const stored = await deps.store.get<WebSearchEntry>(uid, paths.ledger(uid, taskId));
  expect(stored?.data.payload).toMatchObject({ status: "found", attempts: 1, leaseUntil: null, query: null, location: null });
  expect(hostedSearch).toHaveBeenCalledTimes(1);
});
