// voice-control task 50 (brief 026): open carries a narrowed audience into the fresh call, with the swap line
// (R14.2, R14.3, R14.8; design "Open with inheritance", "The swap line"; question 81).
import { COMPANY_LINE, type CoreRules, type Ledger, type Session, payloadHash, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { PERSONAL_FACT, PLAIN_FACT, seedTwoMemories } from "../testing/two-memories";
import { CARE_SWAP_WAIT_MS, SWAP_WAIT_MS, swapLineTurnId } from "../audience-swap";
import { closeRoute } from "./close";
import { openRoute } from "./open";
import { turnRoute } from "./turn";

const UID = "owner-1";
const shellfish = { id: testId("rule"), subjectId: "self", code: "shellfish", state: "active" as const, anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };

async function rigWithCall(uid = UID, token?: string) {
  const rig = testRig();
  rig.openai.always("responses.create", ok(completed("All right.")));
  rig.openai.always("realtime.calls.hangup", ok(null));
  await seedTwoMemories(rig, uid);
  const s = await openTestSession(rig, "open1", token);
  await patchRecord<Session>(rig.store, uid, paths.session(uid, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  return { rig, s };
}

const post = (rig: TestRig, body: unknown, token?: string) => settle(callRoute(rig, turnRoute, body, token === undefined ? {} : { token }), rig.clock, rig.timers).then((r) => r.value);
const open = (rig: TestRig, previousSessionId: string | null, label = "open2", token?: string) =>
  callRoute(rig, openRoute, { requestId: testId(label), initiator: "user", previousSessionId, clientZone: "UTC", visitId: null }, token === undefined ? {} : { token });
const sessionOf = async (rig: TestRig, id: string, uid = UID) => (await rig.store.get<Session>(uid, paths.session(uid, id)))!.data;

/** Narrows the open Session the way `/api/turn` does: a company line on the live call. */
async function narrow(rig: TestRig, s: Awaited<ReturnType<typeof openTestSession>>, probs: Record<string, number> = { company: 0.9 }, token?: string) {
  rig.openai.script("decisions.create", ok(decisionAnswer(probs)));
  const res = await post(rig, { ...asrTurn(s.stamp, 1, "My cousin just sat down.", [{ itemId: "item_1", commitSeq: 1 }]), judge: "H" }, token);
  expect(res.body.status).toBe("blocked");
}

describe("/api/session/open: the carried audience (task 50)", () => {
  it("an open naming a narrowed Session within waitDeadline starts company, with the narrow Head and the swap line", async () => {
    const { rig, s } = await rigWithCall();
    await patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), { allergies: [shellfish] });
    await narrow(rig, s);
    rig.clock.advance(SWAP_WAIT_MS - 1_000);
    const res = await open(rig, s.sessionId);
    expect(res.status).toBe(200);
    const fresh = await sessionOf(rig, res.body.sessionId);
    expect(fresh.audience).toBe("company");
    expect(fresh.waitDeadline).toBeNull();
    const head = res.body.deck.head;
    expect(head.text).toContain(PLAIN_FACT);
    expect(head.text).not.toContain(PERSONAL_FACT);
    expect(head.text).toContain("Audience: company.");
    expect(head.text).toContain("shellfish");
    // The swap line: a postCommitControl Permit of scope ack over the COMPANY ack note, under the open's Stamp.
    const p = res.body.proactive;
    expect(p).not.toBeNull();
    expect(p.turnId).toBe(swapLineTurnId(rig.deps.hasher, res.body.sessionId));
    expect(p.cards).toEqual([]);
    expect(p.whisper).toMatchObject({ kind: "ack", text: COMPANY_LINE, sens: "S0" });
    expect(p.permit).toMatchObject({ kind: "postCommitControl", scope: "ack", noteIds: [p.whisper.noteId] });
    expect(p.permit.stamp).toMatchObject({ ...res.body.ack.stamp, turnId: p.turnId });
    const hash = payloadHash({ stamp: p.permit.stamp, head, notes: [p.whisper], turns: [], audioIds: [], toolOutput: null }, rig.deps.hasher);
    expect(p.permit.approvedPayloadHash).toBe(hash);
    // The seam wrote the Permit's decision.
    expect(await rig.store.get<Ledger>(UID, paths.ledger(UID, p.permit.permitId))).not.toBeNull();
  });

  it("no line after a crisis: the audience carries, the proactive is null", async () => {
    const { rig, s } = await rigWithCall();
    await narrow(rig, s, { crisis: 0.6, company: 0.9 });
    rig.clock.advance(CARE_SWAP_WAIT_MS - 1_000);
    const res = await open(rig, s.sessionId);
    expect((await sessionOf(rig, res.body.sessionId)).audience).toBe("company");
    expect(res.body.deck.head.text).not.toContain(PERSONAL_FACT);
    expect(res.body.proactive).toBeNull();
  });

  // Brief 035 (finding 6): an expired wait yields unknown, never private.
  it("past waitDeadline it starts unknown, with the S0 Head and no line", async () => {
    const { rig, s } = await rigWithCall();
    await narrow(rig, s);
    rig.clock.advance(SWAP_WAIT_MS + 1);
    const res = await open(rig, s.sessionId);
    expect((await sessionOf(rig, res.body.sessionId)).audience).toBe("unknown");
    expect(res.body.deck.head.text).not.toContain(PERSONAL_FACT);
    expect(res.body.proactive).toBeNull();
  });

  it("for another Owner's Session it starts private", async () => {
    const other = await rigWithCall("owner-2", "token:owner-2");
    await narrow(other.rig, other.s, { company: 0.9 }, "token:owner-2");
    // The same rig serves owner-1, who names owner-2's narrowed Session.
    await seedTwoMemories(other.rig, UID);
    const res = await open(other.rig, other.s.sessionId, "open-owner-1");
    expect(res.status).toBe(200);
    expect((await sessionOf(other.rig, res.body.sessionId)).audience).toBe("private");
    expect(res.body.deck.head.text).toContain(PERSONAL_FACT);
    expect(res.body.proactive).toBeNull();
  });

  it("an ordinary open, or one naming a private Session, starts private with no line (the machine plays any proactive)", async () => {
    const { rig, s } = await rigWithCall();
    const plain = await open(rig, null, "open-plain");
    expect(plain.body.proactive).toBeNull();
    expect((await sessionOf(rig, plain.body.sessionId)).audience).toBe("private");
    const named = await open(rig, s.sessionId, "open-named");
    expect(named.body.proactive).toBeNull();
    expect((await sessionOf(rig, named.body.sessionId)).audience).toBe("private");
    // A private Session with a stray waitDeadline still passes nothing on.
    await patchRecord<Session>(rig.store, UID, paths.session(UID, named.body.sessionId), { waitDeadline: tsFromMs(rig.clock.read().opsClock.now + 5_000) });
    const again = await open(rig, named.body.sessionId, "open-again");
    expect(again.body.proactive).toBeNull();
  });

  it("an inherited company Session's own turns are admitted under its narrow Head, not blocked", async () => {
    const { rig, s } = await rigWithCall();
    await narrow(rig, s);
    const res = await open(rig, s.sessionId);
    const id = res.body.sessionId;
    await patchRecord<Session>(rig.store, UID, paths.session(UID, id), { status: "active", registeredCallIds: ["rtc_b"], callId: "rtc_b" });
    const stamp = { sessionId: id, epoch: res.body.deck.epoch, policyRev: res.body.deck.policyRev, bundleRev: res.body.deck.bundleRev, rulesRev: res.body.deck.rulesRev, generation: 1 };
    rig.openai.script("decisions.create", ok(decisionAnswer()));
    const t = await post(rig, { ...asrTurn(stamp, 1, "What's on for tonight?", [{ itemId: "item_b1", commitSeq: 1 }], "final", "b1"), judge: "O" });
    expect(t.body.status, JSON.stringify(t.body)).toBe("ordinary");
    expect(t.body.permit).toMatchObject({ kind: "slowOrdinary" });
  });

  it("a reconnect after an error close of a company Session starts company and hears the line again (task 51; question 81)", async () => {
    const { rig, s } = await rigWithCall();
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { audience: "company" });
    const closed = await callRoute(rig, closeRoute, { requestId: testId("close-err"), sessionId: s.sessionId, generation: 1, reason: "error" });
    expect(closed.status).toBe(200);
    rig.clock.advance(30_000);
    const res = await open(rig, s.sessionId);
    expect((await sessionOf(rig, res.body.sessionId)).audience).toBe("company");
    expect(res.body.deck.head.text).not.toContain(PERSONAL_FACT);
    expect(res.body.proactive?.whisper.text).toBe(COMPANY_LINE);
  });
});
