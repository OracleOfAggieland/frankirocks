/**
 * The open's budget is the contract; a proactive line is optional (coordinator ruling on brief 042, after the
 * emulator's `open-retry` cases with a 75 ms round trip took 3.7 s). In memory with live timers and the live clock,
 * and a round trip added to every store read and commit, like `tests/firestore/open-retry.test.ts`: the open answers
 * inside `OPEN_BUDGET_MS`, with or without a `Proactive`, never after it.
 */
import type { Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { liveClockPort } from "../clock/live-clock";
import { liveTimers } from "../clock/timers";
import { FakeOpenAI, type OpenAIPort, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { type Reader, type StorePort, readSnapshot } from "../store/port";
import { commitUserTurnForTest, extractOutput, factItem } from "../testing/extract-fixtures";
import { FakeFastSlots } from "../testing/fake-fast-slots";
import { TEST_ENV, fakeRequest, fakeTokenVerifier, patchRecord, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { openTestSession } from "../testing/session-fixtures";
import { idleProactive, openingProactive } from "./delivery-wire";
import { OPEN_BUDGET_MS, openRoute } from "./open";
import { type RouteDeps, runRoute } from "./runtime";

const UID = "owner-1";
const LINE = "My dog is called Pip";

/** The store with a round trip added to every read and commit; `calls` counts them. */
function distantStore(inner: StorePort, rttMs: number, calls: { n: number }): StorePort {
  const rtt = () => {
    calls.n++;
    return liveTimers.sleep(rttMs);
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
        const r = await fn({ ...tx, ...distant(tx) });
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

async function liveRig(opts: { rttMs: number; hangupMs: number; extractMs: number; seeded: boolean }) {
  const base = testRig();
  if (opts.seeded) await resetAs(base, UID, "v1", "r1");
  const calls = { n: 0 };
  const fake = new FakeOpenAI();
  fake.always("realtime.calls.hangup", ok(null));
  const work: Promise<unknown>[] = [];
  const deps: RouteDeps = {
    ...base.deps,
    store: distantStore(base.store, opts.rttMs, calls),
    clock: liveClockPort,
    timers: liveTimers,
    openai: slowOpenAI(fake, (endpoint) => liveTimers.sleep(endpoint === "responses.create" ? opts.extractMs : opts.hangupMs)),
    tokens: fakeTokenVerifier(),
    fastSlots: new FakeFastSlots(),
  };
  const schedule = (fn: () => Promise<unknown>) => void work.push(fn().catch(() => undefined));
  const open = async (label: string, previousSessionId: string | null) => {
    const t0 = liveClockPort.read().opsClock.now;
    const before = calls.n;
    const res = await runRoute(openRoute, fakeRequest({ body: { requestId: testId(label), initiator: "user", previousSessionId, clientZone: "America/Chicago", visitId: null } }), deps, schedule);
    return { status: res.status, body: res.body as any, ms: liveClockPort.read().opsClock.now - t0, calls: calls.n - before };
  };
  const settled = async () => {
    while (work.length > 0) await work.shift();
  };
  return { deps, fake, open, settled, calls };
}

/** The open with a prior Session that has a live call and a slow extract, as the emulator case. */
async function openAfterPrior(opts: { rttMs: number; seeded: boolean }) {
  const r = await liveRig({ rttMs: opts.rttMs, hangupMs: 1_500, extractMs: 8_000, seeded: opts.seeded });
  const s0 = await r.open("open0", null);
  expect(s0.status).toBe(200);
  await r.settled();
  await patchRecord<Session>(r.deps.store, UID, paths.session(UID, s0.body.sessionId), { status: "active", registeredCallIds: ["rtc_0"], callId: "rtc_0" });
  const turn = await commitUserTurnForTest(r.deps.store, UID, testId("t1"), LINE, liveClockPort, r.deps.hasher);
  const item = factItem("statement", "new", "The owner's dog is called Pip", [{ eid: turn.eid, fieldPath: "text", start: 0, end: LINE.length, quote: LINE }]);
  r.fake.always("responses.create", ok(completed(JSON.stringify(extractOutput([item])))));
  const next = await r.open("openA", s0.body.sessionId);
  return next;
}

describe("the open answers inside its budget, with or without a Proactive", () => {
  for (const seeded of [false, true]) {
    it(`75 ms a store call, a 1.5 s hang-up of the prior Session (${seeded ? "seeded persona" : "new owner"})`, async () => {
      const res = await openAfterPrior({ rttMs: 75, seeded });
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("connecting");
      expect(res.ms).toBeLessThan(OPEN_BUDGET_MS);
    }, 30_000);
  }
});

describe("the state route's idle read stays inside what it is given", () => {
  it("200 ms a store call: a 500 ms budget answers in time, with no whisper", async () => {
    const base = testRig();
    await resetAs(base, UID, "v1", "r1");
    const s = await openTestSession(base, "o1", `token:${UID}`);
    const calls = { n: 0 };
    const ctx = { uid: UID, deps: { ...base.deps, store: distantStore(base.store, 200, calls), clock: liveClockPort, timers: liveTimers }, schedule: () => undefined };
    const t0 = liveClockPort.read().opsClock.now;
    const line = await idleProactive(ctx, s.stamp, 500);
    expect(liveClockPort.read().opsClock.now - t0).toBeLessThan(650);
    expect(line).toBeNull();
    // Unbounded, the same read takes longer than the budget: the bound is what kept it in time.
    const t1 = liveClockPort.read().opsClock.now;
    await idleProactive(ctx, s.stamp);
    expect(liveClockPort.read().opsClock.now - t1).toBeGreaterThan(500);
  }, 30_000);
});

describe("a store failure in delivery's reads fails nothing (brief 045 finding 9)", () => {
  it("the open's and the idle read's own reads throwing: no line, no error", async () => {
    const base = testRig();
    await resetAs(base, UID, "v1", "r1");
    const s = await openTestSession(base, "o1", `token:${UID}`);
    const broken: StorePort = {
      ...base.store,
      get: async () => {
        throw new Error("blip");
      },
      query: async () => {
        throw new Error("blip");
      },
      transaction: (uid, fn) => base.store.transaction(uid, fn),
      snapshot: (uid, fn) => base.store.snapshot(uid, fn),
    };
    const ctx = { uid: UID, deps: { ...base.deps, store: broken, clock: liveClockPort, timers: liveTimers }, schedule: () => undefined };
    await expect(openingProactive(ctx, s.stamp, 2_000)).resolves.toBeNull();
    await expect(idleProactive(ctx, s.stamp)).resolves.toBeNull();
    await expect(idleProactive(ctx, s.stamp, 1_000)).resolves.toBeNull();
  }, 30_000);
});
