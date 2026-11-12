import { type Evidence, type Session, type Turn, idParts } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fastODecisionId } from "../admission/seam";
import { paths } from "../store/paths";
import { evidenceId } from "../store/evidence";
import { callRoute, patchRecord, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { readTurns } from "../worker/extract-jobs";
import { receiptRoute } from "./receipt";
import { turnRoute } from "./turn";

const UID = "owner-1";

async function setup() {
  const rig = testRig();
  const s = await openTestSession(rig);
  const turnStamp = { ...s.stamp, turnId: testId("turn-1") };
  let n = 0;
  const receipt = (overrides: Record<string, unknown> = {}) =>
    callRoute(rig, receiptRoute, {
      requestId: testId(`rcpt${++n}`),
      stamp: turnStamp,
      responseId: "resp_1",
      kind: "transcript",
      momentIds: [],
      noteIds: [],
      pendingId: null,
      permitKind: null,
      text: "Your dog is called Pip.",
      ...overrides,
    });
  const aturnId = (responseId: string) => rig.deps.hasher.id(idParts.assistantTurn(s.sessionId, responseId));
  return { rig, s, turnStamp, receipt, aturnId };
}

describe("POST /api/receipt", () => {
  it("assistant Turn seq and ordering: seq = nextClientSeq - 1, listed after the user Turn of equal seq", async () => {
    const { rig, s, receipt, aturnId } = await setup();
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "What's my dog called?"));
    const res = await receipt();
    expect(res.body).toEqual({ accepted: true, controlCheck: "none" });
    expect(res.elapsedMs).toBeLessThanOrEqual(1_500);
    const turn = (await rig.store.get<Turn>(UID, paths.turn(UID, s.sessionId, aturnId("resp_1"))))!.data;
    expect(turn).toMatchObject({ role: "assistant", seq: 1, state: "transcribed", text: "Your dog is called Pip.", spokenResponseId: "resp_1", sourceClass: "M" });
    const ev = (await rig.store.get<Evidence>(UID, paths.evidence(UID, turn.evidenceId!)))!.data;
    expect(ev).toMatchObject({ kind: "turn", authorship: "unknown", authorId: null, turnId: aturnId("resp_1"), text: { kind: "inline", text: "Your dog is called Pip." } });
    expect(ev.fieldSlices).toEqual([expect.objectContaining({ class: "M", start: 0, end: 23 })]);
    expect(turn.evidenceId).toBe(evidenceId(rig.deps.hasher.id(idParts.evidenceLogical(aturnId("resp_1"))), 1, rig.deps.hasher));
    expect((await readTurns(rig.store, UID, s.sessionId)).map(({ turn: t }) => [t.seq, t.role])).toEqual([
      [1, "user"],
      [1, "assistant"],
    ]);
    // Assistant Turns never advance nextClientSeq.
    expect((await rig.store.get<Session>(UID, paths.session(UID, s.sessionId)))!.data.nextClientSeq).toBe(2);
  });

  it("repeat transcript is idempotent: same responseId, new requestId → accepted, no second Turn or Evidence", async () => {
    const { rig, s, receipt } = await setup();
    await receipt();
    const turns = rig.store.countUnder(paths.turns(UID, s.sessionId));
    const evidence = rig.store.countUnder(paths.collection(UID, "evidence"));
    expect((await receipt({ text: "Your dog is called Pip!" })).body).toEqual({ accepted: true, controlCheck: "none" });
    expect(rig.store.countUnder(paths.turns(UID, s.sessionId))).toBe(turns);
    expect(rig.store.countUnder(paths.collection(UID, "evidence"))).toBe(evidence);
  });

  it("stale stamp → accepted:false and nothing written", async () => {
    const { rig, s, turnStamp, receipt } = await setup();
    for (const stale of [{ bundleRev: turnStamp.bundleRev + 1 }, { generation: 2 }, { epoch: 2 }, { policyRev: 2 }, { rulesRev: 2 }]) {
      const res = await receipt({ stamp: { ...turnStamp, ...stale } });
      expect(res.body).toEqual({ accepted: false, controlCheck: "none" });
    }
    expect(rig.store.countUnder(paths.turns(UID, s.sessionId))).toBe(0);
    expect(rig.store.countUnder(paths.collection(UID, "evidence"))).toBe(0);
    expect(rig.store.countUnder(paths.collection(UID, "jobs"))).toBe(0);
  });

  it("no Extract_Job for assistant Turns, including after close (R21.4)", async () => {
    const { rig, s, receipt } = await setup();
    await receipt();
    expect(rig.store.countUnder(paths.collection(UID, "jobs"))).toBe(0);
    const { ensureExtractJobs } = await import("../worker/extract-jobs");
    expect(await ensureExtractJobs(UID, s.sessionId, rig.deps)).toEqual([]);
  });

  it("playback receipts are accepted and write no Turn", async () => {
    const { rig, s, receipt } = await setup();
    for (const kind of ["playbackStarted", "playbackEnded", "cancelled"]) {
      expect((await receipt({ kind, text: null, permitKind: "slowOrdinary" })).body).toEqual({ accepted: true, controlCheck: "none" });
    }
    expect(rig.store.countUnder(paths.turns(UID, s.sessionId))).toBe(0);
  });

  it("PARSE for a bad body; SCOPE for a Session outside the tenant; nothing written", async () => {
    const { rig, s, turnStamp, receipt } = await setup();
    expect((await receipt({ text: "" })).body.error).toBe("PARSE");
    expect((await receipt({ text: null })).body.error).toBe("PARSE");
    expect((await receipt({ text: "x".repeat(4097) })).body.error).toBe("PARSE");
    expect((await receipt({ kind: "said" })).body.error).toBe("PARSE");
    expect((await receipt({ responseId: undefined })).body.error).toBe("PARSE");
    expect((await receipt({ extra: true })).body.error).toBe("PARSE");
    expect((await receipt({ kind: "playbackStarted", text: "hi" })).body.error).toBe("PARSE");
    expect((await receipt({ stamp: { ...turnStamp, sessionId: testId("other") } })).body.error).toBe("SCOPE");
    const other = await callRoute(
      rig,
      receiptRoute,
      { requestId: testId("o"), stamp: turnStamp, responseId: "r", kind: "transcript", momentIds: [], noteIds: [], pendingId: null, permitKind: null, text: "hi" },
      { token: "token:owner-2" },
    );
    expect(other.body.error).toBe("SCOPE");
    expect(rig.store.countUnder(paths.turns(UID, s.sessionId))).toBe(0);
  });

  it("pushes the Session's idle expiry forward", async () => {
    const { rig, s, receipt } = await setup();
    rig.clock.advance(60_000);
    await receipt({ kind: "playbackStarted", text: null });
    const session = (await rig.store.get<Session>(UID, paths.session(UID, s.sessionId)))!.data;
    expect(session.expiresAt).toBe("2026-11-03T12:11:00.000Z");
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "closed" });
    expect((await receipt({ responseId: "resp_after" })).body.accepted).toBe(true);
  });
});

