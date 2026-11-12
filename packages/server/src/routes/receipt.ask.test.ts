// Brief 018 task B7: the open allergy question after Franki speaks (receipt), and no ack while it is asked (state).
import { type CoreRules, type Session, idParts } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { receiptRoute } from "./receipt";
import { stateRoute } from "./state";
import { turnRoute } from "./turn";

const UID = "owner-1";
const RULE = testId("pending-rule");

async function setup() {
  const rig = testRig();
  rig.openai.always("responses.create", ok(completed("All right.")));
  const s = await openTestSession(rig);
  await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  let n = 0;
  const receipt = (text: string) =>
    callRoute(rig, receiptRoute, { requestId: testId(`rcpt${++n}`), stamp: { ...s.stamp, turnId: testId("turn-1") }, responseId: `resp_${n}`, kind: "transcript", momentIds: [], noteIds: [], pendingId: null, permitKind: null, text });
  const state = () => callRoute(rig, stateRoute, { sessionId: s.sessionId, generation: 1, seen: { epoch: s.stamp.epoch, policyRev: s.stamp.policyRev, bundleRev: s.stamp.bundleRev, rulesRev: s.stamp.rulesRev }, ackStamp: null, speechStartedOpsAt: null });
  return { rig, s, receipt, state };
}

const rulesOf = async (rig: TestRig) => (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
const plan = (rig: TestRig, sessionId: string) => patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), { ask: { sessionId, q: { kind: "planned", ruleId: RULE, seq: 1 } } });

describe("the open question after Franki speaks (B7)", () => {
  it("a planned question becomes asked when the spoken words hold it", async () => {
    const { rig, s, receipt } = await setup();
    await plan(rig, s.sessionId);
    expect((await receipt("Got it. Who is that for?")).body).toMatchObject({ accepted: true });
    expect((await rulesOf(rig)).ask).toEqual({ sessionId: s.sessionId, q: { kind: "asked", ruleId: RULE, askedSeq: 0, attempts: 0 } });
  });

  it("a question cut by a barge-in is not asked", async () => {
    const { rig, s, receipt } = await setup();
    await plan(rig, s.sessionId);
    await receipt("Got it. Who is");
    expect((await rulesOf(rig)).ask.q.kind).toBe("none");
  });

  it("Franki's own allergy question makes the next turn an answer", async () => {
    const { rig, s, receipt } = await setup();
    await receipt("Before I plan dinner: any allergies I should know about?");
    expect((await rulesOf(rig)).ask).toMatchObject({ sessionId: s.sessionId, q: { kind: "asked", ruleId: null } });
    const text = "Shellfish and peanuts, both.";
    rig.openai.script("decisions.create", ok(decisionAnswer({ hardRule: 0.01 })));
    rig.fastSlots.script((input) => ({
      kind: "valid",
      out: {
        items: ["shellfish", "peanuts"].map((item) => ({ kind: "allergy", subject: { entityId: null, mention: null, isSelf: false }, item, severity: "allergy", polarity: "affirmed", act: "direct", span: { eid: input.turn.eid, fieldPath: "text", start: 0, end: 21, quote: text.slice(0, 21) } })),
        need: "subject",
      },
      ms: 40,
    }));
    await settle(callRoute(rig, turnRoute, asrTurn(s.stamp, 1, text, [{ itemId: "item_1", commitSeq: 1 }])), rig.clock, rig.timers);
    expect(rig.fastSlots.calls).toHaveLength(1);
    const rules = await rulesOf(rig);
    expect(rules.allergies.filter((r) => r.state === "pending").map((r) => r.code).sort()).toEqual(["peanut", "shellfish"]);
    expect(rules.allergies.some((r) => r.state === "active")).toBe(false);
  });

  it("state returns no ack while a question is asked, and one otherwise", async () => {
    const { rig, s, state } = await setup();
    expect((await state()).body.ack).not.toBeNull();
    await patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), { ask: { sessionId: s.sessionId, q: { kind: "asked", ruleId: null, askedSeq: 0, attempts: 0 } } });
    expect((await state()).body.ack).toBeNull();
    // A question asked in another Session doesn't hold this one.
    await patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), { ask: { sessionId: rig.deps.hasher.id(idParts.session(UID, "other")), q: { kind: "asked", ruleId: null, askedSeq: 0, attempts: 0 } } });
    expect((await state()).body.ack).not.toBeNull();
  });
});
