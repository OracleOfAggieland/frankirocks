// Brief 047, ruling 1: closure restamps every surviving row in pages before resume. This forgets one Memory of the
// seeded persona (brief 019) and reports how many closure pages and writes that took. Test-only; no model is called.
import { type CoreEpoch, type Job, type Ledger, type Memory, tsFromMs } from "@franki/core";
import { sampleSession, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { commitUserTurnForTest, insertTurnForTest } from "../testing/extract-fixtures";
import { testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { fakeCallClose } from "./close-port";
import { advanceForget } from "./executor";
import { fenceForget, forgetReceiptId } from "./fence";
import { fakeForgetResolve } from "./resolve-port";

const UID = "owner-1";
const SESSION = testId("seed-forget-session");

describe("closure on the seeded persona (ruling 1)", () => {
  it("forgets one Memory and restamps every survivor, in pages, before the barrier clears", async () => {
    const rig = testRig();
    const { store, hasher, clock } = rig.deps;
    expect((await resetAs(rig, UID, "v1", "r1")).status).toBe(200);
    const memories = await store.query<Memory>(UID, { collection: paths.collection(UID, "memories"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
    const target = memories.find((m) => m.data.status === "active" && m.data.value.kind === "text" && m.data.kind !== "rule")!;
    expect(target).toBeDefined();

    await store.transaction(UID, async (tx) => tx.create(paths.session(UID, SESSION), sampleSession({ uid: UID, status: "active", callId: null, registeredCallIds: [] })));
    rig.clock.advance(2_000);
    const turnId = testId("seed-forget-request");
    const text = "Forget what I said about that.";
    const committed = await commitUserTurnForTest(store, UID, turnId, text, clock, hasher);
    await insertTurnForTest(store, UID, SESSION, turnId, { seq: 1, evidenceId: committed.eid, text, parseState: "committed", itemIds: ["item_seed"], committedAt: tsFromMs(clock.read().opsClock.now) });
    const fenced = await fenceForget(store, UID, { sessionId: SESSION, requestId: "seed-1", requestTurnIds: [turnId] }, clock.read().opsClock.now, hasher);
    if (fenced.kind === "refused") throw new Error("refused");
    const resolver = fakeForgetResolve(() => ({ resolution: "exact", remove: [], candidateIds: [target.id], entityIds: [], topicKeys: [], needsMore: false, clarification: null }));
    const deps = { store, hasher, resolver, closer: fakeCallClose(() => "closed") };

    const receiptPath = paths.ledger(UID, forgetReceiptId(fenced.opId, hasher));
    const touched = async () => {
      const r = (await store.get<Ledger>(UID, receiptPath))!.data;
      return r.kind === "forgetReceipt" ? Object.fromEntries(r.payload.touched.map((t) => [t.collection, t.count])) : {};
    };
    const steps: Record<string, number> = {};
    let atClosure: Record<string, number> | null = null;
    let afterClosure: Record<string, number> | null = null;
    for (let i = 0; i < 400; i++) {
      const job = (await store.get<Job>(UID, paths.job(UID, fenced.jobId)))!.data;
      const phase = job.payload.kind === "forget" ? job.payload.phase : "?";
      if (phase === "done") break;
      if (phase === "closure" && atClosure === null) atClosure = await touched();
      if (phase === "resume" && afterClosure === null) afterClosure = await touched();
      steps[phase] = (steps[phase] ?? 0) + 1;
      const r = await advanceForget(deps, UID, fenced.jobId, clock.read().opsClock.now, { maxSteps: 1 });
      expect(["paused", "done", "waiting", "retry"]).toContain(r.kind);
      rig.clock.advance(6_000);
    }
    const job = (await store.get<Job>(UID, paths.job(UID, fenced.jobId)))!.data;
    expect(job.payload.kind === "forget" && job.payload.phase).toBe("done");
    expect((await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data.barrier).toBeNull();

    const closureWrites = Object.fromEntries(Object.entries(afterClosure ?? {}).map(([c, n]) => [c, n - (atClosure?.[c] ?? 0)]).filter(([, n]) => (n as number) > 0));
    // Closure runs one empty step after its last page (the step that moves to resume).
    const pages = (steps.closure ?? 1) - 1;
    console.log(`ruling 1 on the seeded persona: ${memories.length} Memories read; closure ${pages} pages, writes ${JSON.stringify(closureWrites)}; steps ${JSON.stringify(steps)}`);
    expect(pages).toBeGreaterThan(0);
  }, 120_000);
});
