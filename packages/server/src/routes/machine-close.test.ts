// Brief 040, item 5: the machine's own closes say `replace`, so a company Session the machine closes stays company.
// Through the real voice machine and the close route: the call holds Session B, which inherited company from A; a
// `blocked` answer for A arrives (a post of A answered late), so the machine swaps and closes B itself. That close
// must not mark B private (a `user` close does, brief 035 finding 5): the open that follows, naming B, starts company.
import { type Session, type VoiceCommand, type VoiceState, initialVoiceState, step } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { paths } from "../store/paths";
import { UID, doorRig, postTurn } from "../testing/audience-doors";
import { decisionAnswer } from "../testing/decisions";
import { type TestRig, callRoute, patchRecord } from "../testing/fakes";
import { asrTurn } from "../testing/session-fixtures";
import { closeRoute } from "./close";
import { openRoute } from "./open";

const openNaming = (rig: TestRig, previousSessionId: string, label: string) => callRoute(rig, openRoute, { requestId: testId(label), initiator: "user", previousSessionId, clientZone: "UTC", visitId: null });
const sessionOf = async (rig: TestRig, id: string) => (await rig.store.get<Session>(UID, paths.session(UID, id)))!.data;

describe("the machine's own close keeps a company Session company (brief 040, item 5)", () => {
  it("a swap that closes the Session the call held sends replace, and the next open naming it starts company", async () => {
    const { rig, s } = await doorRig(true);
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    await postTurn(rig, { ...asrTurn(s.stamp, 1, "My boss just walked in.", [{ itemId: "item_1", commitSeq: 1 }]), judge: "H" });
    const b = await openNaming(rig, s.sessionId, "open-b");
    expect(b.status).toBe(200);
    const bId: string = b.body.sessionId;
    await patchRecord<Session>(rig.store, UID, paths.session(UID, bId), { status: "active", registeredCallIds: ["rtc_b"], callId: "rtc_b" });
    expect((await sessionOf(rig, bId)).audience).toBe("company");

    // The call holds B.
    let st: VoiceState = initialVoiceState({ transcribeModel: "test-transcribe" }, "UTC");
    const run = (e: Parameters<typeof step>[1], now: number): VoiceCommand[] => {
      const r = step(st, e, now);
      st = r.state;
      return r.commands;
    };
    run({ type: "callPressed", zone: "UTC" }, 0);
    run({ type: "openOk", response: b.body }, 100);
    expect(st.session?.sessionId).toBe(bId);

    // A late `blocked` answer for A: the machine swaps away from A and closes B itself.
    const cmds = run(
      { type: "turnOk", turnId: testId("turn-1"), response: { requestId: testId("r1"), stamp: { ...s.stamp, turnId: testId("turn-1") }, status: "blocked", deck: null, permit: null, notes: [], cards: [], pendingId: null, question: null, retryAfterMs: 0, receiptId: null, error: null } },
      200,
    );
    const close = cmds.find((c): c is Extract<VoiceCommand, { kind: "close" }> => c.kind === "close");
    expect(close?.body).toMatchObject({ sessionId: bId, reason: "replace" });
    const closed = await callRoute(rig, closeRoute, { requestId: testId("close-b"), ...close!.body });
    expect(closed.status).toBe(200);
    expect((await sessionOf(rig, bId)).audience).toBe("company");

    const c = await openNaming(rig, bId, "open-c");
    expect(c.status).toBe(200);
    expect((await sessionOf(rig, c.body.sessionId)).audience).toBe("company");
  });

  it("the owner's own hang-up still sends user, which makes what it passes on private (brief 035, finding 5)", async () => {
    const { rig, s } = await doorRig(true);
    rig.openai.script("decisions.create", ok(decisionAnswer({ company: 0.9 })));
    await postTurn(rig, { ...asrTurn(s.stamp, 1, "My boss just walked in.", [{ itemId: "item_1", commitSeq: 1 }]), judge: "H" });
    // Brief 045: B opens after A's turn, as it always does in real time (a frozen clock would tie them).
    rig.clock.advance(1_000);
    const b = await openNaming(rig, s.sessionId, "open-b");
    const bId: string = b.body.sessionId;
    await patchRecord<Session>(rig.store, UID, paths.session(UID, bId), { status: "active", registeredCallIds: ["rtc_b"], callId: "rtc_b" });
    let st: VoiceState = initialVoiceState({ transcribeModel: "test-transcribe" }, "UTC");
    st = step(st, { type: "callPressed", zone: "UTC" }, 0).state;
    st = step(st, { type: "openOk", response: b.body }, 100).state;
    const cmds = step(st, { type: "hangupPressed" }, 200).commands;
    const close = cmds.find((c): c is Extract<VoiceCommand, { kind: "close" }> => c.kind === "close");
    expect(close?.body).toMatchObject({ sessionId: bId, reason: "user" });
    await callRoute(rig, closeRoute, { requestId: testId("close-b"), ...close!.body });
    const c = await openNaming(rig, bId, "open-c");
    expect((await sessionOf(rig, c.body.sessionId)).audience).toBe("private");
  });
});
