import { createHmac } from "node:crypto";
import { testId } from "@franki/core/testing";
import { describe, expect, it, vi } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { TEST_ENV, callRoute, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { receiveTwilioStatus, saveCarrierEvent } from "./callback";
import { carrierOf } from "./lifecycle";
import { type PhoneEntry, queued } from "./outbound";
import { type Dial, callbackOrigin, callbackUrl } from "./twilio";

const env = { ...TEST_ENV, TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "test-token",
  TWILIO_PHONE_NUMBER: "+14155550100", OPENAI_PROJECT_ID: "proj_test", OPENAI_WEBHOOK_SECRET: "test-secret",
  FRANKI_PHONE_REPORT_ORIGIN: "https://test.example" };
const sid = "CA" + "a".repeat(32);
const dialId = testId("dial-event");
const url = callbackUrl(env.FRANKI_PHONE_REPORT_ORIGIN, dialId);
const fields = { CallStatus: "completed", CallSid: sid, AccountSid: env.TWILIO_ACCOUNT_SID, SequenceNumber: "3", FutureField: "+1 test" };

const signature = (url: string, params: Record<string, string>) => createHmac("sha1", env.TWILIO_AUTH_TOKEN)
  .update(Object.keys(params).sort().reduce((data, key) => data + key + params[key], url)).digest("base64");
function post(body: Record<string, string>, urlToSign = url, requestUrl = urlToSign, signed = signature(urlToSign, body)) {
  return new Request(requestUrl, { method: "POST", headers: { "x-twilio-signature": signed }, body: new URLSearchParams(body) });
}

describe("Twilio carrier callbacks", () => {
  it("validates the registered public URL and all form fields even behind a proxy", async () => {
    const save = vi.fn(async () => {});
    const internal = url.replace(env.FRANKI_PHONE_REPORT_ORIGIN, "http://internal");
    expect((await receiveTwilioStatus(post(fields, url, internal), env, save)).status).toBe(204);
    expect(save).toHaveBeenCalledExactlyOnceWith({ dialId, sid, status: "completed" });
    save.mockClear();
    const forged = signature(url, fields);
    expect((await receiveTwilioStatus(post({ ...fields, FutureField: "changed" }, url, url, forged), env, save)).status).toBe(403);
    expect((await receiveTwilioStatus(post(fields, internal, internal), env, save)).status).toBe(403);
    expect((await receiveTwilioStatus(post(fields, url, callbackUrl(env.FRANKI_PHONE_REPORT_ORIGIN, testId("different"))), env, save)).status).toBe(403);
    expect((await receiveTwilioStatus(post({ ...fields, AccountSid: "AC" + "f".repeat(32) }), env, save)).status).toBe(403);
    expect((await receiveTwilioStatus(post({ ...fields, CallStatus: "nonsense" }), env, save)).status).toBe(400);
    expect((await receiveTwilioStatus(post({ ...fields, CallSid: "not-a-sid" }), env, save)).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("returns a retryable failure when a verified event cannot be persisted", async () => {
    const write = vi.fn().mockRejectedValue(new Error("temporarily unavailable"));
    expect((await receiveTwilioStatus(post(fields), env, write)).status).toBe(503);
    expect(write).toHaveBeenCalledOnce();
  });

  it("requires an explicit or trusted HTTPS origin before dialing", () => {
    const local = { ...env, FRANKI_PHONE_REPORT_ORIGIN: undefined };
    expect(() => callbackOrigin(local, "http://localhost:3000")).toThrow("FRANKI_PHONE_REPORT_ORIGIN");
    expect(() => callbackOrigin(local, "https://other.example")).toThrow("FRANKI_PHONE_REPORT_ORIGIN");
    expect(() => callbackOrigin({ ...env, FRANKI_PHONE_REPORT_ORIGIN: "https://user@other.example" })).toThrow("FRANKI_PHONE_REPORT_ORIGIN");
    expect(callbackOrigin(local, "https://frankirocks.com")).toBe("https://frankirocks.com");
    expect(callbackOrigin(env, "http://localhost:3000")).toBe(env.FRANKI_PHONE_REPORT_ORIGIN);
  });

  it.each(["before", "after"])("recovers the parent call SID on a callback %s a lost dial response", async (order) => {
    const rig = testRig(env);
    const uid = "owner-1";
    const save = (event: Parameters<typeof saveCarrierEvent>[2]) => saveCarrierEvent(rig.deps, uid, event);
    const dispatch = (id: string, form = fields) => receiveTwilioStatus(post(form, callbackUrl(env.FRANKI_PHONE_REPORT_ORIGIN, id)), env, save);
    const dial = vi.fn<Dial>(async (_config, _to, id) => {
      if (order === "before") expect((await dispatch(id)).status).toBe(204);
      throw new Error("Twilio submission response lost");
    });
    rig.deps.dial = dial;
    const session = await openTestSession(rig);
    rig.openai.script("responses.create", ok({ ...completed(""), phoneCallRequested: true }));
    const req = typedTurn(session.stamp, 1, "Call 415 555 0123 and ask what time they close.");
    const res = await callRoute(rig, turnRoute, req);
    const id = dial.mock.calls[0]![2];
    if (order === "before") expect(res.body.notes[0].text).toBe(queued);
    else expect((await dispatch(id)).status).toBe(204);
    const path = paths.ledger(uid, id);
    const row = (await rig.store.get<PhoneEntry>(uid, path))!;
    expect(row.data).toMatchObject({ state: "complete", payload: { twilioSid: sid } });
    expect(carrierOf(row.data)?.status).toBe("completed");
    rig.clock.advance(1000);
    for (const form of [fields, { ...fields, CallStatus: "ringing" }, { ...fields, CallStatus: "busy", CallSid: "CA" + "b".repeat(32) }]) {
      expect((await dispatch(id, form)).status).toBe(204);
    }
    expect(await rig.store.get<PhoneEntry>(uid, path)).toEqual(row);
    await callRoute(rig, turnRoute, req);
    expect(dial).toHaveBeenCalledOnce();
  });
});