describe("POST /api/receipt records fastO (task 35)", () => {
  const admittedFastO = (stamp: Record<string, unknown>, label: string) => ({
    requestId: testId(label),
    stamp,
    responseId: "resp_s",
    kind: "admitted",
    momentIds: [],
    noteIds: [],
    pendingId: null,
    permitKind: "fastO",
    text: null,
  });
  const fastOTurn = async (order: "receiptFirst" | "turnFirst") => {
    const rig = testRig();
    const s = await openTestSession(rig);
    const stamp = { ...s.stamp, turnId: testId("turn-1") };
    if (order === "turnFirst") await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hello"));
    expect((await callRoute(rig, receiptRoute, admittedFastO(stamp, "r1"))).body).toEqual({ accepted: true, controlCheck: "none" });
    if (order === "receiptFirst") await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hello"));
    const t = (await rig.store.get<Turn>(UID, paths.turn(UID, s.sessionId, testId("turn-1"))))!.data;
    const id = fastODecisionId(rig.deps.hasher, s.sessionId, testId("turn-1"));
    return { rig, s, stamp, t, decision: await rig.store.get(UID, paths.ledger(UID, id)) };
  };

  it("an accepted admitted + fastO receipt writes the fastO decision once", async () => {
    const { rig, stamp, decision } = await fastOTurn("turnFirst");
    expect(decision).not.toBeNull();
    await callRoute(rig, receiptRoute, admittedFastO(stamp, "r2"));
    const all = await rig.store.query(UID, { collection: paths.collection(UID, "ledger"), where: [{ field: "kind", op: "==", value: "decision" }], orderBy: { field: "at", dir: "desc" }, limit: 100 });
    expect(all.filter((d) => d.id === decision!.id)).toHaveLength(1);
  });

  it("receipt-then-turn and turn-then-receipt give the same Turn fields (R9.2)", async () => {
    const a = await fastOTurn("receiptFirst");
    const b = await fastOTurn("turnFirst");
    const pick = (t: Turn) => ({ judge: t.judge, admitted: t.admittedAt !== null });
    expect(pick(a.t)).toEqual({ judge: "O", admitted: true });
    expect(pick(b.t)).toEqual(pick(a.t));
  });

  it("a stale stamp writes nothing", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    const res = await callRoute(rig, receiptRoute, admittedFastO({ ...s.stamp, policyRev: 9, turnId: testId("turn-1") }, "r1"));
    expect(res.body.accepted).toBe(false);
    expect(await rig.store.get(UID, paths.ledger(UID, fastODecisionId(rig.deps.hasher, s.sessionId, testId("turn-1"))))).toBeNull();
  });
});
