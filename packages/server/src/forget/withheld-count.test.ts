// Brief 048 item h: how much ruling 1 over-forgets. Counts the assistant Turns `planClosure` withholds (its
// `withheldTurns`, every page of closure together) for beat 5 and for a forget of the oldest Memory of the seeded
// persona (brief 019). The receipt has no field for the count, so it is measured here and given in the report.
// Test-only; no model is called.
import type * as Core from "@franki/core";
import { type Job, type Memory, tsFromMs } from "@franki/core";
import { sampleSession, testId } from "@franki/core/testing";
import { describe, expect, it, vi } from "vitest";
import { paths } from "../store/paths";
import { commitUserTurnForTest, insertTurnForTest } from "../testing/extract-fixtures";
import { testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { fakeCallClose } from "./close-port";
import { advanceForget } from "./executor";
import { fenceForget } from "./fence";
import { fakeForgetResolve } from "./resolve-port";

const seen = vi.hoisted(() => ({ current: new Set<string>(), beat5: new Set<string>(), plans: 0, assistant: new Set<string>() }));
vi.mock("@franki/core", async (importOriginal) => {
  const real = await importOriginal<typeof Core>();
  return {
    ...real,
    planClosure: (...args: Parameters<typeof real.planClosure>) => {
      const plan = real.planClosure(...args);
      seen.plans += 1;
      for (const t of args[0].turns) if (t.turn.role === "assistant") seen.assistant.add(`${t.sessionId}/${t.id}`);
      for (const t of plan.withheldTurns) seen.current.add(`${t.sessionId}/${t.id}`);
      return plan;
    },
  };
});
seen.current = seen.beat5;
// Beat 5 runs here as it does in its own file, with the count taken on the way.
await import("../scripts/beat5-shellfish-brother.test");

const UID = "owner-1";
const SESSION = testId("withheld-session");

describe("ruling 1's over-forget, measured (brief 048 item h)", () => {
  it("beat 5", () => {
    console.log(`ruling 1, beat 5: ${seen.beat5.size} assistant Turns withheld of ${seen.assistant.size} assistant Turns closure read, over ${seen.plans} closure plans`);
    // The count is taken from closure itself: beat 5 does plan a closure.
    expect(seen.plans).toBeGreaterThan(0);
    seen.plans = 0;
    seen.assistant.clear();
  });

  it("a forget of the oldest seeded Memory", async () => {
    seen.current = new Set();
    const rig = testRig();
    const { store, hasher, clock } = rig.deps;
    expect((await resetAs(rig, UID, "v1", "r1")).status).toBe(200);
    const memories = await store.query<Memory>(UID, { collection: paths.collection(UID, "memories"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
    expect(memories.length).toBeLessThan(100); // every seeded Memory was read
    const active = memories.filter((m) => m.data.status === "active" && m.data.kind !== "rule");
    const oldest = active.reduce((a, b) => (b.data.createdAt < a.data.createdAt ? b : a));
    await store.transaction(UID, async (tx) => tx.create(paths.session(UID, SESSION), sampleSession({ uid: UID, status: "active", callId: null, registeredCallIds: [] })));
    rig.clock.advance(2_000);
    const turnId = testId("withheld-forget-request");
    const text = "Forget what I said about that.";
    const committed = await commitUserTurnForTest(store, UID, turnId, text, clock, hasher);
    await insertTurnForTest(store, UID, SESSION, turnId, { seq: 1, evidenceId: committed.eid, text, parseState: "committed", itemIds: ["item_w"], committedAt: tsFromMs(clock.read().opsClock.now) });
    const fenced = await fenceForget(store, UID, { sessionId: SESSION, requestId: "withheld-1", requestTurnIds: [turnId] }, clock.read().opsClock.now, hasher);
    if (fenced.kind === "refused") throw new Error("refused");
    const resolver = fakeForgetResolve(() => ({ resolution: "exact", remove: [], candidateIds: [oldest.id], entityIds: [], topicKeys: [], needsMore: false, clarification: null }));
    const deps = { store, hasher, resolver, closer: fakeCallClose(() => "closed") };
    for (let i = 0; i < 400; i++) {
      const job = (await store.get<Job>(UID, paths.job(UID, fenced.jobId)))!.data;
      if (job.payload.kind === "forget" && job.payload.phase === "done") break;
      await advanceForget(deps, UID, fenced.jobId, clock.read().opsClock.now, { maxSteps: 1 });
      rig.clock.advance(6_000);
    }
    const job = (await store.get<Job>(UID, paths.job(UID, fenced.jobId)))!.data;
    expect(job.payload.kind === "forget" && job.payload.phase).toBe("done");
    console.log(`ruling 1, oldest seeded Memory (${oldest.data.kind}, of ${active.length} active): ${seen.current.size} assistant Turns withheld of ${seen.assistant.size} assistant Turns closure read, over ${seen.plans} closure plans`);
    expect(seen.plans).toBeGreaterThan(0);
  }, 120_000);
});
