// voice-control task 48 (brief 026): company, quiet and the hang-up on `/api/turn` (R14.1, R14.5, R14.7, R14.8;
// design "Wave B", "Audience effects in the transaction"; questions 68, 79, 81).
import { type CoreEpoch, type Job, type Ledger, type Session, msFromTs } from "@franki/core";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord, runScheduled, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { hangupJobId } from "../worker/hangup";
import { CARE_SWAP_WAIT_MS, SWAP_WAIT_MS } from "../audience-swap";
import { turnRoute } from "./turn";

const UID = "owner-1";

async function setup() {
  const rig = testRig();
  rig.openai.always("responses.create", ok(completed("All right.")));
  rig.openai.always("realtime.calls.hangup", ok(null));
  const s = await openTestSession(rig);
  await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  return { rig, s };
}

const post = (rig: TestRig, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
const voice = (stamp: Awaited<ReturnType<typeof openTestSession>>["stamp"], n: number, text: string, judge = "H") => ({ ...asrTurn(stamp, n, text, [{ itemId: `item_${n}`, commitSeq: n }]), judge });
const sessionOf = async (rig: TestRig, id: string) => (await rig.store.get<Session>(UID, paths.session(UID, id)))!.data;
const epochOf = async (rig: TestRig) => (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
const jobOf = (rig: TestRig, id: string) => rig.store.get<Job>(UID, paths.job(UID, hangupJobId(id as never, rig.deps.hasher)));
async function decisions(rig: TestRig) {
  const rows = await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [{ field: "kind", op: "==", value: "decision" }], orderBy: { field: "at", dir: "desc" }, limit: 100 });
  return rows.map((d) => d.data as Extract<Ledger, { kind: "decision" }>);
}

describe("/api/turn: company and quiet (task 48)", () => {
  it("a company hit with a live call stores company, raises policyRev, waits 10 s, closes the Session, writes the hangup Job and answers blocked", async () => {
    const { rig, s } = await setup();
    const before = await epochOf(rig);
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    const t0 = rig.clock.read().opsClock.now;
    const res = await post(rig, voice(s.stamp, 1, "My cousin just sat down."));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "blocked", permit: null, notes: [] });
    expect(res.body.stamp.policyRev).toBe(before.policyRev + 1);
    const session = await sessionOf(rig, s.sessionId);
    expect(session.audience).toBe("company");
    expect(session.status).toBe("closing");
    expect(msFromTs(session.waitDeadline!) - t0).toBeGreaterThanOrEqual(SWAP_WAIT_MS);
    expect(msFromTs(session.waitDeadline!) - t0).toBeLessThan(SWAP_WAIT_MS + 1_000);
    const epoch = await epochOf(rig);
    expect(epoch.policyRev).toBe(before.policyRev + 1);
    expect(epoch.activeSessionId).toBeNull();
    expect((await jobOf(rig, s.sessionId))!.data).toMatchObject({ kind: "hangup", sourceIds: [s.sessionId] });
    // The decision is the hold, with the audience reason.
    expect((await decisions(rig))[0]!.payload.reasonCodes).toContain("audience");
    // No hangup before the response; the scheduled Job hangs up the call after it.
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(0);
    await runScheduled(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup").map((r) => (r.body as { callId: string }).callId)).toEqual(["rtc_a"]);
    expect((await sessionOf(rig, s.sessionId)).status).toBe("closed");
  });

  it("a quiet hit is recorded as company, with reasonCodes quiet on the decision (question 79)", async () => {
    const { rig, s } = await setup();
    rig.openai.script("decisions.create", ok(decisionAnswer({ quiet: 0.9 })));
    const res = await post(rig, voice(s.stamp, 1, "Keep that between us."));
    expect(res.body.status).toBe("blocked");
    expect((await sessionOf(rig, s.sessionId)).audience).toBe("company");
    expect((await decisions(rig))[0]!.payload.reasonCodes).toEqual(expect.arrayContaining(["audience", "quiet"]));
    expect(await jobOf(rig, s.sessionId)).not.toBeNull();
  });

  it("with crisis also a candidate: blocked with the care Permit, waitDeadline + 60 s, the Session active and no hang-up (R14.7; question 68)", async () => {
    const { rig, s } = await setup();
    const before = await epochOf(rig);
    rig.openai.script("decisions.create", ok(decisionAnswer({ crisis: 0.6, company: 0.9 })));
    const t0 = rig.clock.read().opsClock.now;
    const res = await post(rig, voice(s.stamp, 1, "My cousin is here and I can't do this anymore."));
    expect(res.body).toMatchObject({ status: "blocked", permit: { kind: "postCommitControl", scope: "ack" } });
    expect(res.body.notes).toEqual([]);
    expect(res.body.stamp.policyRev).toBe(before.policyRev + 1);
    const session = await sessionOf(rig, s.sessionId);
    expect(session).toMatchObject({ audience: "company", status: "active" });
    expect(session.modifiers.crisis).not.toBeNull();
    expect(msFromTs(session.waitDeadline!) - t0).toBeGreaterThanOrEqual(CARE_SWAP_WAIT_MS);
    expect(msFromTs(session.waitDeadline!) - t0).toBeLessThan(CARE_SWAP_WAIT_MS + 1_000);
    expect(await jobOf(rig, s.sessionId)).toBeNull();
    await runScheduled(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(0);
  });

  it("every later turn on the narrowed Session answers blocked, after a hang-up or a care reply (property 10, server half)", async () => {
    for (const probs of [{ company: 0.9 }, { crisis: 0.6, company: 0.9 }]) {
      const { rig, s } = await setup();
      rig.openai.script("decisions.create", ok(decisionAnswer(probs)));
      const first = await post(rig, voice(s.stamp, 1, "My cousin just sat down."));
      const stamp = { ...s.stamp, policyRev: first.body.stamp.policyRev };
      rig.openai.script("decisions.create", ok(decisionAnswer()));
      const later = await post(rig, voice(stamp, 2, "What's on for tonight?", "O"));
      expect(later.status, JSON.stringify(probs)).toBe(200);
      expect(later.body, JSON.stringify(probs)).toMatchObject({ status: "blocked", permit: null, notes: [] });
      // Nothing of the later turn is stored: no Turn, and the Session's clientSeq didn't move.
      expect(await rig.store.get(UID, paths.turn(UID, s.sessionId, later.body.stamp.turnId))).toBeNull();
      expect((await sessionOf(rig, s.sessionId)).nextClientSeq).toBe(2);
    }
  });

  it("a weak company line with judge O doesn't narrow (route rule; question 95)", async () => {
    const { rig, s } = await setup();
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.5 })));
    const res = await post(rig, voice(s.stamp, 1, "Hey Franki, how's it going?", "O"));
    expect(res.body.status).not.toBe("blocked");
    expect((await sessionOf(rig, s.sessionId))).toMatchObject({ audience: "private", status: "active", waitDeadline: null });
  });
});
