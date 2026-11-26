import { type Session } from "@franki/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { never, ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import { completed } from "../openai/responses";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { TEST_ENV, type TestRig, callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { saveCarrierEvent } from "./callback";
import { NO_WORDS_SUMMARY, PHONE_SUMMARY_DEADLINE_MS, UNCONNECTED_SUMMARY, reportUnconnectedCall, summarizePhoneCall } from "./fallback";
import { PHONE_REPORT_GRACE_MS } from "./lifecycle";
import {
  type ListenBinding, type SidebandSocket, LISTEN_START_MS, PHONE_HANG_UP_MS, PHONE_WRAP_UP_MS, WRAP_UP_LINE,
  listenRequest, listenToPhoneCall, phoneListenEndpoint, startPhoneListener,
} from "./listen";
import { readPhoneResult, reportPath } from "./report";
import { phoneReportEndpoint, reportTool } from "./report-mcp";
import type { dialTwilio } from "./twilio";
import { answerPhoneCall, phoneCallInstructions, phoneCallSession } from "./webhook";

const uid = "owner-1";
const sid = "CA" + "b".repeat(32);
const origin = "https://frankirocks.com";
const env = { ...TEST_ENV, TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "test-token", TWILIO_PHONE_NUMBER: "+14155550100",
  OPENAI_PROJECT_ID: "proj_test", OPENAI_WEBHOOK_SECRET: "test-secret", FRANKI_PHONE_REPORT_ORIGIN: origin };
const text = "Call +1 (415) 555-0123 and ask when the shop opens.";
const intent = normalizeResponse({ status: "completed", output: [
  { type: "function_call", status: "completed", name: "make_phone_call", arguments: "{}" },
] });
const sip = () => ({ accept: vi.fn(async () => {}), greet: vi.fn(async () => {}), reject: vi.fn(async () => {}) });
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r)); };

class FakeSocket implements SidebandSocket {
  private readonly opens: (() => void)[] = [];
  private readonly listeners: ((event: Record<string, unknown>) => void)[] = [];
  private readonly closes: (() => void)[] = [];
  readonly sent: Record<string, unknown>[] = [];
  ended = false;
  onOpen(fn: () => void) { this.opens.push(fn); }
  onEvent(fn: (event: Record<string, unknown>) => void) { this.listeners.push(fn); }
  onClose(fn: () => void) { this.closes.push(fn); }
  send(event: Record<string, unknown>) { this.sent.push(event); }
  close() { this.end(); }
  open() { for (const fn of this.opens) fn(); }
  emit(event: Record<string, unknown>) { for (const fn of this.listeners) fn(event); }
  end() {
    if (this.ended) return;
    this.ended = true;
    for (const fn of this.closes) fn();
  }
}

/** Each connect follows the plan: "open" attaches and stays open; anything after the plan fails to attach. */
function sidebands(plan: "open"[] = ["open"]) {
  const sockets: FakeSocket[] = [];
  const connect = vi.fn((_callId: string) => {
    const socket = new FakeSocket();
    const attaches = plan[sockets.length] === "open";
    sockets.push(socket);
    queueMicrotask(() => (attaches ? socket.open() : socket.end()));
    return socket;
  });
  return { connect, sockets };
}

async function placed() {
  const rig = testRig(env);
  const dial = vi.fn<typeof dialTwilio>().mockResolvedValue(sid);
  rig.deps.dial = dial;
  const session = await openTestSession(rig);
  rig.openai.script("responses.create", ok(intent));
  const turn = await callRoute(rig, turnRoute, typedTurn(session.stamp, 1, text));
  return { rig, session, turn, dialId: dial.mock.calls[0]![2] };
}

async function answered(callId = "rtc_listen") {
  const call = await placed();
  await answerPhoneCall(call.rig.deps, { call_id: callId, sip_headers: [{ name: "x-franki-call", value: call.dialId }] }, sip(), async () => uid);
  const binding: ListenBinding = { uid, dialId: call.dialId, callId };
  return { ...call, callId, binding };
}

