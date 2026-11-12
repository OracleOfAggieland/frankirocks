import { createHmac } from "node:crypto";
import { type Stamp, TurnResponse, payloadHash, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import { turnRoute } from "../routes/turn";
import { toolRoute } from "../routes/tool";
import { T0_MS, TEST_ENV, callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { destination, queued } from "./outbound";
import { DialRejected, dialTwilio, phoneConfig } from "./twilio";
import { answerPhoneCall, phoneWebhook } from "./webhook";

const lookupUid = async () => "owner-1";
const env = { ...TEST_ENV, TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32),
  TWILIO_AUTH_TOKEN: "test-token", TWILIO_PHONE_NUMBER: "+14155550100", OPENAI_PROJECT_ID: "proj_test",
  OPENAI_WEBHOOK_SECRET: "test-secret" };
const sid = "CA" + "a".repeat(32);
const text = "Call +1 (415) 555-0123 and ask when the shop opens.";
const intent = normalizeResponse({ status: "completed", output: [
  { type: "function_call", status: "completed", name: "make_phone_call", arguments: "{}" },
] });
const controls = () => ({ accept: vi.fn(async () => {}), greet: vi.fn(async () => {}), reject: vi.fn(async () => {}) });

async function setup() {
  const rig = testRig(env);
  const dial = vi.fn<typeof dialTwilio>().mockResolvedValue(sid);
  rig.deps.dial = dial;
  const session = await openTestSession(rig);
  return { rig, dial, session };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("outbound phone calls", () => {
  it("dials once from a typed tool call, admits the receipt and binds the webhook to that assignment", async () => {
    const { rig, dial, session } = await setup();
    rig.openai.script("responses.create", ok(intent));
    const req = typedTurn(session.stamp, 1, text);
    const res = await callRoute(rig, turnRoute, req);
    expect(res.status).toBe(200);
    expect(validate(TurnResponse, res.body).ok).toBe(true);
    expect(res.body.notes[0].text).toBe(queued);
    expect(res.body.permit.approvedPayloadHash).toBe(payloadHash({ stamp: res.body.stamp, head: res.body.deck.head,
      notes: res.body.notes, turns: res.body.deck.turns, audioIds: [], toolOutput: null }, rig.deps.hasher));
    expect((await callRoute(rig, turnRoute, req)).body).toEqual(res.body);
    expect(dial).toHaveBeenCalledTimes(1);
    const [, to, correlation] = dial.mock.calls[0]!;
    expect(to).toBe("+14155550123");
    const data = { call_id: "rtc_test", sip_headers: [{ name: "X-Franki-Call", value: correlation }] };
    const sip = controls();
    await answerPhoneCall(rig.deps, data, sip, lookupUid);
    await answerPhoneCall(rig.deps, data, sip, lookupUid);
    await answerPhoneCall(rig.deps, { ...data, call_id: "rtc_another" }, sip, lookupUid);
    expect(sip.accept).toHaveBeenCalledExactlyOnceWith(data.call_id, text);
    expect(sip.greet).toHaveBeenCalledExactlyOnceWith(data.call_id);
    expect(sip.reject).toHaveBeenCalledExactlyOnceWith("rtc_another");
  });

  it("uses an admitted spoken tool request and replays an ambiguous provider result without redialing", async () => {
    const { rig, dial, session } = await setup();
    dial.mockRejectedValue(new Error("connection reset"));
    const turn = await callRoute(rig, turnRoute, asrTurn(session.stamp, 1, text, [{ itemId: "item1", commitSeq: 1 }]));
    const tool = { requestId: testId("phone-tool"), stamp: turn.body.stamp as Stamp,
      callId: "tool1", tool: { name: "make_phone_call", args: {} } };
    const result = await callRoute(rig, toolRoute, tool);
    expect(result.status).toBe(200);
    expect(result.body.result.message).toContain("couldn’t confirm");
    expect((await callRoute(rig, toolRoute, tool)).body).toEqual(result.body);
    const duplicate = await callRoute(rig, toolRoute, { ...tool, callId: "tool2", requestId: testId("another-request") });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.result.message).toEqual(result.body.result.message);
    expect(dial).toHaveBeenCalledTimes(1);
  });

  it("recovers a lost SIP acceptance response by attaching to the already accepted call", async () => {
    const { rig, dial, session } = await setup();
    rig.openai.script("responses.create", ok(intent));
    await callRoute(rig, turnRoute, typedTurn(session.stamp, 1, text));
    const data = { call_id: "rtc_lost", sip_headers: [{ name: "x-franki-call", value: dial.mock.calls[0]![2] }] };
    const sip = controls();
    sip.accept.mockRejectedValue(new Error("accept response lost"));
    await expect(answerPhoneCall(rig.deps, data, sip, lookupUid)).rejects.toThrow();
    rig.clock.advance(15_001);
    await answerPhoneCall(rig.deps, data, sip, lookupUid);
    await answerPhoneCall(rig.deps, data, sip, lookupUid);
    expect(sip.accept).toHaveBeenCalledTimes(2);
    expect(sip.greet).toHaveBeenCalledExactlyOnceWith(data.call_id);
    expect(dial).toHaveBeenCalledTimes(1);
  });

  it("reports Twilio rejection and keeps stale, pasted and signed-out requests from dialing", async () => {
    const { rig, dial, session } = await setup();
    dial.mockRejectedValue(new DialRejected());
    rig.openai.always("responses.create", ok(intent));
    const stale = await callRoute(rig, turnRoute, { ...typedTurn(session.stamp, 1, text, "stale"), bundleRev: 77 });
    expect(stale.body.status).toBe("stale");
    await callRoute(rig, turnRoute, typedTurn(session.stamp, 1, "From: writer@example.com\n" + text));
    expect(dial).not.toHaveBeenCalled();
    const denied = await callRoute(rig, turnRoute, typedTurn(session.stamp, 2, text), { token: null });
    expect(denied.status).toBe(401);
    expect(dial).not.toHaveBeenCalled();
    const res = await callRoute(rig, turnRoute, typedTurn(session.stamp, 2, text));
    expect(res.body.notes[0].text).toContain("Twilio declined");
    expect(dial).toHaveBeenCalledTimes(1);
  });

  it("posts authenticated form-encoded TwiML with an encrypted SIP leg to the configured project", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ sid }, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const id = testId("sip");
    expect(await dialTwilio(phoneConfig(env), "+14155550123", id)).toBe(sid);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`);
    expect(options?.method).toBe("POST");
    expect(options?.headers).toHaveProperty("Authorization", expect.stringMatching(/^Basic /));
    const form = options!.body as URLSearchParams;
    expect(form.get("From")).toBe(env.TWILIO_PHONE_NUMBER);
    expect(form.get("To")).toBe("+14155550123");
    expect(form.get("Twiml")).toContain(`sip:proj_test@sip.api.openai.com;transport=tls;secure=true?x-franki-call=${id}</Sip>`);
  });

  it("rejects unsigned OpenAI webhooks before looking up any call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("OPENAI_WEBHOOK_SECRET", "test");
    expect((await phoneWebhook(new Request("https://example.test/api/phone/openai", { method: "POST", body: "{}" }))).status).toBe(400);
  });

  it("accepts a valid signature and rejects a changed body with the same signature", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0_MS);
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("OPENAI_WEBHOOK_SECRET", "test-secret");
    const raw = JSON.stringify({ type: "response.completed", id: "evt_test" });
    const timestamp = String(T0_MS / 1000);
    const signature = createHmac("sha256", "test-secret").update(`evt_test.${timestamp}.${raw}`).digest("base64");
    const headers = { "webhook-id": "evt_test", "webhook-timestamp": timestamp, "webhook-signature": "v1," + signature };
    const deliver = (body: string) => phoneWebhook(new Request("https://example.test/api/phone/openai", { method: "POST", headers, body }));
    expect((await deliver(raw)).status).toBe(204);
    expect((await deliver(raw + " ")).status).toBe(400);
  });

  it("grounds the destination in the user's words and asks for ambiguous numbers", () => {
    expect(destination("Dial plus four four two zero seven nine four six zero zero zero zero", env.TWILIO_PHONE_NUMBER)).toBe("+442079460000");
    expect(destination("Call (415) 555-0123", env.TWILIO_PHONE_NUMBER)).toBe("+14155550123");
    expect(destination("Call 415-555-0123 or 415-555-0100", env.TWILIO_PHONE_NUMBER)).toBeNull();
    expect(destination("Call the shop", env.TWILIO_PHONE_NUMBER)).toBeNull();
  });
});
