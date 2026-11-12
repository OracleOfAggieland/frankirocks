import type { Stamp } from "@franki/core";
import { describe, expect, it, vi } from "vitest";
import { ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import { turnRoute } from "../routes/turn";
import { TEST_ENV, callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { PHONE_AWARE_ENDED_MS, PHONE_AWARE_LIVE_MS, phoneCallLine } from "./aware";
import type { dialTwilio } from "./twilio";

const env = { ...TEST_ENV, TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32),
  TWILIO_AUTH_TOKEN: "test-token", TWILIO_PHONE_NUMBER: "+14155550100", OPENAI_PROJECT_ID: "proj_test",
  OPENAI_WEBHOOK_SECRET: "test-secret" };
const intent = normalizeResponse({ status: "completed", output: [
  { type: "function_call", status: "completed", name: "make_phone_call", arguments: "{}" },
] });
const words = (text: string) => normalizeResponse({ status: "completed", output_text: text });

async function placed(twilio: string) {
  const rig = testRig(env);
  rig.deps.dial = vi.fn<typeof dialTwilio>().mockResolvedValue("CA" + "a".repeat(32));
  rig.deps.callStatus = async () => twilio;
  const session = await openTestSession(rig);
  rig.openai.script("responses.create", ok(intent));
  // No country code: a ten-digit US number dials as +1.
  const turn = await callRoute(rig, turnRoute, typedTurn(session.stamp, 1, "Call 415 555 0123 and ask when the shop opens."));
  expect(turn.status).toBe(200);
  expect(vi.mocked(rig.deps.dial).mock.calls[0]![1]).toBe("+14155550123");
  return { rig, stamp: turn.body.stamp as Stamp };
}
const ctx = (rig: ReturnType<typeof testRig>) => ({ uid: "owner-1", deps: rig.deps, schedule: rig.sched.schedule });

describe("phone call awareness", () => {
  it("tells a typed reply where the call stands", async () => {
    const { rig, stamp } = await placed("ringing");
    rig.openai.script("responses.create", ok(words("It's ringing.")));
    const res = await callRoute(rig, turnRoute, typedTurn(stamp, 2, "How is the call going?"));
    expect(res.status).toBe(200);
    const body = rig.openai.requestsTo("responses.create").at(-1)!.body as { instructions: string };
    expect(body.instructions).toContain("Phone call status");
    expect(body.instructions).toContain("is ringing");
    // The typed reply is the only note shown; the status line itself is never shown as text.
    expect(res.body.notes.map((n: { text: string }) => n.text)).toEqual(["It's ringing."]);
  });

  it("gives a spoken reply the status as a note", async () => {
    const { rig, stamp } = await placed("in-progress");
    const res = await callRoute(rig, turnRoute, asrTurn(stamp, 2, "Did they pick up?", [{ itemId: "item2", commitSeq: 1 }]));
    expect(res.status).toBe(200);
    // Franki's SIP leg was never accepted here, so an answered phone still reads as ringing.
    expect(res.body.notes.some((n: { text: string }) => n.text.includes("Phone call status") && n.text.includes("is ringing"))).toBe(true);
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
});
