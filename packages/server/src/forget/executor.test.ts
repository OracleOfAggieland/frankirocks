import { type CoreBundle, type CoreEpoch, type CoreRules, type Evidence, type Job, type Ledger, type Memory, type Session, type Turn, buildSlice, rootKey, tsFromMs } from "@franki/core";
import { sampleSession, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { commitUserTurnForTest, insertMemoryForTest, insertTurnForTest } from "../testing/extract-fixtures";
import { T0_MS, patchRecord, testRig } from "../testing/fakes";
import { FORGET_RETRY_MS, advanceForget } from "./executor";
import { fenceForget, forgetReceiptId } from "./fence";
import { fakeForgetResolve } from "./resolve-port";

const UID = "owner-1";
const SESSION = testId("session");
const T1 = testId("turn1");
const T2 = testId("turn2");
const TEXT = "I'm allergic to shellfish. Danny relapsed.";
const RULE = testId("shellfish");

async function setup() {
  const rig = testRig();
  const { store, deps, clock } = rig;
  const hasher = deps.hasher;
  const turn = await commitUserTurnForTest(store, UID, T1, TEXT, clock, hasher);
  const danny = buildSlice({ eid: turn.eid, fieldPath: "text", fieldText: TEXT, start: 27, end: 42, class: "U", sens: "S0" }, hasher);
  const dannyId = await insertMemoryForTest(store, UID, turn, hasher, { rootSlices: [danny], rootKeys: [rootKey(danny, hasher)], value: { kind: "text", text: "Danny relapsed" } }, "danny");
  const proof = buildSlice({ eid: turn.eid, fieldPath: "text", fieldText: TEXT, start: 0, end: 26, class: "U", sens: "S0" }, hasher);
  const rules = (await store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
  await patchRecord<CoreRules>(store, UID, paths.core(UID, "rules"), {
    rulesRev: rules.rulesRev + 1,
    allergies: [
      {
        id: RULE,
        subjectId: "self",
        code: "shellfish",
        state: "active",
        anonymous: false,
        proof: { eid: turn.eid, fieldPath: "text", start: 0, end: 26, quote: "I'm allergic to shellfish." },
        proofRev: 1,
        rootKeys: [rootKey(proof, hasher)],
        dependsOn: [`e:${turn.eid}`],
      },
    ],
  });
  await store.transaction(UID, async (tx) => tx.create(paths.session(UID, SESSION), sampleSession({ uid: UID, status: "active", registeredCallIds: ["rtc_1"], callId: "rtc_1" })));
  await insertTurnForTest(store, UID, SESSION, T1, { seq: 1, evidenceId: turn.eid, text: TEXT, parseState: "committed", itemIds: ["item_1"], committedAt: tsFromMs(T0_MS) });
  await insertTurnForTest(store, UID, SESSION, T2, { seq: 2, evidenceId: null, text: "Forget that Danny relapsed", parseState: "pending", itemIds: ["item_2"], committedAt: tsFromMs(T0_MS + 5_000) });
  const get = async <T>(path: string) => (await store.get<T>(UID, path))!.data;
  return { rig, store, hasher, turn, dannyId, get };
}

const exact = (ids: string[]) => ({ resolution: "exact", remove: [], candidateIds: ids, entityIds: [], topicKeys: [], needsMore: false, clarification: null });

describe("fenceForget (spec §8 step 2)", () => {
  it("raises the epoch, sets the barrier, burns the bundle, writes the job and receipt, and kills the request turn", async () => {
    const { store, hasher, get } = await setup();
    const before = await get<CoreEpoch>(paths.core(UID, "epoch"));
    const bundleBefore = await get<CoreBundle>(paths.core(UID, "bundle"));
    const r = await fenceForget(store, UID, { sessionId: SESSION, requestId: "req-1", requestTurnIds: [T2] }, T0_MS + 6_000, hasher);
    expect(r.kind).toBe("fenced");
    if (r.kind === "refused") return;
    const epoch = await get<CoreEpoch>(paths.core(UID, "epoch"));
    expect(epoch.epoch).toBe(before.epoch + 1);
    expect(epoch.policyRev).toBe(before.policyRev + 1);
    expect(epoch.barrier).toMatchObject({ opId: r.opId, phase: "close", queuedOps: [] });
    const bundle = await get<CoreBundle>(paths.core(UID, "bundle"));
    expect(bundle).toMatchObject({ state: "dirty", head: null, headHash: null, selectedRefs: [], bundleRev: bundleBefore.bundleRev + 1 });
    expect((await get<Job>(paths.job(UID, r.jobId))).payload).toMatchObject({ kind: "forget", phase: "close", opId: r.opId, requestTurnIds: [T2] });
    expect((await get<Turn>(paths.turn(UID, SESSION, T2))).state).toBe("dead");
    expect((await get<Session>(paths.session(UID, SESSION))).deadItemIds).toContain("item_2");
    const receipt = await get<Ledger>(paths.ledger(UID, r.receiptId));
    expect(receipt).toMatchObject({ kind: "forgetReceipt", state: "pending", payload: { opId: r.opId, blockedAt: null, cleanupCompleteAt: null } });
  });

  it("a retry keeps its stamps and writes nothing; a second forget joins the queue without raising the epoch", async () => {
    const { store, hasher, get } = await setup();
    const first = await fenceForget(store, UID, { sessionId: SESSION, requestId: "req-1", requestTurnIds: [T2] }, T0_MS + 6_000, hasher);
    const epoch1 = await get<CoreEpoch>(paths.core(UID, "epoch"));
    const again = await fenceForget(store, UID, { sessionId: SESSION, requestId: "req-1", requestTurnIds: [T2] }, T0_MS + 7_000, hasher);
    expect(again).toEqual({ ...first, kind: "retry" });
    expect((await get<CoreEpoch>(paths.core(UID, "epoch"))).rev).toBe(epoch1.rev);
    const second = await fenceForget(store, UID, { sessionId: SESSION, requestId: "req-2", requestTurnIds: [] }, T0_MS + 8_000, hasher);
    expect(second.kind).toBe("queued");
    const epoch2 = await get<CoreEpoch>(paths.core(UID, "epoch"));
    expect(epoch2.epoch).toBe(epoch1.epoch);
    expect(epoch2.barrier!.opId).toBe(epoch1.barrier!.opId);
    expect(epoch2.barrier!.queuedOps.map((q) => q.capturedEpoch)).toEqual([epoch1.epoch]);
  });
});

describe("advanceForget (spec §8 steps 3 to 5; brief 021)", () => {
  it("forgetting Danny keeps the shellfish rule and stops after install, not complete", async () => {
    const { store, hasher, turn, dannyId, get } = await setup();
    const fence = await fenceForget(store, UID, { sessionId: SESSION, requestId: "req-1", requestTurnIds: [T2] }, T0_MS + 6_000, hasher);
    if (fence.kind === "refused") throw new Error("refused");
    const resolver = fakeForgetResolve(() => exact([dannyId]));
    const r = await advanceForget({ store, hasher, resolver }, UID, fence.jobId, T0_MS + 7_000);
    expect(r).toEqual({ kind: "stopped", phase: "closure" });

    // The request text is the request; it is never a committed turn the model reads.
    expect(resolver.calls).toHaveLength(1);
    expect(resolver.calls[0]!.request.quote).toBe("Forget that Danny relapsed");
    expect(resolver.calls[0]!.committed.map((t) => t.text)).toEqual([TEXT]);

    const job = await get<Job>(paths.job(UID, fence.jobId));
    expect(job.status).toBe("blocked");
    expect(job.payload).toMatchObject({ phase: "closure", scopePending: false, closeCalls: [{ sessionId: SESSION, state: "pending" }] });
    expect((await get<Memory>(paths.memory(UID, dannyId))).status).toBe("blocked");
    expect((await get<Evidence>(paths.evidence(UID, turn.eid))).status).toBe("blocked");
    const sanitizedId = (job.payload as { stagedSanitizedEids: string[] }).stagedSanitizedEids[0]!;
    const sanitized = await get<Evidence>(paths.evidence(UID, sanitizedId));
    expect(sanitized.text).toEqual({ kind: "inline", text: "I'm allergic to shellfish." });
    expect(sanitized.sanitizedFrom).toBe(turn.eid);
    const rule = (await get<CoreRules>(paths.core(UID, "rules"))).allergies.find((a) => a.id === RULE)!;
    expect(rule.state).toBe("active");
    expect(rule.proof).toEqual({ eid: sanitizedId, fieldPath: "text", start: 0, end: 26, quote: "I'm allergic to shellfish." });

    // Not complete: the barrier stays up at closure, and the receipt says nothing is blocked yet.
    expect((await get<CoreEpoch>(paths.core(UID, "epoch"))).barrier).toMatchObject({ opId: fence.opId, phase: "closure" });
    const receipt = await get<Ledger>(paths.ledger(UID, forgetReceiptId(fence.opId, hasher)));
    expect(receipt.state).toBe("pending");
    expect(receipt.payload).toMatchObject({ blockedAt: null, cleanupCompleteAt: null, retainedRuleIds: [RULE], scopePending: false, withdrawnCount: 0 });

    // A blocked job is never leased again.
    expect(await advanceForget({ store, hasher, resolver }, UID, fence.jobId, T0_MS + 60_000)).toEqual({ kind: "notClaimed" });
  });

  it("an ambiguous answer holds the candidates for review and removes nothing", async () => {
    const { store, hasher, dannyId, get } = await setup();
    const fence = await fenceForget(store, UID, { sessionId: SESSION, requestId: "req-1", requestTurnIds: [T2] }, T0_MS + 6_000, hasher);
    if (fence.kind === "refused") throw new Error("refused");
    const resolver = fakeForgetResolve(() => ({ ...exact([dannyId]), resolution: "ambiguous" }));
    expect(await advanceForget({ store, hasher, resolver }, UID, fence.jobId, T0_MS + 7_000)).toEqual({ kind: "stopped", phase: "closure" });
    const job = await get<Job>(paths.job(UID, fence.jobId));
    expect(job.payload).toMatchObject({ scopePending: true, phase: "closure" });
    expect((await get<Memory>(paths.memory(UID, dannyId))).status).toBe("active");
    const blocks = await store.query<{ state: string; kind: string }>(UID, { collection: paths.collection(UID, "blocks"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
    expect(blocks.map((b) => [b.data.kind, b.data.state])).toEqual([["root", "review"]]);
    expect((await get<Ledger>(paths.ledger(UID, forgetReceiptId(fence.opId, hasher)))).payload).toMatchObject({ scopePending: true });
  });

  it("a resolver failure is a retry that resumes at resolve", async () => {
    const { store, hasher, dannyId, get } = await setup();
    const fence = await fenceForget(store, UID, { sessionId: SESSION, requestId: "req-1", requestTurnIds: [T2] }, T0_MS + 6_000, hasher);
    if (fence.kind === "refused") throw new Error("refused");
    let fail = true;
    const resolver = fakeForgetResolve(() => {
      if (fail) throw new Error("port down");
      return exact([dannyId]);
    });
    expect(await advanceForget({ store, hasher, resolver }, UID, fence.jobId, T0_MS + 7_000)).toEqual({ kind: "retry", phase: "resolve" });
    expect(await get<Job>(paths.job(UID, fence.jobId))).toMatchObject({ status: "retry", attempts: 1, payload: { phase: "resolve" } });
    fail = false;
    expect(await advanceForget({ store, hasher, resolver }, UID, fence.jobId, T0_MS + 7_000 + FORGET_RETRY_MS)).toEqual({ kind: "stopped", phase: "closure" });
    expect((await get<Memory>(paths.memory(UID, dannyId))).status).toBe("blocked");
  });
});
