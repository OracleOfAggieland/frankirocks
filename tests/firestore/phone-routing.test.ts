import { randomUUID } from "node:crypto";
import { OpenResponse, TurnResponse } from "@franki/core";
import { testId } from "@franki/core/testing";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, expect, it, vi } from "vitest";
import { liveTimers } from "../../packages/server/src/clock/timers";
import { ok } from "../../packages/server/src/openai/fake";
import { completed } from "../../packages/server/src/openai/responses";
import { queued } from "../../packages/server/src/phone/outbound";
import { type Dial } from "../../packages/server/src/phone/twilio";
import { answerPhoneCall, findPhoneUid } from "../../packages/server/src/phone/webhook";
import { openRoute } from "../../packages/server/src/routes/open";
import { parseWith, runRoute } from "../../packages/server/src/routes/runtime";
import { toolRoute } from "../../packages/server/src/routes/tool";
import { turnRoute } from "../../packages/server/src/routes/turn";
import { FirestoreStore } from "../../packages/server/src/store/firestore-store";
import { TEST_ENV, fakeRequest, testRig } from "../../packages/server/src/testing/fakes";
import { asrTurn, typedTurn } from "../../packages/server/src/testing/session-fixtures";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Run with the Firestore emulator");
const app = initializeApp({ projectId: "demo-franki" }, "phone-routing");
const db = getFirestore(app);
afterAll(() => deleteApp(app));

it("routes simultaneous users' typed and spoken call requests to their own conversation", async () => {
  const rig = testRig({
    ...TEST_ENV, TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "test",
    TWILIO_PHONE_NUMBER: "+14155550100", OPENAI_PROJECT_ID: "proj_test", OPENAI_WEBHOOK_SECRET: "test",
    FRANKI_PHONE_REPORT_ORIGIN: "https://frankirocks.com",
  });
  const dial = vi.fn<Dial>().mockResolvedValue("CA" + "1".repeat(32));
  const deps = { ...rig.deps, dial, timers: liveTimers, store: new FirestoreStore(db, rig.deps.hasher) };
  rig.openai.always("responses.create", ok({ ...completed(""), phoneCallRequested: true }));
  const texts = ["Call +14155550123 and ask for today's hours.", "Call +14155550124 and ask about delivery."];
  const requestId = testId("same-open-request");
  const uids = texts.map((_, i) => `caller-${i}-${randomUUID()}`);
  for (const [i, text] of texts.entries()) {
    const token = "token:" + uids[i];
    const request = (body: unknown) => fakeRequest({ body, token });
    const opened = await runRoute(openRoute, request({ requestId, initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: null }), deps, rig.sched.schedule);
    expect(opened.status).toBe(200);
    const { deck, sessionId, generation } = parseWith(OpenResponse, opened.body);
    if (!deck) throw new Error("Expected an open session");
    const stamp = { sessionId, generation, epoch: deck.epoch, policyRev: deck.policyRev, bundleRev: deck.bundleRev, rulesRev: deck.rulesRev };
    if (i === 0) {
      const res = await runRoute(turnRoute, request(typedTurn(stamp, 1, text)), deps, rig.sched.schedule);
      expect(res.body).toMatchObject({ notes: [{ text: queued }] });
    } else {
      const turn = await runRoute(turnRoute, request(asrTurn(stamp, 1, text, [{ itemId: "spoken", commitSeq: 1 }])), deps, rig.sched.schedule);
      const tool = await runRoute(toolRoute, request({
        requestId: testId("tool"), stamp: parseWith(TurnResponse, turn.body).stamp, callId: "tool-2",
        tool: { name: "make_phone_call", args: {} },
      }), deps, rig.sched.schedule);
      expect(tool.body).toMatchObject({ result: { message: queued } });
    }
  }
  expect(dial).toHaveBeenCalledTimes(2);
  const callbacks = dial.mock.calls.map(([, , value], i) => ({
    call_id: `rtc_${i}`, sip_headers: [{ name: "X-Franki-Call", value }],
  }));
  const sip = { accept: vi.fn(), greet: vi.fn(), reject: vi.fn() };
  const lookup = (id: string) => findPhoneUid(db, id);
  await Promise.all(callbacks.toReversed().map(data => answerPhoneCall(deps, data, sip, lookup)));
  expect(sip.accept).toHaveBeenCalledTimes(2);
  for (const [i, uid] of uids.entries()) {
    // No name saved: each caller carries only that owner's local time, read from the real store.
    expect(sip.accept).toHaveBeenCalledWith(`rtc_${i}`, texts[i], { uid, dialId: dial.mock.calls[i]![2] }, { name: null, localTime: expect.any(String) });
  }
  expect(sip.reject).not.toHaveBeenCalled();
  await answerPhoneCall(deps, { call_id: "rtc_unknown", sip_headers: [{ name: "X-Franki-Call", value: testId("unrequested") }] }, sip, lookup);
  expect(sip.reject).toHaveBeenCalledExactlyOnceWith("rtc_unknown");
});
