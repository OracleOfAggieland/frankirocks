/**
 * Slow path timing (voice-control R23.2; tasks.md task 42), on the Firestore_Store against the emulator with live
 * timers and the live Clock_Port, so the times are real. Emulator only: run with `npm run test:emulator`.
 *
 * A held voice Turn (judge H) waits for its server Permit. The browser posts it about 500 ms after the commit, once
 * the transcript is in. Every Firestore read and commit costs 75 ms more (a laptop to us-central1, as in
 * open-retry.test.ts), and the fake Decisions answer takes 1,000 ms, the deadline on a call. The `/api/turn` response must be ready within
 * 2,500 ms of the commit, so within 2,000 ms of the post, on each of 20 runs. Over 2.5 s is a stop and report.
 */
import type { SS } from "@franki/core";
import { testId } from "@franki/core/testing";
import { type App, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveClockPort } from "../../packages/server/src/clock/live-clock";
import { liveTimers } from "../../packages/server/src/clock/timers";
import { createHasher } from "../../packages/server/src/crypto";
import { FakeOpenAI, type OpenAIPort, fail, ok } from "../../packages/server/src/openai/fake";
import { openRoute } from "../../packages/server/src/routes/open";
import { type Log, type RouteDeps, type Schedule, runRoute } from "../../packages/server/src/routes/runtime";
import { turnRoute } from "../../packages/server/src/routes/turn";
import { FirestoreStore } from "../../packages/server/src/store/firestore-store";
import { type Reader, type StorePort, readSnapshot } from "../../packages/server/src/store/port";
import { decisionAnswer } from "../../packages/server/src/testing/decisions";
import { FAKE_HMAC_KEY, TEST_ENV, fakeRequest, fakeTokenVerifier } from "../../packages/server/src/testing/fakes";
import { asrTurn } from "../../packages/server/src/testing/session-fixtures";

const PROJECT = "demo-franki";
const RTT_MS = 75;
/** The fake Decisions answer lands at the 1,000 ms deadline on a call, the worst case that is still on time (review of the live run, item 3). */
const DECISIONS_MS = 1_000;
/** The browser posts the Turn this long after the commit (the transcript's arrival). */
const COMMIT_TO_POST_MS = 500;
/** The held Turn's Permit must be ready by the commit + this (R23.2). */
const COMMIT_LIMIT_MS = 2_500;
const RUNS = 20;

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host === undefined) throw new Error("FIRESTORE_EMULATOR_HOST is not set; run through npm run test:emulator");

const app: App = initializeApp({ projectId: PROJECT }, "slow-path-timing");
const db = getFirestore(app);

afterAll(async () => {
  await deleteApp(app);
});

beforeAll(async () => {
  const res = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error(`emulator clear failed: ${res.status}`);
});

/** The Store_Port with a round trip added to every read and commit. */
function distantStore(inner: StorePort, rttMs: number): StorePort {
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
        const r = await fn({ ...tx, ...distant(tx) });
        await rtt();
        return r;
      }),
    snapshot: (uid, fn) => readSnapshot(inner, uid, (reader) => fn(distant(reader))),
  };
}

/** Fake_OpenAI with the Decisions answer at DECISIONS_MS. */
function timedOpenAI(fake: FakeOpenAI): OpenAIPort {
  return {
    async call(endpoint, body) {
      if (endpoint === "decisions.create") await liveTimers.sleep(DECISIONS_MS);
      return fake.call(endpoint, body);
    },
  };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

describe("the slow path for a held turn (emulator, real time; R23.2)", () => {
  it(
    `answers within ${COMMIT_LIMIT_MS} ms of a commit ${COMMIT_TO_POST_MS} ms before the post, on ${RUNS} runs`,
    async () => {
      const hasher = createHasher(FAKE_HMAC_KEY);
      const fake = new FakeOpenAI();
      fake.always("decisions.create", ok(decisionAnswer()));
      // Extraction runs after each response; its model call fails, which only requeues the job.
      fake.always("responses.create", fail(new Error("no extraction in this test")));
      fake.always("realtime.calls.hangup", ok(null));
      const work: Promise<unknown>[] = [];
      const schedule: Schedule = (fn) => {
        work.push(fn().catch(() => {}));
      };
      const log: Log = () => {};
      const deps: RouteDeps = {
        store: distantStore(new FirestoreStore(db, hasher), RTT_MS),
        clock: liveClockPort,
        hasher,
        openai: timedOpenAI(fake),
        env: TEST_ENV,
        timers: liveTimers,
        tokens: fakeTokenVerifier(),
        log,
      };

      const opened = await runRoute(
        openRoute,
        fakeRequest({ body: { requestId: testId("open1"), initiator: "user", previousSessionId: null, clientZone: "America/Chicago", visitId: null } }),
        deps,
        schedule,
      );
      expect(opened.status).toBe(200);
      const body = opened.body as { sessionId: string; deck: { epoch: number; policyRev: number; bundleRev: number; rulesRev: number } };
      const stamp: SS = { sessionId: body.sessionId, epoch: body.deck.epoch, policyRev: body.deck.policyRev, bundleRev: body.deck.bundleRev, rulesRev: body.deck.rulesRev, generation: 1 };
      for (const w of work.splice(0)) await w;

      const fromCommit: number[] = [];
      const kinds: string[] = [];
      for (let i = 1; i <= RUNS; i++) {
        const commitAt = liveClockPort.read().opsClock.now;
        await liveTimers.sleep(COMMIT_TO_POST_MS);
        const turn = { ...asrTurn(stamp, i, `turn number ${i} about the garden`, [{ itemId: `item_${i}`, commitSeq: i }]), judge: "H" };
        const res = await runRoute(turnRoute, fakeRequest({ body: turn }), deps, schedule);
        const ms = liveClockPort.read().opsClock.now - commitAt;
        expect(res.status).toBe(200);
        const out = res.body as { status: string; permit: { kind: string } | null };
        fromCommit.push(ms);
        kinds.push(out.permit?.kind ?? out.status);
        // The extraction and any repair finish before the next turn, as they would between spoken turns.
        for (const w of work.splice(0)) await w;
      }

      const max = Math.max(...fromCommit);
      const p95 = percentile(fromCommit, 95);
      console.log(JSON.stringify({ rttMs: RTT_MS, decisionsMs: DECISIONS_MS, commitToPostMs: COMMIT_TO_POST_MS, maxMs: Math.round(max), p95Ms: Math.round(p95), p50Ms: Math.round(percentile(fromCommit, 50)), kinds }));
      for (const ms of fromCommit) expect(ms).toBeLessThanOrEqual(COMMIT_LIMIT_MS);
    },
    120_000,
  );
});
