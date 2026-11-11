/**
 * The tick (`worker/tick.ts`), pinned as it behaves today: the once-per-minute gate, the order of its steps, and
 * what a lost compare-and-set race does in each step. One case is written red first (`it.fails`): the behaviour
 * wanted later, that maintenance losing a race inside a session open does not fail the open.
 *
 * Every store here is the rig's Memory_Store, or a wrapper around it that records queries or lets a rival writer
 * commit between a transaction's reads and its commit.
 */
import { type Job, type Session, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { openRoute } from "../routes/open";
import type { RouteContext } from "../routes/runtime";
import { SESSION_IDLE_MS } from "../sessions";
import { paths } from "../store/paths";
import type { QuerySpec, StorePort } from "../store/port";
import { commitUserTurnForTest } from "../testing/extract-fixtures";
import { type TestRig, callRoute, patchRecord, runScheduled, settle, testRig } from "../testing/fakes";
import { openTestSession } from "../testing/session-fixtures";
import { ensureHangupJob } from "./hangup";
import { LEASE_MS, claimJob } from "./jobs";
import { startTick, takeTickSlot } from "./tick";

const UID = "owner-1";
const MINUTE_MS = 60_000;

const ctxOf = (rig: TestRig, store: StorePort = rig.store): RouteContext => ({ uid: UID, deps: { ...rig.deps, store }, schedule: rig.sched.schedule });

/** Names each query by the step that makes it: Q13 reads Sessions, Q18 expired leases, Q17 due Jobs, the drain leased Jobs. */
function queryLabel(spec: QuerySpec): string {
  const fields = spec.where.map((w) => w.field);
  if (spec.collection.endsWith("/sessions")) return "q13 sessions";
  if (fields.includes("leaseUntil")) return "q18 expired leases";
  if (fields.includes("nextAttemptAt")) return "due jobs";
  if (fields.length === 1 && fields[0] === "status") return "leased jobs";
  return "other";
}

/** A store that records the label of every query, in order. */
function recordingStore(inner: StorePort): { store: StorePort; labels: string[] } {
  const labels: string[] = [];
  const store: StorePort = {
    get: (u, p) => inner.get(u, p),
    query: (u, q) => {
      labels.push(queryLabel(q));
      return inner.query(u, q);
    },
    transaction: (u, fn) => inner.transaction(u, fn),
  };
  return { store, labels };
}

const collapse = (labels: string[]) => labels.filter((l, i) => i === 0 || labels[i - 1] !== l);

/** A store on which `rival` commits once, inside the first transaction for which `armed()` holds, after its body ran. */
function rivalStore(inner: StorePort, armed: (result: unknown) => boolean, rival: (u: string) => Promise<void>): { store: StorePort; raced: () => boolean } {
  let raced = false;
  const store: StorePort = {
    get: (u, p) => inner.get(u, p),
    query: (u, q) => inner.query(u, q),
    transaction: (u, fn) =>
      inner.transaction(u, async (tx) => {
        const result = await fn(tx);
        if (!raced && armed(result)) {
          raced = true;
          await rival(u);
        }
        return result;
      }),
  };
  return { store, raced: () => raced };
}

describe("tick gate (takeTickSlot)", () => {
  it("takes the slot once per store, Owner and ops minute", () => {
    const a = testRig().store;
    const b = testRig().store;
    const t = 10 * MINUTE_MS + 5_000;
    expect(takeTickSlot(a, UID, t)).toBe(true);
    expect(takeTickSlot(a, UID, t)).toBe(false);
    expect(takeTickSlot(a, UID, t + 50_000)).toBe(false); // the same minute
    expect(takeTickSlot(a, "owner-2", t)).toBe(true); // another Owner
    expect(takeTickSlot(b, UID, t)).toBe(true); // another Store_Port instance
    expect(takeTickSlot(a, UID, t + 55_000)).toBe(true); // the next minute
    expect(takeTickSlot(a, UID, t + 55_000)).toBe(false);
  });

  it("startTick in a minute whose slot is taken returns null and schedules nothing", async () => {
    const rig = testRig();
    const { store, labels } = recordingStore(rig.store);
    const first = startTick(ctxOf(rig, store));
    expect(first).not.toBeNull();
    await settle(first!, rig.clock, rig.timers);
    await runScheduled(rig);
    const before = labels.length;
    rig.clock.advance(30_000);
    expect(startTick(ctxOf(rig, store))).toBeNull();
    expect(rig.sched.pending).toBe(0);
    expect(labels.length).toBe(before);
  });

  it("the slot is spent before any work: a tick whose Q13 failed still blocks the rest of that minute", async () => {
    const rig = testRig();
    const failing: StorePort = {
      get: (u, p) => rig.store.get(u, p),
      query: () => Promise.reject(new Error("injected query failure")),
      transaction: (u, fn) => rig.store.transaction(u, fn),
    };
    const first = startTick(ctxOf(rig, failing));
    await expect(settle(first!, rig.clock, rig.timers)).rejects.toThrow("injected query failure");
    expect(startTick(ctxOf(rig, failing))).toBeNull();
  });
});

describe("tick order", () => {
  it("Q13 runs before startTick resolves; Q18, then Q17's hangup Jobs, then the extract drain run as scheduled work", async () => {
    const rig = testRig();
    const { store, labels } = recordingStore(rig.store);
    const expiry = startTick(ctxOf(rig, store));
    const { value } = await settle(expiry!, rig.clock, rig.timers);
    expect(value).toBe(0);
    // Q13 reads each live status in turn: minting, active, quarantined, closing.
    expect(labels).toEqual(["q13 sessions", "q13 sessions", "q13 sessions", "q13 sessions"]);
    expect(rig.sched.pending).toBe(1);
    await runScheduled(rig);
    // Q18; Q17 (queued, then retry); the drain's leased read, then its own due read.
    expect(collapse(labels)).toEqual(["q13 sessions", "q18 expired leases", "due jobs", "leased jobs", "due jobs"]);
  });

  it("the scheduled steps do not start while Q13 is still running", async () => {
    const rig = testRig();
    const { store: recording, labels } = recordingStore(rig.store);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    let q13Reads = 0;
    const store: StorePort = {
      ...recording,
      query: async (u, q) => {
        // Q13's first Sessions read is held open until the test releases it.
        if (q.collection.endsWith("/sessions") && ++q13Reads === 1) await held;
        return recording.query(u, q);
      },
    };
    const expiry = startTick(ctxOf(rig, store))!;
    // The scheduled work starts while Q13 is pending.
    const tail = rig.sched.runAll();
    for (let i = 0; i < 50; i++) await new Promise<void>((r) => setImmediate(r));
    expect(labels).toEqual([]);
    release();
    await settle(expiry, rig.clock, rig.timers);
    await settle(tail, rig.clock, rig.timers);
    expect(collapse(labels)).toEqual(["q13 sessions", "q18 expired leases", "due jobs", "leased jobs", "due jobs"]);
  });

  it("the scheduled steps run even when Q13 rejected", async () => {
    const rig = testRig();
    const { store: recording, labels } = recordingStore(rig.store);
    let q13Reads = 0;
    const store: StorePort = {
      ...recording,
      query: (u, q) => {
        if (q.collection.endsWith("/sessions") && ++q13Reads === 1) return Promise.reject(new Error("injected query failure"));
        return recording.query(u, q);
      },
    };
    const expiry = startTick(ctxOf(rig, store));
    await expect(settle(expiry!, rig.clock, rig.timers)).rejects.toThrow("injected query failure");
    await runScheduled(rig);
    expect(collapse(labels)).toEqual(["q18 expired leases", "due jobs", "leased jobs", "due jobs"]);
  });
});

describe("tick lost races", () => {
  it("Q18: a requeue that loses its race is logged as tick.lostRace and the extract drain still runs", async () => {
    const rig = testRig();
    const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "My dog is called Pip", rig.clock, rig.deps.hasher);
    // The Extract_Job names missing Evidence, so a drain's attempt ends at the worker's first check.
    await patchRecord<Job>(rig.store, UID, paths.job(UID, turn.jobId), { sourceIds: [testId("no-evidence")] });
    expect(await claimJob(rig.store, UID, turn.jobId, rig.clock.read().opsClock.now, rig.deps.hasher)).not.toBeNull();
    rig.clock.advance(LEASE_MS + 1_000);
    const now = rig.clock.read().opsClock.now;
    // No Session exists, so Q13 opens no transaction: the first one is Q18's requeue.
    const { store, raced } = rivalStore(
      rig.store,
      () => true,
      (u) => patchRecord<Job>(rig.store, u, paths.job(u, turn.jobId), { updatedAt: tsFromMs(now) }),
    );
    await settle(startTick(ctxOf(rig, store))!, rig.clock, rig.timers);
    await runScheduled(rig);
    expect(raced()).toBe(true);
    expect(rig.logs.filter((l) => l.event === "tick.lostRace").map((l) => l.fields)).toEqual([{ step: "requeue" }]);
    // The drain requeued the expired lease itself, claimed the Job again and its attempt released the lease.
    const job = (await rig.store.get<Job>(UID, paths.job(UID, turn.jobId)))!.data;
    expect(job).toMatchObject({ generation: 2, leaseToken: null });
  });

  it("Q17: a hangup Job whose commit loses its race is logged as tick.lostRace and the extract drain still runs", async () => {
    const rig = testRig();
    const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "My dog is called Pip", rig.clock, rig.deps.hasher);
    await patchRecord<Job>(rig.store, UID, paths.job(UID, turn.jobId), { sourceIds: [testId("no-evidence")] });
    const now = rig.clock.read().opsClock.now;
    const hangupJob = await rig.store.transaction(UID, (tx) => ensureHangupJob(tx, UID, testId("s1"), 1, now, rig.deps.hasher));
    // The attempt's commit: another writer changes the Job before it lands.
    const { store, raced } = rivalStore(
      rig.store,
      (result) => result === "complete",
      (u) => patchRecord<Job>(rig.store, u, paths.job(u, hangupJob), { updatedAt: tsFromMs(now + 1) }),
    );
    await settle(startTick(ctxOf(rig, store))!, rig.clock, rig.timers);
    await runScheduled(rig);
    expect(raced()).toBe(true);
    expect(rig.logs.filter((l) => l.event === "tick.lostRace").map((l) => l.fields)).toEqual([{ step: "hangup" }]);
    expect((await rig.store.get<Job>(UID, paths.job(UID, hangupJob)))!.data).toMatchObject({ status: "leased" });
    expect((await rig.store.get<Job>(UID, paths.job(UID, turn.jobId)))!.data).toMatchObject({ generation: 1, leaseToken: null });
  });
});