async function savedReport(rig: TestRig, dialId: string) {
  const slot = await rig.store.get<{ payload: { report: unknown } }>(uid, reportPath(uid, dialId, rig.deps.hasher));
  return slot?.data.payload.report ?? null;
}

const modelCalls = (rig: TestRig) => rig.openai.requestsTo("responses.create").length;
const recipient = (item: string, transcript: string) => ({ type: "conversation.item.input_audio_transcription.completed", item_id: item, content_index: 0, transcript });
const franki = (item: string, transcript: string) => ({ type: "response.output_audio_transcript.done", item_id: item, transcript });
const added = (item: string) => ({ type: "conversation.item.added", item: { id: item } });

afterEach(() => { vi.useRealTimers(); });

describe("the phone call listener", () => {
  it("sums up both sides of the call on the background model and saves that as the report", async () => {
    const { rig, binding, dialId } = await answered();
    const { connect, sockets } = sidebands();
    const report = { outcome: "answered", summary: "They open at nine tomorrow." };
    rig.openai.script("responses.create", ok(completed(JSON.stringify(report))));
    const job = listenToPhoneCall(rig.deps, binding, connect);
    await flush();
    const call = sockets[0]!;
    call.emit(added("a1"));
    call.emit(added("u1"));
    // The recipient's words finish transcribing before Franki's question does; the items keep their order.
    call.emit(recipient("u1", "  We open at nine\ntomorrow. "));
    call.emit(franki("a1", "Hi, I'm Franki, an AI assistant. When do you open?"));
    call.end();
    const { value } = await settle(job, rig.clock, rig.timers);
    expect(value).toBe("saved");
    // The sideband closed, and attaching again failed: the call was over.
    expect(connect).toHaveBeenCalledTimes(2);
    const body = rig.openai.requestsTo("responses.create").at(-1)!.body as { model: string; store: boolean; input: string; text: unknown };
    expect(body).toMatchObject({ model: "test-bg-model", store: false, text: { format: { type: "json_schema", strict: true } } });
    expect(JSON.parse(body.input)).toEqual({ request: text, transcript: [
      { speaker: "franki", text: "Hi, I'm Franki, an AI assistant. When do you open?" },
      { speaker: "recipient", text: "We open at nine tomorrow." },
    ] });
    expect(await savedReport(rig, dialId)).toEqual(report);
  });

  it("never overwrites, or pays to replace, a report the specialist already filed", async () => {
    const { rig, binding, dialId, callId } = await answered();
    const tool = reportTool(rig.deps, uid, dialId, callId, origin)!;
    const filed = { outcome: "voicemail", summary: "Left a message asking for the opening hours." };
    const response = await phoneReportEndpoint(new Request(tool.server_url, { method: "POST", headers: { authorization: tool.headers.Authorization },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "report_call_outcome", arguments: filed } }) }), rig.deps);
    expect(await response.json()).toMatchObject({ result: { isError: false } });
    const before = modelCalls(rig);
    const { connect, sockets } = sidebands();
    const job = listenToPhoneCall(rig.deps, binding, connect);
    await flush();
    sockets[0]!.emit(recipient("u1", "Leave a message after the tone."));
    sockets[0]!.end();
    expect((await settle(job, rig.clock, rig.timers)).value).toBe("reported");
    expect(modelCalls(rig)).toBe(before);
    expect(await savedReport(rig, dialId)).toEqual(filed);
  });

  it("waits briefly for a report the specialist started just as the call ended", async () => {
    const { rig, binding, dialId, callId } = await answered();
    const before = modelCalls(rig);
    const { connect, sockets } = sidebands();
    const job = listenToPhoneCall(rig.deps, binding, connect);
    await flush();
    sockets[0]!.emit(recipient("u1", "We open at ten."));
    sockets[0]!.emit({ type: "response.output_item.added", item: { type: "mcp_call", name: "report_call_outcome", id: "m1" } });
    sockets[0]!.end();
    for (let i = 0; i < 2; i++) {
      rig.timers.fireNext();
      await flush();
    }
    const tool = reportTool(rig.deps, uid, dialId, callId, origin)!;
    const filed = { outcome: "answered", summary: "They open at ten." };
    await phoneReportEndpoint(new Request(tool.server_url, { method: "POST", headers: { authorization: tool.headers.Authorization },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "report_call_outcome", arguments: filed } }) }), rig.deps);
    expect((await settle(job, rig.clock, rig.timers)).value).toBe("reported");
    expect(modelCalls(rig)).toBe(before);
    expect(await savedReport(rig, dialId)).toEqual(filed);
  });

  it("files an inconclusive report with no model call when the recipient said nothing", async () => {
    const { rig, binding, dialId } = await answered();
    const before = modelCalls(rig);
    const { connect, sockets } = sidebands();
    const job = listenToPhoneCall(rig.deps, binding, connect);
    await flush();
    sockets[0]!.emit(franki("a1", "Hi, I'm Franki, an AI assistant calling about your hours."));
    sockets[0]!.end();
    expect((await settle(job, rig.clock, rig.timers)).value).toBe("saved");
    expect(modelCalls(rig)).toBe(before);
    expect(await savedReport(rig, dialId)).toEqual({ outcome: "inconclusive", summary: NO_WORDS_SUMMARY });
  });

  it("ends with the carrier, and lands its report before the 15 s grace when the model is slow", async () => {
    const { rig, binding, dialId, session, turn } = await answered();
    rig.openai.script("responses.create", never());
    const { connect, sockets } = sidebands();
    const job = listenToPhoneCall(rig.deps, binding, connect);
    await flush();
    sockets[0]!.emit(recipient("u1", "We close at six today."));
    await saveCarrierEvent(rig.deps, uid, { dialId, sid, status: "completed" });
    const hungUpAt = rig.clock.read().opsClock.now;
    expect((await settle(job, rig.clock, rig.timers)).value).toBe("saved");
    expect(rig.clock.read().opsClock.now - hungUpAt).toBeLessThan(PHONE_REPORT_GRACE_MS);
    expect(sockets[0]!.ended).toBe(true);
    const report = await savedReport(rig, dialId);
    expect(report).toMatchObject({ outcome: "inconclusive", summary: expect.stringContaining("We close at six today.") });
    // The owner's next read finds the report, not "no confirmed outcome".
    await patchRecord(rig.store, uid, paths.session(uid, session.sessionId), { audience: "private" });
    await rig.store.transaction(uid, async (tx) => {
      const current = (await tx.get<Session>(paths.session(uid, session.sessionId)))!.data;
      expect(await readPhoneResult(tx, rig.deps, uid, session.sessionId, current, turn.body.stamp.epoch)).toEqual({ completion: "reported", report });
    });
  });

  it("asks the phone model to wrap up, then hangs up before Cloud Run's request timeout", async () => {
    const { rig, binding, dialId, callId } = await answered();
    rig.openai.script("realtime.calls.hangup", ok(null));
    const { connect, sockets } = sidebands();
    const { value, elapsedMs } = await settle(listenToPhoneCall(rig.deps, binding, connect), rig.clock, rig.timers);
    expect(value).toBe("saved");
    expect(elapsedMs).toBeGreaterThanOrEqual(PHONE_HANG_UP_MS);
    expect(elapsedMs).toBeLessThan(290_000);
    expect(sockets[0]!.sent).toEqual([
      { type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: WRAP_UP_LINE }] } },
      { type: "response.create" },
    ]);
    expect(PHONE_WRAP_UP_MS).toBeLessThan(PHONE_HANG_UP_MS);
    expect(rig.openai.requestsTo("realtime.calls.hangup").map((r) => r.body)).toEqual([{ callId }]);
    expect(await savedReport(rig, dialId)).toEqual({ outcome: "inconclusive", summary: NO_WORDS_SUMMARY });
  });

  it("waits for the carrier when it can never attach, so a live call's own report isn't blocked", async () => {
    const { rig, binding, dialId } = await answered();
    const { connect } = sidebands([]);
    const job = listenToPhoneCall(rig.deps, binding, connect);
    for (let i = 0; i < 12; i++) {
      rig.timers.fireNext();
      await flush();
    }
    expect(connect).toHaveBeenCalledTimes(4);
    expect(await savedReport(rig, dialId)).toBeNull();
    await saveCarrierEvent(rig.deps, uid, { dialId, sid, status: "completed" });
    expect((await settle(job, rig.clock, rig.timers)).value).toBe("saved");
    expect(await savedReport(rig, dialId)).toEqual({ outcome: "inconclusive", summary: NO_WORDS_SUMMARY });
  });

  it("listens only to the SIP leg bound to an accepted dial", async () => {
    const { rig, binding } = await answered();
    const { connect } = sidebands();
    expect(await listenToPhoneCall(rig.deps, { ...binding, callId: "rtc_other" }, connect)).toBe("unbound");
    const unanswered = await placed();
    expect(await listenToPhoneCall(unanswered.rig.deps, { uid, dialId: unanswered.dialId, callId: "rtc_listen" }, connect)).toBe("unbound");
    expect(connect).not.toHaveBeenCalled();
  });

  it("falls back to the recipient's own words when the model's answer can't be used", async () => {
    const rig = testRig(env);
    rig.openai.script("responses.create", ok(completed(JSON.stringify({ outcome: "confirmed", summary: "Booked." }))));
    const lines = [{ speaker: "recipient" as const, text: "We might have a table at eight." }];
    expect(await summarizePhoneCall(rig.deps, text, lines)).toEqual({ outcome: "inconclusive", summary: expect.stringContaining("We might have a table at eight.") });
    rig.openai.script("responses.create", ok(completed(JSON.stringify({ outcome: "answered", summary: "x".repeat(900) }))));
    expect((await summarizePhoneCall(rig.deps, text, lines)).summary).toHaveLength(400);
    // No time left before the grace ends: no model call at all.
    const before = modelCalls(rig);
    expect((await summarizePhoneCall(rig.deps, text, lines, 500)).outcome).toBe("inconclusive");
    expect(modelCalls(rig)).toBe(before);
    expect(PHONE_SUMMARY_DEADLINE_MS).toBeLessThan(PHONE_REPORT_GRACE_MS);
  });
});

