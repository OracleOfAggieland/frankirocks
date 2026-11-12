/**
 * The open's budget is the contract; a proactive line is optional (coordinator ruling on brief 042, after the
 * emulator's `open-retry` cases with a 75 ms round trip took 3.7 s). In memory on the injected clock: every store read
 * and commit, each hang-up and the extract call advance the fake ops clock by their latency through the rig's timers,
 * like `tests/firestore/open-retry.test.ts` does in real time. No real sleeps; the times read are the clock port's.
 *
 * The open answers inside `OPEN_BUDGET_MS`, with or without a `Proactive`, never after it, and after delivery's
 * deadline it makes no store call before it answers (`OPEN_CALLS_AFTER_DELIVERY`).
 */
import type { Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { type FakeOpenAI, type OpenAIPort, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { type Reader, type StorePort, readSnapshot } from "../store/port";
import { commitUserTurnForTest, extractOutput, factItem } from "../testing/extract-fixtures";
import { type TestRig, callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { openTestSession } from "../testing/session-fixtures";
import { OPEN_ANSWER_MARGIN_MS, OPEN_CALLS_AFTER_DELIVERY, idleProactive, openingProactive } from "./delivery-wire";
import { OPEN_BUDGET_MS, openRoute } from "./open";

const UID = "owner-1";
const LINE = "My dog is called Pip";

interface Hooks {
  /** Before each `get` inside a transaction. */
  txGet(path: string): void;
  /** Before a transaction commits, given the paths it read. */
  beforeCommit(read: ReadonlySet<string>): Promise<void>;
}
const NO_HOOKS: Hooks = { txGet: () => undefined, beforeCommit: async () => undefined };

/** The store with `rttMs` of injected ops time added to every read and commit; `at` keeps each call's start time. */
function distantStore(rig: TestRig, inner: StorePort, rttMs: number, at: number[], hooks: Hooks = NO_HOOKS): StorePort {
  const rtt = () => {
    at.push(rig.clock.read().opsClock.now);
    return rig.timers.sleep(rttMs);
  };
  const distant = (reader: Reader): Reader => ({
    get: async (path) => (await rtt(), reader.get(path)),
    query: async (spec) => (await rtt(), reader.query(spec)),
  });
  return {
    get: async (uid, path) => (await rtt(), inner.get(uid, path)),
    query: async (uid, spec) => (await rtt(), inner.query(uid, spec)),
    transaction: (uid, fn) =>
      inner.transaction(uid, async (tx) => {
        const read = new Set<string>();
        const r = await fn({
          ...tx,
          ...distant({
            get: (path) => {
              hooks.txGet(path);
              read.add(path);
              return tx.get(path);
            },
            query: (spec) => tx.query(spec),
          }),
        });
        await hooks.beforeCommit(read);
        await rtt();
        return r;
      }),
    snapshot: (uid, fn) => readSnapshot(inner, uid, (reader) => fn(distant(reader))),
  };
}

function slowOpenAI(fake: FakeOpenAI, wait: (endpoint: string) => Promise<void>): OpenAIPort {
  return {
    async call(endpoint, body) {
      await wait(endpoint);
      return fake.call(endpoint, body);
    },
  };
}

/** The open with a prior Session that has a live call and a slow extract, as the emulator case. */
async function openAfterPrior(opts: { rttMs: number; hangupMs: number; extractMs: number; seeded: boolean }) {
  const rig = testRig();
  if (opts.seeded) await resetAs(rig, UID, "v1", "r1");
  const s0 = await callRoute(rig, openRoute, { requestId: testId("open0"), initiator: "user", previousSessionId: null, clientZone: "America/Chicago", visitId: opts.seeded ? testId("visit-v1") : null });
  expect(s0.status).toBe(200);
  await patchRecord<Session>(rig.store, UID, paths.session(UID, s0.body.sessionId), { status: "active", registeredCallIds: ["rtc_0"], callId: "rtc_0" });
  const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), LINE, rig.clock, rig.deps.hasher);
  const item = factItem("statement", "new", "The owner's dog is called Pip", [{ eid: turn.eid, fieldPath: "text", start: 0, end: LINE.length, quote: LINE }]);
  rig.openai.always("responses.create", ok(completed(JSON.stringify(extractOutput([item])))));
  rig.openai.always("realtime.calls.hangup", ok(null));
  const at: number[] = [];
  rig.deps.store = distantStore(rig, rig.store, opts.rttMs, at);
  rig.deps.openai = slowOpenAI(rig.openai, (endpoint) => rig.timers.sleep(endpoint === "responses.create" ? opts.extractMs : endpoint === "realtime.calls.hangup" ? opts.hangupMs : 0));
  const start = rig.clock.read().opsClock.now;
  const res = await callRoute(rig, openRoute, { requestId: testId("openA"), initiator: "user", previousSessionId: s0.body.sessionId, clientZone: "America/Chicago", visitId: opts.seeded ? testId("visit-v1") : null });
  const deliveryDeadline = start + OPEN_BUDGET_MS - OPEN_ANSWER_MARGIN_MS;
  return { res, ms: res.elapsedMs, calls: at.length, afterDeadline: at.filter((t) => t >= deliveryDeadline).length };
}

describe("the open answers inside its budget, with or without a Proactive", () => {
  for (const seeded of [false, true]) {
    it(`75 ms a store call, a 1.5 s hang-up of the prior Session (${seeded ? "seeded persona" : "new owner"})`, async () => {
      const r = await openAfterPrior({ rttMs: 75, hangupMs: 1_500, extractMs: 8_000, seeded });
      expect(r.res.status).toBe(200);
      expect(r.res.body.state).toBe("connecting");
      expect(r.ms).toBeLessThanOrEqual(OPEN_BUDGET_MS - OPEN_ANSWER_MARGIN_MS);
      expect(r.afterDeadline).toBe(OPEN_CALLS_AFTER_DELIVERY);
    });
  }

  it("with no round trip, the seeded open answers well inside it", async () => {
    const r = await openAfterPrior({ rttMs: 0, hangupMs: 300, extractMs: 1_500, seeded: true });
    expect(r.res.status).toBe(200);
    expect(r.ms).toBeLessThan(OPEN_BUDGET_MS);
  });
});

describe("the retry that collides with extraction (the emulator's `collide` case, on the injected clock)", () => {
  it("75 ms a store call: the retry answers inside the budget, with no store call after delivery's deadline", async () => {
    const rig = testRig();
    const rtt = 75;
    let armed = false;
    let released = false;
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    let epochRead: () => void = () => undefined;
    const extractReadEpoch = new Promise<void>((resolve) => (epochRead = resolve));
    // As the emulator test: before the open transaction that read core/bundle commits, the extract call answers and
    // its commit reads core/epoch; then two round trips and 20 ms more.
    const hooks: Hooks = {
      txGet(path) {
        if (released && path.endsWith("/core/epoch")) epochRead();
      },
      async beforeCommit(read) {
        if (!armed || ![...read].some((p) => p.endsWith("/core/bundle"))) return;
        armed = false;
        released = true;
        answer();
        await Promise.race([extractReadEpoch, rig.timers.sleep(2_000)]);
        await rig.timers.sleep(2 * rtt + 20);
      },
    };
    const s0 = await callRoute(rig, openRoute, { requestId: testId("open0"), initiator: "user", previousSessionId: null, clientZone: "America/Chicago", visitId: null });
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s0.body.sessionId), { status: "active", registeredCallIds: ["rtc_0"], callId: "rtc_0" });
    const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), LINE, rig.clock, rig.deps.hasher);
    const item = factItem("statement", "new", "The owner's dog is called Pip", [{ eid: turn.eid, fieldPath: "text", start: 0, end: LINE.length, quote: LINE }]);
    rig.openai.always("responses.create", ok(completed(JSON.stringify(extractOutput([item])))));
    rig.openai.always("realtime.calls.hangup", ok(null));
    const at: number[] = [];
    rig.deps.store = distantStore(rig, rig.store, rtt, at, hooks);
    rig.deps.openai = slowOpenAI(rig.openai, (endpoint) => (endpoint === "responses.create" ? answered : endpoint === "realtime.calls.hangup" ? rig.timers.sleep(1_500) : Promise.resolve()));
    const first = await callRoute(rig, openRoute, { requestId: testId("openA"), initiator: "user", previousSessionId: s0.body.sessionId, clientZone: "America/Chicago", visitId: null });
    expect(first.elapsedMs).toBeLessThanOrEqual(OPEN_BUDGET_MS - OPEN_ANSWER_MARGIN_MS);
    armed = true;
    const start = rig.clock.read().opsClock.now;
    at.length = 0;
    const second = await callRoute(rig, openRoute, { requestId: testId("openB"), initiator: "user", previousSessionId: null, clientZone: "America/Chicago", visitId: null });
    expect([second.status, second.body.state]).toEqual([200, "connecting"]);
    expect(second.elapsedMs).toBeLessThanOrEqual(OPEN_BUDGET_MS - OPEN_ANSWER_MARGIN_MS);
    expect(at.filter((t) => t >= start + OPEN_BUDGET_MS - OPEN_ANSWER_MARGIN_MS)).toHaveLength(OPEN_CALLS_AFTER_DELIVERY);
  });
});