describe("Q13 inside a session open", () => {
  /**
   * An Owner's Session past its expiry, with no call registered, so Q13 closes it in one transaction. A rival
   * writer (another instance's tick, a close from the old tab) commits the same Session after Q13's transaction
   * read it and before it commits. The sequence: open S1; advance past SESSION_IDLE_MS; open again with the rival.
   */
  async function staleQ13Open(withRival = true) {
    const rig = testRig();
    const { sessionId } = await openTestSession(rig, "open1");
    rig.clock.advance(SESSION_IDLE_MS + MINUTE_MS);
    const now = rig.clock.read().opsClock.now;
    // Q13's begin-close transaction returns { closed, callIds }; the open's own transaction returns { response, prior }.
    let begun = 0;
    const beganClose = (result: unknown) => {
      const hit = typeof result === "object" && result !== null && "closed" in result && "callIds" in result;
      if (hit) begun++;
      return withRival && hit;
    };
    const { store, raced } = rivalStore(rig.store, beganClose, (u) => patchRecord<Session>(rig.store, u, paths.session(u, sessionId), { updatedAt: tsFromMs(now) }));
    const deps = { ...rig.deps, store };
    const res = await callRoute({ ...rig, deps }, openRoute, { requestId: testId("open2"), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: null });
    const status = async () => (await rig.store.get<Session>(UID, paths.session(UID, sessionId)))!.data.status;
    return { res, raced, status, begun: () => begun };
  }

  it("with no rival, the second open closes the expired Session in Q13 and succeeds", async () => {
    const { res, raced, status, begun } = await staleQ13Open(false);
    expect(raced()).toBe(false);
    expect(begun()).toBe(1);
    expect(res.status).toBe(200);
    expect(await status()).toBe("closed");
  });

  it("today: a Q13 close that loses its race fails the open with 409 STALE", async () => {
    const { res, raced, status } = await staleQ13Open();
    expect(raced()).toBe(true);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("STALE");
    // Q13's transaction did not commit: the expired Session is still live.
    expect(await status()).toBe("minting");
  });

  it.fails("a stale Q13 does not fail open", async () => {
    const { res, raced } = await staleQ13Open();
    expect(raced()).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body.state).not.toBe("blocked");
  });
});
