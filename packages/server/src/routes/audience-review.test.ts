// Brief 035: the review of the audience wave. One block per finding, each the reviewer's sequence as a route test.
import { type CoreBundle, type CoreEpoch, type CoreRules, type Job, type SS, type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { never, ok } from "../openai/fake";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, runScheduled } from "../testing/fakes";
import { asrTurn, typedTurn } from "../testing/session-fixtures";
import { PERSONAL_FACT } from "../testing/two-memories";
import { UID, doorRig, postTurn } from "../testing/audience-doors";
import { hangupJobId } from "../worker/hangup";

/** The Stamp the browser would hold now: the stored core revisions. */
async function stampNow(rig: TestRig, sessionId: string): Promise<SS> {
  const e = (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  const r = (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
  const b = (await rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;
  return { sessionId, epoch: e.epoch, policyRev: e.policyRev, bundleRev: b.bundleRev, rulesRev: r.rulesRev, generation: 1 } as SS;
}

const sessionOf = async (rig: TestRig, id: string) => (await rig.store.get<Session>(UID, paths.session(UID, id)))!.data;
const epochOf = async (rig: TestRig) => (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
const jobOf = (rig: TestRig, id: string) => rig.store.get<Job>(UID, paths.job(UID, hangupJobId(id as never, rig.deps.hasher)));
const voice = (stamp: Parameters<typeof asrTurn>[0], n: number, text: string, judge = "H", label: string | number = n) => ({ ...asrTurn(stamp, n, text, [{ itemId: `item_${label}`, commitSeq: n }], "final", label), judge });
const headText = (body: any): string => body?.deck?.head?.text ?? "";

describe("finding 1: a company hit through the Parse_Repair narrows", () => {
  it("the repair's hit stores company, raises policyRev, closes the Session and hangs up; the next turn is blocked", async () => {
    const { rig, s } = await doorRig(true);
    const before = await epochOf(rig);
    rig.openai.script("decisions.create", never(), ok(decisionAnswer({ company: 0.9 })));
    const first = await postTurn(rig, voice(s.stamp, 1, "My boss just walked in."));
    expect(first.body.status).toBe("clarify");
    await runScheduled(rig);
    const after = await sessionOf(rig, s.sessionId);
    expect(after.audience).toBe("company");
    expect(after.waitDeadline).not.toBeNull();
    expect(["closing", "closed"]).toContain(after.status);
    expect(after.parseLease).toBeNull();
    expect((await epochOf(rig)).policyRev).toBe(before.policyRev + 1);
    expect(await jobOf(rig, s.sessionId)).not.toBeNull();
    expect(rig.openai.requestsTo("realtime.calls.hangup").map((r) => (r.body as { callId: string }).callId)).toEqual(["rtc_a"]);
    // The next ordinary turn gets no private Head.
    rig.openai.script("decisions.create", ok(decisionAnswer()));
    const next = await postTurn(rig, voice(await stampNow(rig, s.sessionId), 2, "What's on for tonight?", "O"));
    expect(next.body?.status).not.toBe("ordinary");
    expect(headText(next.body)).not.toContain(PERSONAL_FACT);
  });

  it("a typed repair with no call open stores company and a narrow Head, with no hang-up", async () => {
    const { rig, s } = await doorRig(false);
    rig.openai.script("decisions.create", never(), ok(decisionAnswer({ company: 0.9 })));
    const first = await postTurn(rig, { ...voice(s.stamp, 1, "My boss just walked in."), source: "typed", items: [], judge: "typed" });
    expect(first.status).toBe(200);
    await runScheduled(rig);
    const after = await sessionOf(rig, s.sessionId);
    expect(after).toMatchObject({ audience: "company", waitDeadline: null });
    expect(await jobOf(rig, s.sessionId)).toBeNull();
    const bundle = (await rig.store.get<{ head: { text: string } }>(UID, paths.core(UID, "bundle")))!.data;
    expect(bundle.head.text).not.toContain(PERSONAL_FACT);
    expect(bundle.head.text).toContain("Audience: company.");
  });
});

describe("finding 2: a Superseding_Post with a company line narrows", () => {
  it("answers blocked, stores company, raises policyRev, closes the Session and writes the hangup Job", async () => {
    const { rig, s } = await doorRig(true);
    const before = await epochOf(rig);
    const first = await postTurn(rig, { ...asrTurn(s.stamp, 1, "", [{ itemId: "item_1", commitSeq: 1 }], "missing"), judge: "H" });
    expect(first.body.status).toBe("hold");
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    const late = await postTurn(rig, { ...voice(s.stamp, 1, "My boss just walked in."), requestId: testId("req-1-late"), supersedesRequestId: testId("req-1") });
    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ status: "blocked", permit: null, notes: [], deck: null });
    const after = await sessionOf(rig, s.sessionId);
    expect(after).toMatchObject({ audience: "company", status: "closing", parseLease: null });
    expect(after.waitDeadline).not.toBeNull();
    expect((await epochOf(rig)).policyRev).toBe(before.policyRev + 1);
    expect((await epochOf(rig)).activeSessionId).toBeNull();
    expect(await jobOf(rig, s.sessionId)).not.toBeNull();
    await runScheduled(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(1);
  });
});

describe("finding 3: a typed crisis line with company and no call open narrows", () => {
  it("records company, raises policyRev, sets the crisis modifier, admits only S0 notes and leaves the hang-up out", async () => {
    const { rig, s } = await doorRig(false);
    const before = await epochOf(rig);
    rig.openai.script("decisions.create", ok(decisionAnswer({ crisis: 0.6, company: 0.9 })));
    const res = await postTurn(rig, typedTurn(s.stamp, 1, "My sister is reading this and I can't do this anymore."));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", permit: { kind: "postCommitControl", scope: "ack" } });
    for (const n of res.body.notes) expect(n.sens).toBe("S0");
    expect(headText(res.body)).not.toContain(PERSONAL_FACT);
    const after = await sessionOf(rig, s.sessionId);
    expect(after).toMatchObject({ audience: "company", waitDeadline: null });
    expect(after.modifiers.crisis).not.toBeNull();
    expect(after.status).not.toBe("closing");
    expect((await epochOf(rig)).policyRev).toBe(before.policyRev + 1);
    expect(await jobOf(rig, s.sessionId)).toBeNull();
  });
});