describe("the listen route", () => {
  it("opens only for a fresh capability this server minted, once per call, and streams until the report is in", async () => {
    const { rig, binding, dialId, callId } = await answered();
    const { connect, sockets } = sidebands();
    const post = (headers: Record<string, string>) => phoneListenEndpoint(new Request(origin + "/api/phone/listen", { method: "POST", headers }), rig.deps, connect);
    const target = listenRequest(rig.deps, binding, origin)!;
    expect(target.url).toBe(origin + "/api/phone/listen");
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: target.authorization, origin })).status).toBe(403);
    const forged = target.authorization.slice(0, -1) + (target.authorization.endsWith("A") ? "B" : "A");
    expect((await post({ authorization: forged })).status).toBe(401);
    // The report capability OpenAI holds can't start a listener.
    expect((await post({ authorization: reportTool(rig.deps, uid, dialId, callId, origin)!.headers.Authorization })).status).toBe(401);
    expect(connect).not.toHaveBeenCalled();

    const res = await post({ authorization: target.authorization });
    expect(res.status).toBe(202);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await post({ authorization: target.authorization })).status).toBe(409);
    await flush();
    sockets[0]!.end();
    expect((await settle(res.text(), rig.clock, rig.timers)).value).toMatch(/^listening\n/);
    expect(rig.logs).toContainEqual({ event: "phone.listenEnded", fields: { outcome: "saved" } });
    rig.clock.advance(60_001);
    expect((await post({ authorization: target.authorization })).status).toBe(401);
  });

  it("is started by the webhook, which waits for the listener's answer but never for the call", async () => {
    const { rig, binding } = await answered();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("listening\n", { status: 202 }));
    await startPhoneListener(rig.deps, binding, "https://ignored.test", fetcher);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(origin + "/api/phone/listen");
    expect(init).toMatchObject({ method: "POST", headers: { authorization: expect.stringMatching(/^Bearer [\w-]+\.[\w-]{43}$/) } });

    const slow = vi.fn<typeof fetch>().mockReturnValue(new Promise<Response>(() => {}));
    const { elapsedMs } = await settle(startPhoneListener(rig.deps, binding, origin, slow), rig.clock, rig.timers);
    expect(elapsedMs).toBe(LISTEN_START_MS);
    expect(rig.logs.map((l) => l.event)).toContain("phone.listenStartUnconfirmed");

    const bare = testRig(TEST_ENV);
    const unused = vi.fn<typeof fetch>();
    await startPhoneListener(bare.deps, binding, "https://evil.test", unused);
    expect(unused).not.toHaveBeenCalled();
    expect(bare.logs.map((l) => l.event)).toEqual(["phone.listenOriginUnavailable"]);
  });
});

