import type { CarrierStatus, Stamp } from "@franki/core";
import { describe, expect, it, vi } from "vitest";
import { ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import { turnRoute } from "../routes/turn";
import { TEST_ENV, callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { PHONE_AWARE_ENDED_MS, PHONE_AWARE_LIVE_MS, phoneCallLine } from "./aware";
import { saveCarrierEvent } from "./callback";
import { phoneId } from "./outbound";
import type { dialTwilio } from "./twilio";

const env = { ...TEST_ENV, TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32),
  TWILIO_AUTH_TOKEN: "test-token", TWILIO_PHONE_NUMBER: "+14155550100", OPENAI_PROJECT_ID: "proj_test",
  OPENAI_WEBHOOK_SECRET: "test-secret", FRANKI_PHONE_REPORT_ORIGIN: "https://frankirocks.com" };
const intent = normalizeResponse({ status: "completed", output: [
  { type: "function_call", status: "completed", name: "make_phone_call", arguments: "{}" },
] });
const words = (text: string) => normalizeResponse({ status: "completed", output_text: text });

async function placed(status: CarrierStatus) {
  const rig = testRig(env);
  const sid = "CA" + "a".repeat(32);
  rig.deps.dial = vi.fn<typeof dialTwilio>().mockResolvedValue(sid);
  const callStatus = vi.fn().mockResolvedValue("failed");
  rig.deps.callStatus = callStatus;
  const session = await openTestSession(rig);
  rig.openai.script("responses.create", ok(intent));
  // No country code: a ten-digit US number dials as +1.
  const turn = await callRoute(rig, turnRoute, typedTurn(session.stamp, 1, "Call 415 555 0123 and ask when the shop opens."));
  expect(turn.status).toBe(200);
  const [, to, dialId] = vi.mocked(rig.deps.dial).mock.calls[0]!;
  expect(to).toBe("+14155550123");
  await saveCarrierEvent(rig.deps, "owner-1", { dialId, sid, status });
  return { rig, callStatus, stamp: turn.body.stamp as Stamp };
}
const ctx = (rig: ReturnType<typeof testRig>) => ({ uid: "owner-1", deps: rig.deps, schedule: rig.sched.schedule });

describe("phone call awareness", () => {
  it("tells a typed reply where the call stands", async () => {
    const { rig, stamp, callStatus } = await placed("ringing");
    rig.openai.script("responses.create", ok(words("It's ringing.")));
    const res = await callRoute(rig, turnRoute, typedTurn(stamp, 2, "How is the call going?"));
    expect(res.status).toBe(200);
    const body = rig.openai.requestsTo("responses.create").at(-1)!.body as { instructions: string };
    expect(body.instructions).toContain("Phone call status");
    expect(body.instructions).toContain("is ringing");
    expect(callStatus).not.toHaveBeenCalled();
    // The typed reply is the only note shown; the status line itself is never shown as text.
    expect(res.body.notes.map((n: { text: string }) => n.text)).toEqual(["It's ringing."]);
  });

  it("gives a spoken reply the status as a note", async () => {
    const { rig, stamp, callStatus } = await placed("in-progress");
    const res = await callRoute(rig, turnRoute, asrTurn(stamp, 2, "Did they pick up?", [{ itemId: "item2", commitSeq: 1 }]));
    expect(res.status).toBe(200);
    // Franki's SIP leg was never accepted here, so an answered phone still reads as ringing.
    expect(res.body.notes.some((n: { text: string }) => n.text.includes("Phone call status") && n.text.includes("is ringing"))).toBe(true);
    expect(callStatus).not.toHaveBeenCalled();
  });

  it("stops mentioning an ended call after its window, and any call after the live window", async () => {
    const ended = await placed("completed");
    expect(await phoneCallLine(ctx(ended.rig))).toContain("has now ended");
    ended.rig.clock.advance(PHONE_AWARE_ENDED_MS + 60_000);
    expect(await phoneCallLine(ctx(ended.rig))).toBeNull();
    const live = await placed("ringing");
    live.rig.clock.advance(PHONE_AWARE_LIVE_MS + 60_000);
    expect(await phoneCallLine(ctx(live.rig))).toBeNull();
  });

  it("can answer about a call that just ended after a long conversation", async () => {
    const { rig, stamp } = await placed("in-progress");
    rig.clock.advance(PHONE_AWARE_LIVE_MS + 60_000);
    const dialId = phoneId(ctx(rig), stamp);
    await saveCarrierEvent(rig.deps, "owner-1", { dialId, sid: "CA" + "a".repeat(32), status: "completed" });
    expect(await phoneCallLine(ctx(rig), stamp.sessionId)).toContain("has now ended");
  });
});
