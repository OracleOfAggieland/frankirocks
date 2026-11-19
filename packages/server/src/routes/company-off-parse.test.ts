// Owner, Nov 19 (company mode off; company-off.ts): a slow parse that failed counts as an ordinary committed parse for
// the watermark and the audience. In the Nov 19 live test one refused Decisions answer left a Parse_Gap for the rest of
// the call: no StateAck, so a finished calendar errand was never offered. With company mode on, nothing changes.
import { type CoreEpoch, INTENT_NAMES, type Session, type Turn } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fail, never, ok } from "../openai/fake";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { TEST_ENV, callRoute, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { stateRoute } from "./state";
import { turnRoute } from "./turn";

const UID = "owner-1";
type Rig = ReturnType<typeof testRig>;
const items = (n: number) => [{ itemId: `item_${n}`, commitSeq: n }];

const offEnv = (): Record<string, string> => {
  const env: Record<string, string> = { ...TEST_ENV };
  delete env.FRANKI_COMPANY_MODE;
  return env;
};
/** A Decisions answer that refuses the `alone` question, as the live test's turn 3 did. */
const refusal = () => {
  const a = decisionAnswer();
  const i = INTENT_NAMES.indexOf("alone");
  return { ...a, answers: a.answers.map((x, n) => (n === i ? { type: "refusal", refusal: "I can't help with that." } : x)) };
};

const post = (rig: Rig, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
const runScheduled = (rig: Rig) => settle(rig.sched.runAll(), rig.clock, rig.timers);
const session = async (rig: Rig, id: string) => (await rig.store.get<Session>(UID, paths.session(UID, id)))!.data;
const turn = async (rig: Rig, sessionId: string, label: number) => (await rig.store.get<Turn>(UID, paths.turn(UID, sessionId, testId(`turn-${label}`))))!.data;
const policyRev = async (rig: Rig) => (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data.policyRev;
const decisions = (rig: Rig) => rig.openai.requestsTo("decisions.create").length;
const poll = (s: Awaited<ReturnType<typeof openTestSession>>) => ({
  sessionId: s.sessionId,
  generation: 1,
  seen: { epoch: s.stamp.epoch, policyRev: s.stamp.policyRev, bundleRev: s.stamp.bundleRev, rulesRev: s.stamp.rulesRev },
  ackStamp: null,
  speechStartedOpsAt: null,
});

async function opened(env: Record<string, string>) {
  const rig = testRig(env);
  const s = await openTestSession(rig);
  return { rig, s };
}

describe("owner, Nov 19: a failed slow parse with company mode off", () => {
  it("a refusal, twice (parse and repair), leaves no gap, no lease and no unknown audience; the poll still acks", async () => {
    const { rig, s } = await opened(offEnv());
    rig.openai.script("decisions.create", ok(refusal()), ok(refusal()));
    const res = await post(rig, asrTurn(s.stamp, 1, "I get off late, like around 3 a.m.", items(1)));
    expect(res.body.status).toBe("hold"); // The turn's own reply is still the Server_Rule's recovery line (row 5).
    const right = await session(rig, s.sessionId);
    expect([right.committedParseSeq, right.lastClientSeq, right.parseLease, right.audience]).toEqual([1, 1, null, "private"]);
    expect((await turn(rig, s.sessionId, 1)).parseState).toBe("committed");
    await runScheduled(rig);
    expect(decisions(rig)).toBe(2); // the repair still ran once, lease-free
    const after = await session(rig, s.sessionId);
    expect([after.committedParseSeq, after.parseLease, after.audience]).toEqual([1, null, "private"]);

    // The next turns commit past it, and the state poll issues its ack (the gate errand delivery waits on).
    await post(rig, asrTurn(s.stamp, 2, "Anyway, what's on my calendar?", items(2)));
    expect((await session(rig, s.sessionId)).committedParseSeq).toBe(2);
    rig.clock.advance(1_000);
    expect((await callRoute(rig, stateRoute, poll(s))).body.ack).not.toBeNull();
  });

  it.each([
    ["a missed deadline", never(), fail(new Error("again"))],
    ["a transport error", fail(new Error("transport")), never()],
  ])("%s and a failed repair store nothing", async (_name, first, second) => {
    const { rig, s } = await opened(offEnv());
    rig.openai.script("decisions.create", first, second);
    await post(rig, asrTurn(s.stamp, 1, "my dog loves the park", items(1)));
    await runScheduled(rig);
    const after = await session(rig, s.sessionId);
    expect([after.committedParseSeq, after.lastClientSeq, after.parseLease, after.audience]).toEqual([1, 1, null, "private"]);
  });

  it("an oversize line commits as ordinary and is not repaired", async () => {
    const { rig, s } = await opened(offEnv());
    await post(rig, asrTurn(s.stamp, 1, "x ".repeat(4000), items(1)));
    await runScheduled(rig);
    expect(decisions(rig)).toBe(0);
    const after = await session(rig, s.sessionId);
    expect([after.committedParseSeq, after.parseLease, after.audience]).toEqual([1, null, "private"]);
  });

  it("the lease-free repair still takes a late hit: policyRev rises and the speaker probability is kept", async () => {
    const { rig, s } = await opened(offEnv());
    rig.openai.script("decisions.create", never(), ok(decisionAnswer({ forget: 0.95, uncertainSpeaker: 0.02 })));
    await post(rig, asrTurn(s.stamp, 1, "forget what I said about the park", items(1)));
    const rev = await policyRev(rig);
    await runScheduled(rig);
    expect(await policyRev(rig)).toBe(rev + 1);
    expect(await turn(rig, s.sessionId, 1)).toMatchObject({ parseState: "committed", uncertainSpeaker: 0.02 });
    expect((await session(rig, s.sessionId)).audience).toBe("private");
  });

  it("a Superseding_Post whose parse fails commits as ordinary too", async () => {
    const { rig, s } = await opened(offEnv());
    await post(rig, asrTurn(s.stamp, 1, "", items(1), "missing"));
    expect((await session(rig, s.sessionId)).committedParseSeq).toBe(0);
    rig.openai.script("decisions.create", ok(refusal()));
    const res = await post(rig, { ...asrTurn(s.stamp, 1, "I get off late", items(1)), requestId: testId("req-1-late"), supersedesRequestId: testId("req-1") });
    expect(res.status).toBe(200);
    const after = await session(rig, s.sessionId);
    expect([after.committedParseSeq, after.parseLease, after.audience]).toEqual([1, null, "private"]);
    expect((await turn(rig, s.sessionId, 1)).parseState).toBe("committed");
  });

  it("with company mode on, the same refusal still leaves the gap and an unknown audience", async () => {
    const { rig, s } = await opened({ ...TEST_ENV });
    rig.openai.script("decisions.create", ok(refusal()), ok(refusal()));
    await post(rig, asrTurn(s.stamp, 1, "I get off late, like around 3 a.m.", items(1)));
    await runScheduled(rig);
    const after = await session(rig, s.sessionId);
    expect([after.committedParseSeq, after.lastClientSeq, after.audience]).toEqual([0, 1, "unknown"]);
    expect((await turn(rig, s.sessionId, 1)).parseState).toBe("failed");
  });
});