describe("the state route's idle read stays inside what it is given", () => {
  it("200 ms a store call: a 500 ms budget answers in time, with no whisper", async () => {
    const rig = testRig();
    await resetAs(rig, UID, "v1", "r1");
    const s = await openTestSession(rig, "o1", `token:${UID}`);
    rig.clock.advance(60 * 60_000);
    const at: number[] = [];
    const ctx = { uid: UID, deps: { ...rig.deps, store: distantStore(rig, rig.store, 200, at) }, schedule: () => undefined };
    const bounded = await settle(idleProactive(ctx, s.stamp, 500), rig.clock, rig.timers);
    expect(bounded.elapsedMs).toBeLessThanOrEqual(500);
    expect(bounded.value).toBeNull();
    // Unbounded, the same read takes longer than the budget: the bound is what kept it in time.
    const unbounded = await settle(idleProactive(ctx, s.stamp), rig.clock, rig.timers);
    expect(unbounded.elapsedMs).toBeGreaterThan(500);
  });
});

describe("a store failure in delivery's reads fails nothing (brief 045 finding 9)", () => {
  it("the open's and the idle read's own reads throwing: no line, no error", async () => {
    const rig = testRig();
    await resetAs(rig, UID, "v1", "r1");
    const s = await openTestSession(rig, "o1", `token:${UID}`);
    const blip = async (): Promise<never> => {
      throw new Error("blip");
    };
    const broken: StorePort = { ...rig.store, get: blip, query: blip, transaction: (uid, fn) => rig.store.transaction(uid, fn), snapshot: (uid, fn) => rig.store.snapshot(uid, fn) };
    const ctx = { uid: UID, deps: { ...rig.deps, store: broken }, schedule: () => undefined };
    expect((await settle(openingProactive(ctx, s.stamp, 2_000), rig.clock, rig.timers)).value).toBeNull();
    expect((await settle(idleProactive(ctx, s.stamp), rig.clock, rig.timers)).value).toBeNull();
    expect((await settle(idleProactive(ctx, s.stamp, 1_000), rig.clock, rig.timers)).value).toBeNull();
  });
});