describe("the phone-side specialist", () => {
  it("reports once the answer is read back, calls itself an assistant, admits being an AI when asked, and transcribes the recipient", () => {
    const assignment = "Call 415 555 0123 and ask when they open.";
    const lines = phoneCallInstructions(assignment, true);
    expect(lines).not.toContain("Introduce yourself as an AI assistant");
    expect(lines).toContain("Call yourself an assistant and don't bring up being an AI.");
    expect(lines).toContain("Never claim to be a person");
    expect(lines).toContain("say plainly that you're an AI assistant");
    expect(lines).toContain("never read it out");
    expect(lines).toContain("say it back once");
    expect(lines).toContain("call report_call_outcome before you say anything else");
    expect(lines).toContain("Call it once");
    expect(lines).toContain("calling on someone's behalf");
    expect(lines).not.toContain("It is now");
    expect(lines.endsWith(JSON.stringify(assignment))).toBe(true);
    expect(phoneCallInstructions(assignment, false)).not.toContain("report_call_outcome");
    const named = phoneCallInstructions(assignment, true, { name: "Matt", localTime: "Thursday, November 26, 2026 at 3:42 PM (America/Chicago)" });
    expect(named).toContain("\"Hi, this is Franki, Matt's assistant.\"");
    expect(named).toContain("who you're calling for, and your question");
    expect(named).toContain("It is now Thursday, November 26, 2026 at 3:42 PM (America/Chicago) where the user is.");
    expect(named).not.toContain("calling on someone's behalf");
    expect(named.endsWith(JSON.stringify(assignment))).toBe(true);
    const timeOnly = phoneCallInstructions(assignment, true, { name: null, localTime: "Thursday" });
    expect(timeOnly).toContain("calling on someone's behalf");
    expect(timeOnly).toContain("It is now Thursday where the user is.");
    expect(phoneCallSession(env).audio).toEqual({ output: { voice: "cedar" }, input: { transcription: { model: "test-transcribe-model" } } });
    const { FRANKI_TRANSCRIBE_MODEL: _unset, ...untranscribed } = env;
    expect(phoneCallSession(untranscribed).audio).toEqual({ output: { voice: "cedar" } });
  });
});

