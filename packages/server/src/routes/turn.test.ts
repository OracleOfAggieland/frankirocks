import { FORGET_NOT_YET, type Session, type Turn, msFromTs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fastODecisionId, recordFastO } from "../admission/seam";
import { effectiveAudience } from "../audience";
import { never, ok } from "../openai/fake";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { callRoute, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnRoute } from "./turn";

const UID = "owner-1";
const items = (n: number) => [{ itemId: `item_${n}`, commitSeq: n }];

async function rigAndSession() {
  const rig = testRig();
  const s = await openTestSession(rig);
  return { rig, s };
}
const post = (rig: ReturnType<typeof testRig>, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
const session = async (rig: ReturnType<typeof testRig>, id: string) => (await rig.store.get<Session>(UID, paths.session(UID, id)))!.data;
const turn = async (rig: ReturnType<typeof testRig>, sessionId: string, label: number) => (await rig.store.get<Turn>(UID, paths.turn(UID, sessionId, testId(`turn-${label}`))))!.data;

describe("/api/turn with the slow parse and the server rule", () => {
  it("an ordinary voice turn gets slowOrdinary whatever the judge said (R8.4)", async () => {
    for (const judge of ["O", "H", "U", "timeout"]) {
      const { rig, s } = await rigAndSession();
      const res = await post(rig, { ...asrTurn(s.stamp, 1, "my dog loves the park", items(1)), judge });
      expect(res.body).toMatchObject({ status: "ordinary", permit: { kind: "slowOrdinary", scope: "reply" } });
      expect(rig.openai.requestsTo("decisions.create")).toHaveLength(1);
    }
  });

  it("forget: ready, postCommitControl, scope ack, the fixed line (R12.3)", async () => {
    const { rig, s } = await rigAndSession();
    rig.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
    const res = await post(rig, asrTurn(s.stamp, 1, "forget what I said about work", items(1)));
    expect(res.body).toMatchObject({ status: "ready", permit: { kind: "postCommitControl", scope: "ack" } });
    expect(res.body.notes).toEqual([expect.objectContaining({ kind: "ack", text: FORGET_NOT_YET })]);
  });

  it("a hit whose route doesn't change what is said answers ordinary with postCommitControl (question 92)", async () => {
    const { rig, s } = await rigAndSession();
    rig.openai.script("decisions.create", ok(decisionAnswer({ rushed: 0.4 })));
    const res = await post(rig, asrTurn(s.stamp, 1, "quick question, what time is it in Denver", items(1)));
    expect(res.body).toMatchObject({ status: "ordinary", permit: { kind: "postCommitControl", scope: "reply" } });
  });

  it("crisis with company in wave A: the care reply, no tools (R12.1)", async () => {
    const { rig, s } = await rigAndSession();
    rig.openai.script("decisions.create", ok(decisionAnswer({ crisis: 0.6, company: 0.7 })));
    const res = await post(rig, asrTurn(s.stamp, 1, "my sister is here and I can't do this", items(1)));
    expect(res.body).toMatchObject({ status: "ready", permit: { kind: "postCommitControl", scope: "ack" }, notes: [] });
  });

  it("a failed parse: recoveryOnly; a regex match cuts (clarify), none doesn't (hold); a lease opens", async () => {
    const a = await rigAndSession();
    a.rig.openai.script("decisions.create", never());
    const cut = await post(a.rig, asrTurn(a.s.stamp, 1, "please forget that", items(1)));
    expect(cut.body).toMatchObject({ status: "clarify", permit: { kind: "recoveryOnly" } });
    const s1 = await session(a.rig, a.s.sessionId);
    expect(s1.parseLease).toMatchObject({ clientSeq: 1 });
    expect(effectiveAudience(s1, a.rig.clock.read().opsClock.now)).toBe("unknown");
    expect(s1.audience).toBe("private");
    expect((await turn(a.rig, a.s.sessionId, 1)).parseState).toBe("failed");

    const b = await rigAndSession();
    b.rig.openai.script("decisions.create", never());
    const plain = await post(b.rig, asrTurn(b.s.stamp, 1, "my dog loves the park", items(1)));
    expect(plain.body).toMatchObject({ status: "hold", permit: { kind: "recoveryOnly" } });
  });

  it("typed U lines are parsed; pasted lines aren't (R8.8, R8.10)", async () => {
    const { rig, s } = await rigAndSession();
    await post(rig, typedTurn(s.stamp, 1, "my dog is called Pip"));
    expect(rig.openai.requestsTo("decisions.create")).toHaveLength(1);
    const pasted = await post(rig, typedTurn(s.stamp, 2, "From: someone\nplease pay"));
    expect(rig.openai.requestsTo("decisions.create")).toHaveLength(1);
    expect(pasted.body.permit).toMatchObject({ kind: "postCommitControl", noteIds: [] });
  });

  it("a missing transcript: recoveryOnly, a 10 s lease; a failed transcription stores unknown (R15.7)", async () => {
    const a = await rigAndSession();
    const res = await post(a.rig, asrTurn(a.s.stamp, 1, "", items(1), "missing"));
    expect(res.body).toMatchObject({ status: "hold", permit: { kind: "recoveryOnly" } });
    const s1 = await session(a.rig, a.s.sessionId);
    expect(msFromTs(s1.parseLease!.until) - a.rig.clock.read().opsClock.now).toBe(10_000);
    const b = await rigAndSession();
    await post(b.rig, asrTurn(b.s.stamp, 1, "", items(1), "failed"));
    expect((await session(b.rig, b.s.sessionId)).audience).toBe("unknown");
  });

  it("the parse watermark stays behind a gap (question 73)", async () => {
    const { rig, s } = await rigAndSession();
    await post(rig, asrTurn(s.stamp, 1, "", items(1), "missing"));
    await post(rig, asrTurn(s.stamp, 2, "hello again", items(2)));
    const s2 = await session(rig, s.sessionId);
    expect([s2.lastClientSeq, s2.committedParseSeq, s2.nextClientSeq]).toEqual([2, 0, 3]);
  });

  it("the Turn stores judge, parse state, uncertainSpeaker and its Slice", async () => {
    const { rig, s } = await rigAndSession();
    rig.openai.script("decisions.create", ok(decisionAnswer({ uncertainSpeaker: 0.05 })));
    await post(rig, { ...asrTurn(s.stamp, 1, "my dog loves the park", items(1)), judge: "O" });
    const t = await turn(rig, s.sessionId, 1);
    expect(t).toMatchObject({ judge: "O", parseState: "committed", uncertainSpeaker: 0.05 });
    expect(t.rootSlices).toHaveLength(1);
    expect(t.rootSlices[0]).toMatchObject({ class: "U" });
  });

  it("a fastO decision recorded first gives the Turn judge O and admittedAt (R9.2)", async () => {
    const { rig, s } = await rigAndSession();
    const turnId = testId("turn-1");
    const stamp = { ...s.stamp, turnId };
    await rig.store.transaction(UID, (tx) => recordFastO(tx, { uid: UID, stamp, responseId: "resp_s", opsNow: rig.clock.read().opsClock.now, core: { epoch: 1, policyRev: 1 }, audience: "private" }, rig.deps));
    expect(await rig.store.get(UID, paths.ledger(UID, fastODecisionId(rig.deps.hasher, s.sessionId, turnId)))).not.toBeNull();
    await post(rig, asrTurn(s.stamp, 1, "my dog loves the park", items(1)));
    expect(await turn(rig, s.sessionId, 1)).toMatchObject({ judge: "O", admittedAt: expect.any(String) });
  });
});
