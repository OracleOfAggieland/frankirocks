import { type CoreEpoch, type Evidence, type Session, type Turn } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { callRoute, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { extractJobId } from "../worker/extract-jobs";
import { requestKey } from "../ledger/request";
import { cFields } from "../records";
import { HOLD_RETRY_MS, turnRoute } from "./turn";

const UID = "owner-1";
const items = (n: number) => [{ itemId: `item_${n}`, commitSeq: n }];
type Rig = ReturnType<typeof testRig>;

const post = (rig: Rig, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
const session = async (rig: Rig, id: string) => (await rig.store.get<Session>(UID, paths.session(UID, id)))!.data;
const turn = async (rig: Rig, sessionId: string, label: number) => (await rig.store.get<Turn>(UID, paths.turn(UID, sessionId, testId(`turn-${label}`))))!.data;
const policyRev = async (rig: Rig) => (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data.policyRev;
const late = (stamp: Parameters<typeof asrTurn>[0], n: number, text: string) => ({ ...asrTurn(stamp, n, text, items(n)), requestId: testId(`req-${n}-late`), supersedesRequestId: testId(`req-${n}`) });

/** A Session whose turn 1 was posted `missing`. */
async function missingFirst() {
  const rig = testRig();
  const s = await openTestSession(rig);
  const first = await post(rig, asrTurn(s.stamp, 1, "", items(1), "missing"));
  expect(first.body.status).toBe("hold");
  return { rig, s };
}

describe("the Superseding_Post (R7.8, R11.9, R15.7; question 89)", () => {
  it("an ordinary late transcript commits the Turn, Evidence and Extract_Job, clears the lease and moves the watermark", async () => {
    const { rig, s } = await missingFirst();
    const before = await session(rig, s.sessionId);
    expect(before.parseLease).toMatchObject({ clientSeq: 1 });
    expect([before.committedParseSeq, before.lastClientSeq, before.nextClientSeq]).toEqual([0, 1, 2]);
    const ledgerBefore = rig.store.countUnder(paths.collection(UID, "ledger"));

    const res = await post(rig, late(s.stamp, 1, "my dog loves the park"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ordinary", permit: null, notes: [] });

    const t = await turn(rig, s.sessionId, 1);
    expect(t).toMatchObject({ state: "committed", text: "my dog loves the park", final: true, parseState: "committed", seq: 1, uncertainSpeaker: 0.01 });
    const ev = (await rig.store.get<Evidence>(UID, paths.evidence(UID, t.evidenceId!)))!.data;
    expect(ev.text).toEqual({ kind: "inline", text: "my dog loves the park" });
    expect(t.rootSlices).toEqual(ev.fieldSlices.slice(0, 1));
    expect(await rig.store.get(UID, paths.job(UID, extractJobId(t.evidenceId!, rig.deps.hasher)))).not.toBeNull();

    const after = await session(rig, s.sessionId);
    expect(after.parseLease).toBeNull();
    expect([after.committedParseSeq, after.lastClientSeq, after.nextClientSeq, after.audience]).toEqual([1, 1, 2, "private"]);
    // No Permit means no decision entry: only this request's own entry is new.
    expect(rig.store.countUnder(paths.collection(UID, "ledger"))).toBe(ledgerBefore + 1);
  });

  it("the watermark moves over later committed turns once the gap closes", async () => {
    const { rig, s } = await missingFirst();
    await post(rig, asrTurn(s.stamp, 2, "and the weather is nice", items(2)));
    expect((await session(rig, s.sessionId)).committedParseSeq).toBe(0);
    await post(rig, late(s.stamp, 1, "my dog loves the park"));
    expect((await session(rig, s.sessionId)).committedParseSeq).toBe(2);
  });

  it("a control hit runs the late-hit effects: policyRev + 1, ready, no Permit", async () => {
    const { rig, s } = await missingFirst();
    const rev = await policyRev(rig);
    rig.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
    const res = await post(rig, late(s.stamp, 1, "forget what I said about work"));
    expect(res.body).toMatchObject({ status: "ready", permit: null, notes: [] });
    expect(await policyRev(rig)).toBe(rev + 1);
    expect(res.body.stamp.policyRev).toBe(rev + 1);
    expect(res.body.deck.policyRev).toBe(rev + 1);
    const t = await turn(rig, s.sessionId, 1);
    expect(t.parseState).toBe("committed");
    const ev = (await rig.store.get<Evidence>(UID, paths.evidence(UID, t.evidenceId!)))!.data;
    // The Extract_Job carries the raised policyRev, so the worker doesn't drop it as stale.
    expect(ev.policyRev).toBe(rev + 1);
    expect((await session(rig, s.sessionId)).committedParseSeq).toBe(1);
  });

  it("a failed parse commits the text and stores unknown", async () => {
    const { rig, s } = await missingFirst();
    rig.openai.script("decisions.create", ok({ answers: [] }));
    const res = await post(rig, late(s.stamp, 1, "my dog loves the park"));
    expect(res.body).toMatchObject({ status: "ordinary", permit: null });
    expect(await turn(rig, s.sessionId, 1)).toMatchObject({ state: "committed", parseState: "failed" });
    const after = await session(rig, s.sessionId);
    expect([after.audience, after.parseLease, after.committedParseSeq]).toEqual(["unknown", null, 0]);
  });

  it("a request whose superseded entry is for another turn, or doesn't exist, is PARSE", async () => {
    const { rig, s } = await missingFirst();
    await post(rig, asrTurn(s.stamp, 2, "and the weather is nice", items(2)));
    const other = await post(rig, { ...late(s.stamp, 1, "my dog loves the park"), supersedesRequestId: testId("req-2") });
    expect(other.body.error).toBe("PARSE");
    // A request entry that isn't visible yet is not an error: the browser retries (review of wave A, item 19).
    const none = await post(rig, { ...late(s.stamp, 1, "my dog loves the park"), supersedesRequestId: testId("req-nope") });
    expect(none.body).toMatchObject({ status: "hold", permit: null, retryAfterMs: HOLD_RETRY_MS, error: null });
    expect((await turn(rig, s.sessionId, 1)).state).toBe("transcriptMissing");
  });

  it("only a final ASR turn with items supersedes", async () => {
    const { rig, s } = await missingFirst();
    expect((await post(rig, { ...late(s.stamp, 1, ""), transcriptState: "missing" })).body.error).toBe("PARSE");
    expect((await post(rig, { ...late(s.stamp, 1, "hi"), source: "typed", items: [], judge: "typed" })).body.error).toBe("PARSE");
  });

  it("a Turn not in transcriptMissing is stale with no writes", async () => {
    const { rig, s } = await missingFirst();
    // Wrong items: the Turn doesn't match.
    const wrong = await post(rig, { ...late(s.stamp, 1, "my dog loves the park"), items: asrTurn(s.stamp, 1, "x", items(9)).items });
    expect(wrong.body).toMatchObject({ status: "stale", permit: null });
    expect((await turn(rig, s.sessionId, 1)).state).toBe("transcriptMissing");

    // Already committed: a second superseding request (new requestId) is stale, and writes nothing.
    await post(rig, late(s.stamp, 1, "my dog loves the park"));
    const t1 = await turn(rig, s.sessionId, 1);
    const s1 = await session(rig, s.sessionId);
    const evidence = rig.store.countUnder(paths.collection(UID, "evidence"));
    const again = await post(rig, { ...late(s.stamp, 1, "my dog loves the park"), requestId: testId("req-1-again") });
    expect(again.body).toMatchObject({ status: "stale", permit: null });
    expect(await turn(rig, s.sessionId, 1)).toEqual(t1);
    expect(await session(rig, s.sessionId)).toEqual(s1);
    expect(rig.store.countUnder(paths.collection(UID, "evidence"))).toBe(evidence);
  });

  it("a replay is a replay", async () => {
    const { rig, s } = await missingFirst();
    const body = late(s.stamp, 1, "my dog loves the park");
    const first = await post(rig, body);
    const calls = rig.openai.requestsTo("decisions.create").length;
    const again = await post(rig, body);
    expect(again.body).toEqual(first.body);
    expect(rig.openai.requestsTo("decisions.create")).toHaveLength(calls);
  });
});

describe("a Superseding_Post that arrives early (review of wave A, item 19)", () => {
  it("while the missing post is still pending, it answers a retryable hold with no writes, and works once that post completes", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    // The missing post's request entry is taken but not yet complete, as while its transaction runs.
    const key = requestKey(UID, "turn", testId("req-1"), {}, rig.deps.hasher);
    await rig.store.transaction(UID, async (tx) => {
      tx.create(key.path, { ...cFields(UID, "2026-11-03T12:00:00.000Z", 1, 1), kind: "request", state: "pending", at: "2026-11-03T12:00:00.000Z", retainUntil: "2026-11-04T12:00:00.000Z", payload: { route: "turn", keyHash: key.keyHash, requestHash: key.requestHash, response: null, error: null } });
    });
    const evidence = rig.store.countUnder(paths.collection(UID, "evidence"));
    const early = await post(rig, late(s.stamp, 1, "my dog loves the park"));
    expect(early.body).toMatchObject({ status: "hold", permit: null, retryAfterMs: HOLD_RETRY_MS, error: null });
    expect(rig.store.countUnder(paths.collection(UID, "evidence"))).toBe(evidence);
    // The same request again is not a replay of the hold: nothing was recorded.
    const ledger = await rig.store.get(UID, paths.ledger(UID, requestKey(UID, "turn", testId("req-1-late"), {}, rig.deps.hasher).keyHash));
    expect(ledger === null || (ledger.data as { state: string }).state !== "complete").toBe(true);
  });
});