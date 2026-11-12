// voice-control task 49 (brief 026): `alone` widens the Session on `/api/turn` (R15.1, R15.8; design "Wave B":
// Alone, row 10).
import { ALONE_LINE, type CoreBundle, type CoreEpoch, type Session } from "@franki/core";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord, runScheduled, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { seedTwoMemories } from "../testing/two-memories";
import { hangupJobId } from "../worker/hangup";
import { turnRoute } from "./turn";

const UID = "owner-1";

async function setup(audience: Session["audience"] = "company") {
  const rig = testRig();
  rig.openai.always("responses.create", ok(completed("All right.")));
  rig.openai.always("realtime.calls.hangup", ok(null));
  await seedTwoMemories(rig);
  const s = await openTestSession(rig);
  await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a", audience });
  // The call was opened narrow: its Head has no S1 line.
  const b = await bundleOf(rig);
  await patchRecord<CoreBundle>(rig.store, UID, paths.core(UID, "bundle"), { head: { ...b.head!, text: b.head!.text.replace(/^- .*personal fact.*$/m, "") } });
  expect((await bundleOf(rig)).head!.text).not.toContain("personal fact");
  return { rig, s };
}

const post = (rig: TestRig, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
const voice = (stamp: Awaited<ReturnType<typeof openTestSession>>["stamp"], n: number, text: string, judge = "H") => ({ ...asrTurn(stamp, n, text, [{ itemId: `item_${n}`, commitSeq: n }]), judge });
const sessionOf = async (rig: TestRig, id: string) => (await rig.store.get<Session>(UID, paths.session(UID, id)))!.data;
const epochOf = async (rig: TestRig) => (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
const bundleOf = async (rig: TestRig) => (await rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;

describe("/api/turn: alone (task 49)", () => {
  it("stores private, raises policyRev, compiles a full Head with bundleRev + 1, and returns the new Deck with the ALONE line", async () => {
    const { rig, s } = await setup("company");
    const epoch0 = await epochOf(rig);
    const bundle0 = await bundleOf(rig);
    rig.openai.script("decisions.create", ok(decisionAnswer({ alone: 0.9 })));
    const res = await post(rig, voice(s.stamp, 1, "Okay, it's just us now."));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", permit: { kind: "postCommitControl", scope: "ack" } });
    expect(res.body.notes.map((n: { kind: string; text: string }) => [n.kind, n.text])).toEqual([["ack", ALONE_LINE]]);
    expect(res.body.stamp.policyRev).toBe(epoch0.policyRev + 1);
    expect(res.body.stamp.bundleRev).toBe(bundle0.bundleRev + 1);
    expect(res.body.deck.bundleRev).toBe(bundle0.bundleRev + 1);
    expect(res.body.deck.head.text).toContain("personal fact");
    expect(res.body.deck.head.text).toContain("Audience: private.");
    expect(res.body.permit.stamp.bundleRev).toBe(bundle0.bundleRev + 1);
    expect((await bundleOf(rig)).bundleRev).toBe(bundle0.bundleRev + 1);
    expect((await epochOf(rig)).policyRev).toBe(epoch0.policyRev + 1);
    const session = await sessionOf(rig, s.sessionId);
    expect(session).toMatchObject({ audience: "private", status: "active", waitDeadline: null });
  });

  it("no hang-up", async () => {
    const { rig, s } = await setup("company");
    rig.openai.script("decisions.create", ok(decisionAnswer({ alone: 0.9 })));
    await post(rig, voice(s.stamp, 1, "Okay, it's just us now."));
    expect(await rig.store.get(UID, paths.job(UID, hangupJobId(s.sessionId as never, rig.deps.hasher)))).toBeNull();
    await runScheduled(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(0);
    expect((await sessionOf(rig, s.sessionId)).status).toBe("active");
  });

  it("a gap stays a gap: alone restores the audience but never moves the watermark past another Turn (R15.8)", async () => {
    const { rig, s } = await setup("unknown");
    // Turn 1 failed its parse earlier and its repair never came: the watermark is behind.
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { lastClientSeq: 1, nextClientSeq: 2, committedParseSeq: 0 });
    rig.openai.script("decisions.create", ok(decisionAnswer({ alone: 0.9 })));
    const res = await post(rig, voice(s.stamp, 2, "Okay, it's just us now."));
    expect(res.body.status).toBe("ready");
    const session = await sessionOf(rig, s.sessionId);
    expect(session.audience).toBe("private");
    expect(session.committedParseSeq).toBe(0);
    expect(session.lastClientSeq).toBe(2);
  });

  it("a weak alone line with judge O doesn't widen (route rule; question 95)", async () => {
    const { rig, s } = await setup("company");
    rig.openai.script("decisions.create", ok(decisionAnswer({ alone: 0.41 })));
    const res = await post(rig, voice(s.stamp, 1, "It's so windy out today.", "O"));
    expect(res.body.notes.map((n: { text: string }) => n.text)).not.toContain(ALONE_LINE);
    expect((await sessionOf(rig, s.sessionId)).audience).toBe("company");
  });
});
