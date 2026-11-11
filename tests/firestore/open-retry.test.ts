/**
 * Session open after a lost answer (brief 005 item 2), on the Firestore_Store against the emulator with live timers
 * and the live Clock_Port, so the times are real. Emulator only: run with `npm run test:emulator`.
 *
 * The live sequence from Nov 8, 2026: an open commits a Session but the browser has given up on its answer; that
 * open's extract drain lost its race and is still running through `schedule` with an Extract_Job; a second open
 * arrives with a new requestId and finds the first open's Session as the prior one.
 *
 * What the emulator showed before the fix: when the Extract_Job's commit ran while the retry's transaction was
 * open, the commit read core/epoch and waited to create its Memory inside the Memory range the open had read; the
 * open waited to write core/epoch. After a 2.2 s lock wait the emulator aborted the open (`10 ABORTED: Transaction
 * lock timeout`, so 409 STALE) and the retry took 5 s.
 */
import type { CoreEpoch, Job, Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { type App, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { liveClockPort } from "../../packages/server/src/clock/live-clock";
import { liveTimers } from "../../packages/server/src/clock/timers";
import { createHasher } from "../../packages/server/src/crypto";
import { FakeOpenAI, type OpenAIPort, ok } from "../../packages/server/src/openai/fake";
import { completed } from "../../packages/server/src/openai/responses";
import { OPEN_BUDGET_MS, openRoute } from "../../packages/server/src/routes/open";
import { type Log, type RouteDeps, type Schedule, runRoute } from "../../packages/server/src/routes/runtime";
import { FirestoreStore } from "../../packages/server/src/store/firestore-store";
import { paths } from "../../packages/server/src/store/paths";
import { type Reader, type StorePort, readSnapshot } from "../../packages/server/src/store/port";
import { commitUserTurnForTest, extractOutput, factItem } from "../../packages/server/src/testing/extract-fixtures";
import { FakeFastSlots } from "../../packages/server/src/testing/fake-fast-slots";
import { FAKE_HMAC_KEY, TEST_ENV, fakeRequest, fakeTokenVerifier, patchRecord } from "../../packages/server/src/testing/fakes";

const PROJECT = "demo-franki";
const UID = "owner-1";
const LINE = "My dog is called Pip";
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host === undefined) throw new Error("FIRESTORE_EMULATOR_HOST is not set; run through npm run test:emulator");

const app: App = initializeApp({ projectId: PROJECT }, "open-retry");
const db = getFirestore(app);

afterAll(async () => {
  await deleteApp(app);
});

async function clearEmulator(): Promise<void> {
  const res = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error(`emulator clear failed: ${res.status}`);
}

/** Fake_OpenAI behind a wait, so a call takes real time like the live one. */
function slowOpenAI(fake: FakeOpenAI, wait: (endpoint: string) => Promise<void>): OpenAIPort {
  return {
    async call(endpoint, body) {
      await wait(endpoint);
      return fake.call(endpoint, body);
    },
  };
}

/** Test hooks on the Store_Port wrapper. */
interface StoreHooks {
  /** Before each `get` inside a transaction. */
  txGet(path: string): void;
  /** Before a transaction commits, given the paths it read. */
  beforeCommit(read: ReadonlySet<string>): Promise<void>;
}

/**
 * The Store_Port with a round trip added to every read and commit, like a laptop to us-central1 (about 75 ms a
 * round trip, see firestore-store.ts).
 */
function distantStore(inner: StorePort, rttMs: number, hooks: StoreHooks): StorePort {
  const rtt = () => liveTimers.sleep(rttMs);
  const distant = (reader: Reader): Reader => ({
    get: async (path) => {
      await rtt();
      return reader.get(path);
    },
    query: async (spec) => {
      await rtt();
      return reader.query(spec);
    },
  });
  return {
    get: async (uid, path) => {
      await rtt();
      return inner.get(uid, path);
    },
    query: async (uid, spec) => {
      await rtt();
      return inner.query(uid, spec);
    },
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

interface Scenario {
  /** How long the extract call takes, or `collide`: it answers as the retry's transaction is about to commit. */
  extractMs: number | "collide";
  /** How long each hangup call takes (the prior close's budget is 1,000 ms). */
  hangupMs: number;
  /** Added to every Firestore read and commit. */
  rttMs: number;
}

interface Rig {
  deps: RouteDeps;
  fake: FakeOpenAI;
  logs: { event: string; fields: Record<string, unknown> }[];
  /** Like `after()`: starts the work at once and keeps it for `settled`. */
  schedule: Schedule;
  settled(): Promise<void>;
  backgroundErrors: unknown[];
  /** For `collide`: arms the hook for the next open transaction. */
  armCollision(): void;
}

function rig(s: Scenario): Rig {
  const hasher = createHasher(FAKE_HMAC_KEY);
  const fake = new FakeOpenAI();
  const logs: Rig["logs"] = [];
  const work: Promise<unknown>[] = [];
  const backgroundErrors: unknown[] = [];
  const log: Log = (event, fields) => logs.push({ event, fields });

  let armed = false;
  let released = false;
  let answer: () => void = () => {};
  const answered = new Promise<void>((resolve) => (answer = resolve));
  let epochRead: () => void = () => {};
  const extractReadEpoch = new Promise<void>((resolve) => (epochRead = resolve));
  const hooks: StoreHooks = {
    // After the release, the only transaction that reads core/epoch is the extract commit.
    txGet(path) {
      if (released && path.endsWith("/core/epoch")) epochRead();
    },
    // The open transaction is the one that read core/bundle. Before it commits, the extract call answers and its
    // commit reads core/epoch, then goes on to write its Memory, the order the live-like run showed.
    async beforeCommit(read) {
      if (!armed || ![...read].some((p) => p.endsWith("/core/bundle"))) return;
      armed = false;
      released = true;
      answer();
      await Promise.race([extractReadEpoch, liveTimers.sleep(2_000)]);
      await liveTimers.sleep(2 * s.rttMs + 20);
    },
  };
  const deps: RouteDeps = {
    store: distantStore(new FirestoreStore(db, hasher), s.rttMs, hooks),
    clock: liveClockPort,
    hasher,
    openai: slowOpenAI(fake, (endpoint) =>
      endpoint !== "responses.create" ? liveTimers.sleep(s.hangupMs) : s.extractMs === "collide" ? answered : liveTimers.sleep(s.extractMs),
    ),
    env: TEST_ENV,
    timers: liveTimers,
    tokens: fakeTokenVerifier(),
    log,
    fastSlots: new FakeFastSlots(),
  };
  return {
    deps,
    fake,
    logs,
    backgroundErrors,
    schedule: (fn) => {
      work.push(fn().catch((e: unknown) => backgroundErrors.push(e)));
    },
    async settled() {
      while (work.length > 0) await work.shift();
    },
    armCollision() {
      armed = s.extractMs === "collide";
    },
  };
}

const openBody = (label: string, previousSessionId: string | null) => ({
  requestId: testId(label),
  initiator: "user",
  previousSessionId,
  clientZone: "America/Chicago",
  visitId: null,
});

async function open(r: Rig, label: string, previousSessionId: string | null = null) {
  const t0 = liveClockPort.read().opsClock.now;
  const res = await runRoute(openRoute, fakeRequest({ body: openBody(label, previousSessionId) }), r.deps, r.schedule);
  return { ...res, body: res.body as any, ms: liveClockPort.read().opsClock.now - t0 };
}

const LIVE: readonly string[] = ["minting", "active", "quarantined", "closing"];

async function sessionsById(): Promise<Map<string, Session>> {
  const snap = await db.collection(paths.collection(UID, "sessions")).get();
  return new Map(snap.docs.map((d) => [d.id, d.data() as Session]));
}

beforeEach(async () => {
  await clearEmulator();
});

const SCENARIOS: Scenario[] = [
  // The extract call ends inside the first open's drain share, or after both opens.
  { extractMs: 1_500, hangupMs: 300, rttMs: 0 },
  { extractMs: 8_000, hangupMs: 300, rttMs: 0 },
  // Laptop to us-central1 round trips, and a cold hangup that outlasts the prior close's budget.
  { extractMs: 8_000, hangupMs: 1_500, rttMs: 75 },
  // The extract commit runs inside the retry's transaction.
  { extractMs: "collide", hangupMs: 300, rttMs: 0 },
  { extractMs: "collide", hangupMs: 1_500, rttMs: 75 },
];

describe("session open after a lost answer (emulator, real time)", () => {
  it.each(SCENARIOS)(
    "the retry answers 200 within the budget, closes the first Session and leaves one live Session (%o)",
    async (scenario) => {
      const r = rig(scenario);
      r.fake.always("realtime.calls.hangup", ok(null));

      // The call before: a Session with a registered call, and one committed user Turn with a queued Extract_Job.
      const s0 = await open(r, "open0");
      expect(s0.status).toBe(200);
      await r.settled();
      await patchRecord<Session>(r.deps.store, UID, paths.session(UID, s0.body.sessionId), { status: "active", registeredCallIds: ["rtc_0"], callId: "rtc_0" });
      const turn = await commitUserTurnForTest(r.deps.store, UID, testId("t1"), LINE, liveClockPort, r.deps.hasher);
      const item = factItem("statement", "new", "The owner's dog is called Pip", [{ eid: turn.eid, fieldPath: "text", start: 0, end: LINE.length, quote: LINE }]);
      r.fake.always("responses.create", ok(completed(JSON.stringify(extractOutput([item])))));
      r.logs.length = 0;

      // The first open commits; its answer is lost.
      const first = await open(r, "openA", s0.body.sessionId);
      expect(first.status).toBe(200);
      // The retry, with a new requestId, while the first open's drain is still running.
      r.armCollision();
      const second = await open(r, "openB", null);
      const phases = r.logs.filter((l) => l.event === "open.phases").map((l) => l.fields);
      const dependency = r.logs.filter((l) => l.event === "route.dependency").map((l) => l.fields);
      console.log(JSON.stringify({ scenario, firstMs: first.ms, secondMs: second.ms, phases, dependency }));

      expect(dependency).toEqual([]);
      expect([second.status, second.body.state]).toEqual([200, "connecting"]);
      expect(first.ms).toBeLessThan(OPEN_BUDGET_MS);
      expect(second.ms).toBeLessThan(OPEN_BUDGET_MS);

      const byId = await sessionsById();
      expect([...byId.values()].filter((s) => LIVE.includes(s.status))).toHaveLength(1);
      expect(byId.get(first.body.sessionId)!.status).toBe("closed");
      expect(byId.get(second.body.sessionId)!.status).toBe("minting");
      const epoch = (await r.deps.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
      expect(epoch.activeSessionId).toBe(second.body.sessionId);

      // The background drain finishes and the Memory is written.
      await r.settled();
      expect(r.backgroundErrors).toEqual([]);
      expect((await r.deps.store.get<Job>(UID, paths.job(UID, turn.jobId)))!.data.status).toBe("complete");
    },
    40_000,
  );
});
