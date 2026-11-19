// Brief 045 part D, property 3: delivery never breaks a route. On a seeded clone, for the open and for the state
// route's idle read, the k-th store call delivery makes (a read, a transaction's read, a transaction's start or its
// commit) fails. The route answers 200 with the same body as when every store call delivery makes fails (no
// delivery), apart from `proactive`; a `proactive` it does send is checked: its moment was rendered for this Session,
// with these words.
//
// A store call is delivery's when the call's stack runs through `routes/delivery-wire.ts` or `server/src/time/`
// (the tick, the choice and the render). The baseline counts them, so the detection is checked to find some.
import { IDLE_SILENCE_MS, PERMIT_TTL_MS } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import type { Reader, StorePort } from "../store/port";
import { type TestRig, callRoute, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { meetAlreadyHappened } from "../testing/meet";
import { momentsOf } from "../time/testing";
import { openRoute } from "./open";
import { stateRoute } from "./state";

const SEED = 45103;
const UID = "owner-1";
const ZONE = "America/Chicago";
const DELIVERY_FRAME = /delivery-wire|[\\/]server[\\/]src[\\/]time[\\/]/;
const openBody = (n: number) => ({ requestId: testId(`open${n}`), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId: testId("visit-v1") });

const fromDelivery = (): boolean => DELIVERY_FRAME.test(new Error().stack ?? "");

/** The store, with delivery's store calls counted; `fail(n)` says whether delivery's n-th call fails. */
function faultyStore(inner: StorePort, fail: (n: number) => boolean): { store: StorePort; count: () => number } {
  let n = 0;
  const check = () => {
    if (fromDelivery() && fail(++n)) throw new Error("injected");
  };
  const reader = (r: Reader): Reader => ({
    get: async (path) => (check(), r.get(path)),
    query: async (spec) => (check(), r.query(spec)),
  });
  const store: StorePort = {
    get: async (uid, path) => (check(), inner.get(uid, path)),
    query: async (uid, spec) => (check(), inner.query(uid, spec)),
    transaction: async (uid, fn) => {
      check();
      return inner.transaction(uid, async (tx) => {
        const r = await fn({ ...tx, ...reader(tx) });
        check(); // the commit
        return r;
      });
    },
    snapshot: (uid, fn) => (inner.snapshot === undefined ? fn(reader(inner as unknown as Reader)) : inner.snapshot(uid, (r) => fn(reader(r)))),
  };
  return { store, count: () => n };
}

type RouteName = "open" | "state";

async function run(route: RouteName, fail: (n: number) => boolean) {
  const rig: TestRig = testRig();
  await resetAs(rig, UID, "v1", "r1", ZONE);
  // Brief 052 (M-1): a sample visit now meets Franki first; this test is about the line after, so the meeting is over.
  await meetAlreadyHappened(rig.store, UID, rig.deps.hasher);
  const inner = rig.deps.store;
  let sessionId: string;
  let res: { status: number; body: any };
  let calls: () => number;
  if (route === "open") {
    const f = faultyStore(inner, fail);
    rig.deps.store = f.store;
    calls = f.count;
    res = await callRoute(rig, openRoute, openBody(1));
    sessionId = res.body.sessionId;
  } else {
    const open = await callRoute(rig, openRoute, openBody(1));
    expect(open.status).toBe(200);
    sessionId = open.body.sessionId;
    rig.clock.advance(PERMIT_TTL_MS + IDLE_SILENCE_MS);
    const d = open.body.deck;
    const f = faultyStore(inner, fail);
    rig.deps.store = f.store;
    calls = f.count;
    res = await callRoute(rig, stateRoute, { sessionId, generation: 1, seen: { epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev }, ackStamp: null, speechStartedOpsAt: null });
  }
  rig.deps.store = inner;
  return { rig, res, sessionId, calls: calls() };
}

const withoutProactive = (body: Record<string, unknown>) => {
  const { proactive: _p, ...rest } = body;
  return rest;
};

describe("brief 045 part D: delivery never breaks a route", () => {
  const baseline = new Map<RouteName, { body: Record<string, unknown>; calls: number }>();
  beforeAll(async () => {
    for (const route of ["open", "state"] as const) {
      const working = await run(route, () => false);
      expect(working.res.status).toBe(200);
      expect(working.res.body.proactive, `${route}: a line with delivery working`).not.toBeNull();
      const none = await run(route, () => true);
      expect(none.res.status).toBe(200);
      expect(none.res.body.proactive).toBeNull();
      baseline.set(route, { body: withoutProactive(none.res.body), calls: working.calls });
      expect(working.calls, `${route}: delivery's store calls were found`).toBeGreaterThan(2);
    }
  }, 600_000);

  it("any one failed store call in delivery: the same answer as no delivery, and any line sent was rendered here", { timeout: 1_800_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<RouteName>("open", "state"), fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }), fc.boolean(), async (route, at, andAfter) => {
        const base = baseline.get(route)!;
        const k = 1 + Math.floor(at * base.calls);
        // One call fails, or that call and every one after it.
        const { rig, res, sessionId } = await run(route, (n) => n === k || (andAfter && n > k));
        expect(res.status, `${route}, call ${k}`).toBe(200);
        expect(withoutProactive(res.body)).toEqual(base.body);
        const p = res.body.proactive;
        if (p === null || p === undefined) return;
        expect(p.permit.stamp.sessionId).toBe(sessionId);
        for (const id of p.permit.momentIds as string[]) {
          const m = (await momentsOf(rig, UID)).get(id);
          expect(m?.rendered, `${route}, call ${k}: moment ${id} rendered`).toMatchObject({ sessionId, text: p.whisper.text });
        }
      }),
      { numRuns: 1000, seed: SEED },
    );
  });
});
