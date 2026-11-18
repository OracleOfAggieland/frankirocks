import { createHmac } from "node:crypto";
import { type Session, type Stamp, TurnResponse, payloadHash, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import { PHONE_REPORT_WINDOW_MS, clearPhoneReports, phoneReportCards, readPhoneResult } from "./report";
import { reportTool, phoneReportEndpoint } from "./report-mcp";
import { stateRoute } from "../routes/state";
import { paths } from "../store/paths";
import { turnRoute } from "../routes/turn";
import { toolRoute } from "../routes/tool";
import { T0_MS, TEST_ENV, callRoute, patchRecord, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { destination, queued } from "./outbound";
import { DialRejected, dialConfig, dialTwilio } from "./twilio";
import { answerPhoneCall, phoneWebhook } from "./webhook";
import { saveCarrierEvent } from "./callback";
import { PHONE_REPORT_GRACE_MS } from "./lifecycle";

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
  const rig = testRig({ ...env, FRANKI_PHONE_REPORT_ORIGIN: "https://frankirocks.com" });
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
    expect(sip.accept).toHaveBeenCalledExactlyOnceWith(data.call_id, text, { uid: "owner-1", dialId: correlation });
    expect(sip.greet).toHaveBeenCalledExactlyOnceWith(data.call_id);
    expect(sip.reject).toHaveBeenCalledExactlyOnceWith("rtc_another");
  });

  it("returns the SIP agent's report to the private card, typed reply, and live voice tool", async () => {
    const { rig, dial, session } = await setup();
    const uid = "owner-1";
    rig.openai.script("responses.create", ok(intent));
    const placed = await callRoute(rig, turnRoute, typedTurn(session.stamp, 1, text));
    const dialId = dial.mock.calls[0]![2], callId = "rtc_report";
    await answerPhoneCall(rig.deps, { call_id: callId, sip_headers: [{ name: "x-franki-call", value: dialId }] }, controls(), lookupUid);
    expect(reportTool({ ...rig.deps, env }, uid, dialId, callId, "https://other.test")).toBeNull();
    const tool = reportTool(rig.deps, uid, dialId, callId, "https://frankirocks.com")!;
    const rpc = (method: string, params: object, authorization = tool.headers.Authorization) =>
      phoneReportEndpoint(new Request(tool.server_url, { method: "POST", headers: { authorization }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), rig.deps);
    const rpcBody = async (method: string, params: object) => (await rpc(method, params)).json();
    expect(await rpcBody("initialize", { protocolVersion: "2025-06-18" })).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
    expect(await rpcBody("tools/list", {})).toMatchObject({ result: { tools: [{ name: "report_call_outcome" }] } });
    const report = { outcome: "answered", summary: "The shop said it opens at 9 a.m. on Monday." };
    const params = { name: "report_call_outcome", arguments: report };
    expect((await rpc("tools/call", params, "Bearer invalid")).status).toBe(401);
    for (let i = 0; i < 2; i++) expect(await rpcBody("tools/call", params)).toMatchObject({ result: { isError: false } });
    expect(await rpcBody("tools/call", { ...params, arguments: { ...report, summary: "Different answer" } })).toMatchObject({ result: { isError: true } });
    const { epoch, policyRev, bundleRev, rulesRev } = placed.body.stamp;
    const poll = () => callRoute(rig, stateRoute, { sessionId: session.sessionId, generation: 1, seen: { epoch, policyRev, bundleRev, rulesRev }, ackStamp: null, speechStartedOpsAt: null, includeSpecialists: true });
    await patchRecord(rig.store, uid, paths.session(uid, session.sessionId), { audience: "private" });
    const view = await poll();
    expect(view.body.specialists.phone).toBe("ready");
    expect(view.body.phoneReports[0]).toMatchObject({ lines: [report.summary], sens: "S2" });
    rig.openai.script("responses.create", ok(normalizeResponse({ status: "completed", output: [
      { type: "function_call", name: "read_phone_result", call_id: "result", arguments: "{}" },
    ] })));
    const followUp = typedTurn(placed.body.stamp, 2, "What did the shop say?");
    const typed = await callRoute(rig, turnRoute, followUp);
    expect((await callRoute(rig, turnRoute, followUp)).body).toEqual(typed.body);
    expect(typed.body.notes[0]).toMatchObject({ sens: "S2", text: expect.stringContaining(report.summary) });
    const spoken = await callRoute(rig, turnRoute, { ...asrTurn(typed.body.stamp, 3, "What did they say?", [{ itemId: "item3", commitSeq: 3 }]), judge: "O" });
    const lookup = (id: string, includeCompletion = false) => callRoute(rig, toolRoute, { requestId: testId(id), stamp: spoken.body.stamp, callId: id,
      tool: { name: "read_phone_result", args: {}, ...(includeCompletion ? { includeCompletion: true } : {}) } });
    const result = await lookup("private");
    expect(result.body.result).toEqual({ name: "read_phone_result", report });
    expect((await lookup("private")).body).toEqual(result.body);
    expect((await lookup("before-hangup", true)).body.result).toMatchObject({ completion: "active", report });
    await saveCarrierEvent(rig.deps, uid, { dialId, sid, status: "completed" });
    expect((await lookup("after-hangup", true)).body.result).toMatchObject({ completion: "reported", report });
    await patchRecord(rig.store, uid, paths.session(uid, session.sessionId), { audience: "company" });
    expect((await lookup("company", true)).body.result).toEqual({ name: "read_phone_result", report: null });
    expect((await lookup("private")).body).toMatchObject({ status: "stale", result: null });
    expect((await callRoute(rig, turnRoute, followUp)).body).toMatchObject({ status: "stale", notes: [] });
    expect((await poll()).body.phoneReports).toEqual([]);
    await clearPhoneReports(rig.store, uid);
    expect(await rpcBody("tools/call", params)).toMatchObject({ result: { isError: true } });
    rig.clock.advance(PHONE_REPORT_WINDOW_MS + 1);
    expect((await rpc("tools/call", params)).status).toBe(401);
    expect(dial).toHaveBeenCalledTimes(1);
  });

  it("shows one unconfirmed outcome after grace, then updates the same private card when a late report arrives", async () => {
    const { rig, dial, session } = await setup();
    const uid = "owner-1";
    rig.openai.script("responses.create", ok(intent));
    const placed = await callRoute(rig, turnRoute, typedTurn(session.stamp, 1, text));
    const dialId = dial.mock.calls[0]![2];
    const callId = "rtc_late_report";
    await answerPhoneCall(rig.deps, { call_id: callId, sip_headers: [{ name: "x-franki-call", value: dialId }] }, controls(), lookupUid);
    await patchRecord(rig.store, uid, paths.session(uid, session.sessionId), { audience: "private" });
    const { epoch, policyRev, bundleRev, rulesRev } = placed.body.stamp;
    const poll = () => callRoute(rig, stateRoute, { sessionId: session.sessionId, generation: 1,
      seen: { epoch, policyRev, bundleRev, rulesRev }, ackStamp: null, speechStartedOpsAt: null, includeSpecialists: true });
    await saveCarrierEvent(rig.deps, uid, { dialId, sid, status: "completed" });
    expect((await poll()).body.phoneReports).toEqual([]);
    rig.openai.always("responses.create", ok(normalizeResponse({ status: "completed", output: [
      { type: "function_call", name: "read_phone_result", call_id: "lookup", arguments: "{}" },
    ] })));
    const waiting = await callRoute(rig, turnRoute, typedTurn(placed.body.stamp, 2, "What did they say?"));
    expect(waiting.body.notes[0].text).toContain("waiting for the phone specialist");
    rig.clock.advance(PHONE_REPORT_GRACE_MS);
    const afterGrace = (await poll()).body.phoneReports;
    expect(afterGrace).toHaveLength(1);
    expect(afterGrace[0].lines).toEqual(["The call ended. I don’t have a confirmed outcome to share."]);
    const unknown = await callRoute(rig, turnRoute, typedTurn(waiting.body.stamp, 3, "Did they confirm anything?"));
    expect(unknown.body.notes[0].text).toBe(afterGrace[0].lines[0]);
    const tool = reportTool(rig.deps, uid, dialId, callId, "https://frankirocks.com")!;
    const report = { outcome: "voicemail", summary: "Left a voicemail asking for the shop hours." };
    const response = await phoneReportEndpoint(new Request(tool.server_url, { method: "POST", headers: { authorization: tool.headers.Authorization },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "report_call_outcome", arguments: report } }),
    }), rig.deps);
    expect(await response.json()).toMatchObject({ result: { isError: false } });
    expect((await poll()).body.phoneReports).toMatchObject([{ id: afterGrace[0].id, title: "Phone call · voicemail", lines: [report.summary], sens: "S2" }]);
  });

  it("keeps overlapping calls separate when their reports arrive in reverse order", async () => {
    const { rig, dial, session } = await setup();
    const uid = "owner-1";
    rig.openai.always("responses.create", ok(intent));
    const first = await callRoute(rig, turnRoute, typedTurn(session.stamp, 1, text));
    rig.clock.advance(10);
    const second = await callRoute(rig, turnRoute, typedTurn(first.body.stamp, 2, "Call 415 555 0199 and ask about pickup."));
    for (const i of [1, 0]) {
      const dialId = dial.mock.calls[i]![2], callId = "rtc_" + i;
      await answerPhoneCall(rig.deps, { call_id: callId, sip_headers: [{ name: "x-franki-call", value: dialId }] }, controls(), lookupUid);
      const tool = reportTool(rig.deps, uid, dialId, callId, "https://frankirocks.com")!;
      const response = await phoneReportEndpoint(new Request(tool.server_url, {
        method: "POST", headers: { authorization: tool.headers.Authorization },
        body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "report_call_outcome", arguments:
          i === 0 ? { outcome: "answered", summary: "The shop opens at nine." } : { outcome: "voicemail", summary: "Left a message about pickup." } } }),
      }), rig.deps);
      expect(await response.json()).toMatchObject({ result: { isError: false } });
    }
    await patchRecord(rig.store, uid, paths.session(uid, session.sessionId), { audience: "private" });
    const { epoch, policyRev, bundleRev, rulesRev } = second.body.stamp;
    const view = await callRoute(rig, stateRoute, { sessionId: session.sessionId, generation: 1,
      seen: { epoch, policyRev, bundleRev, rulesRev }, ackStamp: null, speechStartedOpsAt: null, includeSpecialists: true });
    expect(view.body.phoneReports.map((c: { lines: string[] }) => c.lines)).toEqual([["Left a message about pickup."], ["The shop opens at nine."]]);
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

  it("rejects a delayed incoming SIP leg after the carrier has already ended the call", async () => {
    const { rig, dial, session } = await setup();
    rig.openai.script("responses.create", ok(intent));
    await callRoute(rig, turnRoute, typedTurn(session.stamp, 1, text));
    const dialId = dial.mock.calls[0]![2];
    await saveCarrierEvent(rig.deps, "owner-1", { dialId, sid, status: "completed" });
    const sip = controls();
    await answerPhoneCall(rig.deps, { call_id: "rtc_late", sip_headers: [{ name: "x-franki-call", value: dialId }] }, sip, lookupUid);
    expect(sip.reject).toHaveBeenCalledExactlyOnceWith("rtc_late");
    expect(sip.accept).not.toHaveBeenCalled();
  });

  it("preserves a recent hangup from a long call after the private report window closes", async () => {
    const { rig, dial, session } = await setup();
    const uid = "owner-1";
    rig.openai.script("responses.create", ok(intent));
    const placed = await callRoute(rig, turnRoute, typedTurn(session.stamp, 1, text));
    rig.clock.advance(PHONE_REPORT_WINDOW_MS + 1);
    await clearPhoneReports(rig.store, uid, rig.clock.read().opsClock.now);
    await saveCarrierEvent(rig.deps, uid, { dialId: dial.mock.calls[0]![2], sid, status: "completed" });
    await patchRecord(rig.store, uid, paths.session(uid, session.sessionId), { audience: "private" });
    await rig.store.transaction(uid, async (tx) => {
      const current = (await tx.get<Session>(paths.session(uid, session.sessionId)))!.data;
      const args = [tx, rig.deps, uid, session.sessionId, current, placed.body.stamp.epoch] as const;
      expect(await readPhoneResult(...args)).toMatchObject({ completion: "unconfirmed", report: null });
      expect(await phoneReportCards(...args)).toMatchObject([{ lines: ["The call ended. I don’t have a confirmed outcome to share."] }]);
    });
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
    expect(await dialTwilio(dialConfig(env, "https://frankirocks.com"), "+14155550123", id)).toBe(sid);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`);
    expect(options?.method).toBe("POST");
    expect(options?.headers).toHaveProperty("Authorization", expect.stringMatching(/^Basic /));
    const form = options!.body as URLSearchParams;
    expect(form.get("From")).toBe(env.TWILIO_PHONE_NUMBER);
    expect(form.get("To")).toBe("+14155550123");
    expect(form.get("StatusCallback")).toBe(`https://frankirocks.com/api/phone/twilio?dialId=${id}#rt=5000&rc=2&rp=ct,rt,5xx`);
    expect(form.get("StatusCallbackMethod")).toBe("POST");
    expect(form.getAll("StatusCallbackEvent")).toEqual(["initiated", "ringing", "answered", "completed"]);
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
