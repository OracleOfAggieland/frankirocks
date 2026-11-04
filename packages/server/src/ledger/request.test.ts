import type { Ledger } from "@franki/core";
import { sampleSession, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ensureCoreDocs } from "../core-docs";
import { RouteError } from "../routes/errors";
import { mutation } from "../routes/mutation";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import { testRig } from "../testing/fakes";
import { completeRequest, LEASE_MS, RETAIN_MS, requestKey } from "./request";

const UID = "owner-1";

/** A close-shaped mutation that creates one Session per real run, so writes can be counted. */
async function setup() {
  const rig = testRig();
  await ensureCoreDocs(UID, rig.deps);
  const ctx: RouteContext = { uid: UID, deps: rig.deps, schedule: rig.sched.schedule };
  let runs = 0;
  const call = (requestId: string, body: unknown, hold?: Promise<void>) =>
    mutation(ctx, "close", requestId, body, async (key) => {
      runs++;
      if (hold !== undefined) await hold;
      const response = { state: "closed" as const };
      await rig.store.transaction(UID, async (tx) => {
        tx.create(paths.session(UID, testId(`s${runs}`)), sampleSession({ uid: UID }));
        await completeRequest(tx, key, response, rig.clock.read().opsClock.now);
      });
      return response;
    });
  return { rig, call, runs: () => runs };
}

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as RouteError;

describe("request idempotency", () => {
  it("replays the recorded response for the same requestId and hash, and writes nothing", async () => {
    const { rig, call, runs } = await setup();
    const body = { requestId: testId("r1"), n: 1 };
    expect(await call(testId("r1"), body)).toEqual({ state: "closed" });
    const sessions = rig.store.countUnder(paths.collection(UID, "sessions"));
    rig.clock.advance(60_000);
    expect(await call(testId("r1"), body)).toEqual({ state: "closed" });
    expect(runs()).toBe(1);
    expect(rig.store.countUnder(paths.collection(UID, "sessions"))).toBe(sessions);
  });

  it("returns 409 HASH for the same requestId with a different body, and leaves the record unchanged", async () => {
    const { rig, call, runs } = await setup();
    await call(testId("r1"), { requestId: testId("r1"), n: 1 });
    const key = requestKey(UID, "close", testId("r1"), { requestId: testId("r1"), n: 1 }, rig.deps.hasher);
    const before = await rig.store.get<Ledger>(UID, key.path);
    const e = await err(call(testId("r1"), { requestId: testId("r1"), n: 2 }));
    expect(e).toBeInstanceOf(RouteError);
    expect([e.code, e.status]).toEqual(["HASH", 409]);
    expect(runs()).toBe(1);
    expect(await rig.store.get(UID, key.path)).toEqual(before);
  });

  it("returns 429 LIMIT with retryAfterMs while the 15 s lease is held, then runs once the lease lapses", async () => {
    const { rig, call, runs } = await setup();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const body = { requestId: testId("r1") };
    const first = call(testId("r1"), body, hold).catch((e: unknown) => e);
    await new Promise((r) => setImmediate(r));
    const e = await err(call(testId("r1"), body));
    expect([e.code, e.status]).toEqual(["LIMIT", 429]);
    expect(e.retryAfterMs).toBeGreaterThanOrEqual(1);
    expect(e.retryAfterMs).toBeLessThanOrEqual(5000);
    expect(runs()).toBe(1);
    release();
    expect(await first).toEqual({ state: "closed" });
  });

  it("takes over a lapsed lease", async () => {
    const { rig, call, runs } = await setup();
    const body = { requestId: testId("r1") };
    const stuck = call(testId("r1"), body, new Promise(() => {}));
    void stuck;
    await new Promise((r) => setImmediate(r));
    rig.clock.advance(LEASE_MS);
    expect(await call(testId("r1"), body)).toEqual({ state: "closed" });
    expect(runs()).toBe(2);
  });

  it("processes a request again after the 24 h retention passes (R10.12)", async () => {
    const { rig, call, runs } = await setup();
    const body = { requestId: testId("r1"), n: 1 };
    await call(testId("r1"), body);
    rig.clock.advance(RETAIN_MS);
    expect(await call(testId("r1"), { ...body, n: 2 })).toEqual({ state: "closed" });
    expect(runs()).toBe(2);
    const key = requestKey(UID, "close", testId("r1"), { ...body, n: 2 }, rig.deps.hasher);
    expect((await rig.store.get<Ledger>(UID, key.path))?.data).toMatchObject({ state: "complete", payload: { requestHash: key.requestHash } });
  });

  it("does not record failures: a retry after an error runs again", async () => {
    const rig = testRig();
    await ensureCoreDocs(UID, rig.deps);
    const ctx: RouteContext = { uid: UID, deps: rig.deps, schedule: rig.sched.schedule };
    let runs = 0;
    const failing = () =>
      mutation(ctx, "close", testId("r1"), { a: 1 }, async () => {
        runs++;
        throw new Error("dependency down");
      });
    await err(failing());
    await err(failing());
    expect(runs).toBe(2);
  });
});
