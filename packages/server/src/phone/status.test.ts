import { PHONE_STATUSES, type Stamp } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it, vi } from "vitest";
import { ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import { turnRoute } from "../routes/turn";
import { TEST_ENV, callRoute, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { phoneId } from "./outbound";
import { type CallStatus, phoneStatusOf, phoneStatusRouteWith } from "./status";
import { DialRejected, type dialTwilio } from "./twilio";

const env = { ...TEST_ENV, TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32),
  TWILIO_AUTH_TOKEN: "test-token", TWILIO_PHONE_NUMBER: "+14155550100", OPENAI_PROJECT_ID: "proj_test",
  OPENAI_WEBHOOK_SECRET: "test-secret" };
const sid = "CA" + "a".repeat(32);
const intent = normalizeResponse({ status: "completed", output: [
  { type: "function_call", status: "completed", name: "make_phone_call", arguments: "{}" },
] });

async function placed(dialResult: "ok" | "rejected" | "unconfirmed" = "ok") {
  const rig = testRig(env);
  const dial = vi.fn<typeof dialTwilio>();
  if (dialResult === "ok") dial.mockResolvedValue(sid);
  else dial.mockRejectedValue(dialResult === "rejected" ? new DialRejected() : new Error("connection reset"));
  rig.deps.dial = dial;
  const session = await openTestSession(rig);
  rig.openai.script("responses.create", ok(intent));
  const turn = await callRoute(rig, turnRoute, typedTurn(session.stamp, 1, "Call +1 (415) 555-0123 and ask when the shop opens."));
  expect(turn.status).toBe(200);
  return { rig, stamp: turn.body.stamp as Stamp };
}

function get(rig: ReturnType<typeof testRig>, callStatus: CallStatus, query: Record<string, string>, token?: string | null) {
  const url = `http://localhost:3000/api/phone/status?${new URLSearchParams(query).toString()}`;
  return callRoute(rig, phoneStatusRouteWith(callStatus), undefined, { method: "GET", url, origin: null, ...(token === undefined ? {} : { token }) });
}

const of = (stamp: Stamp) => ({ sessionId: stamp.sessionId, turnId: stamp.turnId });

describe("GET /api/phone/status", () => {
  it("maps every Twilio status, and calls an answered phone talking only once Franki's leg was accepted", () => {
    expect(phoneStatusOf("queued", false)).toBe("dialing");
    expect(phoneStatusOf("initiated", false)).toBe("dialing");
    expect(phoneStatusOf("ringing", false)).toBe("ringing");
    expect(phoneStatusOf("in-progress", false)).toBe("ringing");
    expect(phoneStatusOf("in-progress", true)).toBe("talking");
    expect(phoneStatusOf("completed", true)).toBe("ended");
    expect(phoneStatusOf("busy", false)).toBe("busy");
    expect(phoneStatusOf("no-answer", false)).toBe("noAnswer");
    expect(phoneStatusOf("failed", false)).toBe("failed");
    expect(phoneStatusOf("canceled", false)).toBe("failed");
    expect(phoneStatusOf("something-new", true)).toBe("unknown");
    for (const s of ["queued", "ringing", "in-progress", "completed", "busy", "no-answer", "failed", "x"]) {
      expect(PHONE_STATUSES).toContain(phoneStatusOf(s, true));
    }
  });

  it("reads the call this turn placed, by the same ledger ID the dial claimed", async () => {
    const { rig, stamp } = await placed();
    const callStatus = vi.fn<CallStatus>().mockResolvedValue("ringing");
    const res = await get(rig, callStatus, of(stamp));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ringing" });
    expect(callStatus).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ account: env.TWILIO_ACCOUNT_SID }), sid);
    // The row the route read is the one placePhoneCall wrote.
    const id = phoneId({ uid: "owner-1", deps: rig.deps } as Parameters<typeof phoneId>[0], stamp);
    expect(await rig.deps.store.get("owner-1", `users/owner-1/ledger/${id}`)).not.toBeNull();
  });

  it("answers none for a turn that placed no call, without asking Twilio", async () => {
    const { rig, stamp } = await placed();
    const callStatus = vi.fn<CallStatus>();
    expect((await get(rig, callStatus, { sessionId: stamp.sessionId, turnId: testId("another-turn") })).body).toEqual({ status: "none" });
    expect(callStatus).not.toHaveBeenCalled();
  });

  it("never reads another user's call", async () => {
    const { rig, stamp } = await placed();
    const callStatus = vi.fn<CallStatus>().mockResolvedValue("in-progress");
    const res = await get(rig, callStatus, of(stamp), "token:owner-2");
    expect(res.body).toEqual({ status: "none" });
    expect(callStatus).not.toHaveBeenCalled();
  });

  it("reports a declined dial as failed and an unconfirmed one as unknown, without asking Twilio", async () => {
    const callStatus = vi.fn<CallStatus>();
    const declined = await placed("rejected");
    expect((await get(declined.rig, callStatus, of(declined.stamp))).body).toEqual({ status: "failed" });
    const unconfirmed = await placed("unconfirmed");
    expect((await get(unconfirmed.rig, callStatus, of(unconfirmed.stamp))).body).toEqual({ status: "unknown" });
    expect(callStatus).not.toHaveBeenCalled();
  });

  it("answers unknown when Twilio can't be read", async () => {
    const { rig, stamp } = await placed();
    expect((await get(rig, vi.fn<CallStatus>().mockRejectedValue(new Error("timeout")), of(stamp))).body).toEqual({ status: "unknown" });
  });

  it("refuses a malformed or extra parameter, and a signed-out request", async () => {
    const { rig, stamp } = await placed();
    const callStatus = vi.fn<CallStatus>();
    expect((await get(rig, callStatus, { sessionId: stamp.sessionId })).status).toBe(400);
    expect((await get(rig, callStatus, { ...of(stamp), turnId: "../x" })).status).toBe(400);
    expect((await get(rig, callStatus, { ...of(stamp), extra: "1" })).status).toBe(400);
    expect((await get(rig, callStatus, of(stamp), null)).status).toBe(401);
  });
});
