import { type Session, SdpResponse, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fail, never, ok } from "../openai/fake";
import { callIdFromLocation } from "../openai/realtime-calls";
import { paths } from "../store/paths";
import { callRoute, patchRecord, runScheduled, testRig } from "../testing/fakes";
import { openTestSession } from "../testing/session-fixtures";
import { sdpRoute } from "./sdp";

const UID = "owner-1";
const ANSWER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";
const created = (callId: string | null) => ok({ answerSdp: ANSWER, location: callId === null ? null : `/v1/realtime/calls/${callId}` });

async function setup() {
  const rig = testRig();
  const s = await openTestSession(rig);
  let n = 0;
  const sdp = (overrides: Record<string, unknown> = {}) =>
    callRoute(rig, sdpRoute, { requestId: testId(`sdp${++n}`), sessionId: s.sessionId, generation: 1, offerSdp: "v=0 offer", ...overrides });
  const session = async () => (await rig.store.get<Session>(UID, paths.session(UID, s.sessionId)))!.data;
  return { rig, s, sdp, session };
}

describe("POST /api/session/sdp", () => {
  it("call ID persisted before answer: posts FRANKI_VOICE_MODEL, stores the call ID, then returns the answer", async () => {
    const { rig, s, sdp, session } = await setup();
    rig.openai.script("realtime.calls.create", created("rtc_abc123"));
    // Record whether the call ID was committed when the route's result came back.
    let committedAtReturn = false;
    const res = await sdp().then(async (r) => {
      committedAtReturn = (await session()).registeredCallIds.includes("rtc_abc123");
      return r;
    });
    const stored = await session();
    expect(committedAtReturn).toBe(true);
    expect(res.status).toBe(200);
    expect(validate(SdpResponse, res.body).ok).toBe(true);
    expect(res.body).toEqual({ answerSdp: ANSWER, sessionId: s.sessionId, generation: 1 });
    expect(stored).toMatchObject({ callId: "rtc_abc123", registeredCallIds: ["rtc_abc123"] });
    const [req] = rig.openai.requestsTo("realtime.calls.create");
    expect(req!.body).toEqual({
      offerSdp: "v=0 offer",
      session: { type: "realtime", model: "test-voice-model", tracing: null, audio: { output: { voice: "cedar" } } },
    });
    expect(res.elapsedMs).toBeLessThanOrEqual(5_000);
    // No OpenAI credential crosses to the browser (R12.6).
    expect(JSON.stringify(res.body)).not.toContain("test-not-a-key");
  });

  it("write failure hangs up and returns DEPENDENCY, leaving callId and registeredCallIds unchanged", async () => {
    const { rig, sdp, session } = await setup();
    rig.openai.script("realtime.calls.create", created("rtc_lost"));
    rig.openai.always("realtime.calls.hangup", ok(null));
    const inner = rig.deps.store;
    rig.deps.store = {
      get: (u, p) => inner.get(u, p),
      query: (u, q) => inner.query(u, q),
      transaction: (u, fn) =>
        inner.transaction(u, async (tx) => {
          let touchesSession = false;
          const r = await fn({ ...tx, update: (p, rec) => ((touchesSession ||= p.includes("/sessions/")), tx.update(p, rec)) });
          if (touchesSession) throw new Error("injected commit failure");
          return r;
        }),
    };
    const res = await sdp();
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("DEPENDENCY");
    expect(res.body.retryAfterMs).toBeGreaterThanOrEqual(1);
    expect(res.body).not.toHaveProperty("answerSdp");
    expect(rig.openai.requestsTo("realtime.calls.hangup").map((r) => r.body)).toEqual([{ callId: "rtc_lost" }]);
    rig.deps.store = inner;
    expect(await session()).toMatchObject({ callId: null, registeredCallIds: [] });
  });

  it("write failure with a failing hangup keeps retrying the hangup after the response", async () => {
    const { rig, sdp } = await setup();
    rig.openai.script("realtime.calls.create", created("rtc_lost"));
    rig.openai.script("realtime.calls.hangup", fail(new Error("openai 500")), fail(new Error("openai 500")), ok(null));
    const inner = rig.deps.store;
    rig.deps.store = {
      get: (u, p) => inner.get(u, p),
      query: (u, q) => inner.query(u, q),
      transaction: (u, fn) =>
        inner.transaction(u, async (tx) => {
          let touchesSession = false;
          const r = await fn({ ...tx, update: (p, rec) => ((touchesSession ||= p.includes("/sessions/")), tx.update(p, rec)) });
          if (touchesSession) throw new Error("injected commit failure");
          return r;
        }),
    };
    expect((await sdp()).body.error).toBe("DEPENDENCY");
    expect(rig.sched.pending).toBeGreaterThan(0);
    await runScheduled(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup")).toHaveLength(3);
  });

  it("4 call IDs → LIMIT (409) with no OpenAI call and the Session unchanged", async () => {
    const { rig, s, sdp, session } = await setup();
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { registeredCallIds: ["rtc_1", "rtc_2", "rtc_3", "rtc_4"], callId: "rtc_4" });
    const before = await session();
    const res = await sdp();
    expect(res).toMatchObject({ status: 409, body: { error: "LIMIT" } });
    expect(rig.openai.requestsTo("realtime.calls.create")).toHaveLength(0);
    expect(await session()).toEqual(before);
  });

  it("STALE for a wrong generation or a closed Session, SCOPE for another tenant's Session; no OpenAI call", async () => {
    const { rig, s, sdp, session } = await setup();
    expect((await sdp({ generation: 2 })).body.error).toBe("STALE");
    expect((await sdp({ sessionId: testId("nope") })).body.error).toBe("SCOPE");
    const other = await callRoute(rig, sdpRoute, { requestId: testId("x"), sessionId: s.sessionId, generation: 1, offerSdp: "v=0" }, { token: "token:owner-2" });
    expect(other.body.error).toBe("SCOPE");
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "closed" });
    expect((await sdp()).body.error).toBe("STALE");
    expect(rig.openai.requestsTo("realtime.calls.create")).toHaveLength(0);
    expect((await session()).registeredCallIds).toEqual([]);
  });

  it("PARSE for an empty offer, an oversize offer and unknown fields", async () => {
    const { rig, sdp } = await setup();
    expect((await sdp({ offerSdp: "" })).body.error).toBe("PARSE");
    expect((await sdp({ offerSdp: "x".repeat(65_537) })).body.error).toBe("PARSE");
    expect((await sdp({ extra: 1 })).body.error).toBe("PARSE");
    expect(rig.openai.requestsTo("realtime.calls.create")).toHaveLength(0);
  });

  it("DEPENDENCY within 5 s when OpenAI never answers; a late call ID is hung up", async () => {
    const { rig, sdp, session } = await setup();
    let release: (v: unknown) => void = () => {};
    const late = new Promise((r) => (release = r));
    rig.openai.call = ((orig) =>
      function (this: unknown, endpoint, body) {
        if (endpoint === "realtime.calls.create") {
          rig.openai.requests.push({ endpoint, body, index: rig.openai.requests.length });
          return late;
        }
        return orig.call(rig.openai, endpoint, body);
      })(rig.openai.call) as typeof rig.openai.call;
    rig.openai.always("realtime.calls.hangup", ok(null));
    const res = await sdp();
    expect(res.body.error).toBe("DEPENDENCY");
    expect(res.elapsedMs).toBeLessThan(5_000);
    expect((await session()).registeredCallIds).toEqual([]);
    release({ answerSdp: ANSWER, location: "/v1/realtime/calls/rtc_late" });
    await runScheduled(rig);
    expect(rig.openai.requestsTo("realtime.calls.hangup").map((r) => r.body)).toEqual([{ callId: "rtc_late" }]);
  });

  it("DEPENDENCY for an OpenAI error or an answer with no call ID in Location", async () => {
    const { rig, sdp, session } = await setup();
    rig.openai.script("realtime.calls.create", fail(new Error("openai 500")), created(null));
    expect((await sdp()).body.error).toBe("DEPENDENCY");
    expect((await sdp()).body.error).toBe("DEPENDENCY");
    expect((await session()).registeredCallIds).toEqual([]);
  });

  it("a never-answering OpenAI still lets the route finish (never())", async () => {
    const { rig, sdp } = await setup();
    rig.openai.script("realtime.calls.create", never());
    const res = await sdp();
    expect(res.body.error).toBe("DEPENDENCY");
    expect(res.elapsedMs).toBeLessThanOrEqual(5_000);
  });

  it("a replay with the same requestId returns the recorded answer and makes no second call", async () => {
    const { rig, s } = await setup();
    rig.openai.script("realtime.calls.create", created("rtc_1"));
    const body = { requestId: testId("same"), sessionId: s.sessionId, generation: 1, offerSdp: "v=0 offer" };
    const a = await callRoute(rig, sdpRoute, body);
    const b = await callRoute(rig, sdpRoute, body);
    expect(b.body).toEqual(a.body);
    expect(rig.openai.requestsTo("realtime.calls.create")).toHaveLength(1);
  });
});

describe("callIdFromLocation", () => {
  it.each([
    ["/v1/realtime/calls/rtc_abc", "rtc_abc"],
    ["https://api.openai.com/v1/realtime/calls/rtc_abc/", "rtc_abc"],
    ["/v1/realtime/calls/rtc_abc?x=1", "rtc_abc"],
  ])("reads %s", (loc, id) => expect(callIdFromLocation(loc)).toBe(id));
  it.each([[null], [""], ["/v1/other/rtc_abc"], ["/v1/realtime/calls/bad id"]])("rejects %s", (loc) => expect(callIdFromLocation(loc)).toBeNull());
});