describe("a pickup Franki never joined", () => {
  it("reports what is known once the carrier says the answered call ended", async () => {
    const { rig, dialId, session, turn } = await placed();
    expect(await reportUnconnectedCall(rig.deps, uid, dialId)).toBe(false);
    await saveCarrierEvent(rig.deps, uid, { dialId, sid, status: "completed" });
    expect(await reportUnconnectedCall(rig.deps, uid, dialId)).toBe(true);
    expect(await reportUnconnectedCall(rig.deps, uid, dialId)).toBe(true);
    const report = { outcome: "inconclusive", summary: UNCONNECTED_SUMMARY };
    expect(await savedReport(rig, dialId)).toEqual(report);
    await patchRecord(rig.store, uid, paths.session(uid, session.sessionId), { audience: "private" });
    await rig.store.transaction(uid, async (tx) => {
      const current = (await tx.get<Session>(paths.session(uid, session.sessionId)))!.data;
      expect(await readPhoneResult(tx, rig.deps, uid, session.sessionId, current, turn.body.stamp.epoch)).toEqual({ completion: "reported", report });
    });
  });

  it("leaves a call Franki answered to its listener", async () => {
    const { rig, dialId } = await answered();
    await saveCarrierEvent(rig.deps, uid, { dialId, sid, status: "completed" });
    expect(await reportUnconnectedCall(rig.deps, uid, dialId)).toBe(false);
    expect(await savedReport(rig, dialId)).toBeNull();
  });
});
