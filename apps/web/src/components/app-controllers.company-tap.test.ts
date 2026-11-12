/* eslint-disable @typescript-eslint/no-explicit-any -- the test reads request bodies. */
// Brief 044, item 3: the company toggle's tap through the signed-in controllers: on the typed Session with no call,
// and nothing sent while the visit has not said which account this is (brief 038's input gate).
import { describe, expect, it } from "vitest";
import { RESET_ANSWER } from "../app/specimens/_fixtures/visit";
import type { ApiClient, ApiResult } from "../client/api";
import { createBrowserClock } from "../client/clock";
import type { PeerLike, StreamLike } from "../client/voice-client";
import { createSignedInControllers } from "./app-controllers";

const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const ID = (c: string) => c.repeat(43);
const SS = { sessionId: ID("s"), epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1 };

function build() {
  const sent: { path: string; body: any }[] = [];
  const api: ApiClient = {
    async call<T>(path: string, init?: { body?: unknown }) {
      sent.push({ path, body: init?.body });
      if (path === "/api/seed/reset") return { ok: true, status: 200, body: RESET_ANSWER } as ApiResult<T>;
      if (path === "/api/session/open")
        return { ok: true, status: 200, body: { sessionId: SS.sessionId, generation: 1, deck: null, state: "connecting", ack: { stamp: SS, issuedOpsAt: "2026-11-03T12:00:00.000Z", expiresOpsAt: "2026-11-03T12:00:10.000Z" }, proactive: null } } as ApiResult<T>;
      if (path === "/api/turn") {
        const b = init?.body as { requestId: string; turnId: string };
        return {
          ok: true,
          status: 200,
          body: { requestId: b.requestId, stamp: { ...SS, policyRev: 2, turnId: b.turnId }, status: "ready", deck: null, permit: null, notes: [], cards: [], pendingId: null, question: null, retryAfterMs: 0, receiptId: null, error: null },
        } as ApiResult<T>;
      }
      return { ok: false, kind: "http", status: 503, error: "DEPENDENCY", retryAfterMs: 0 } as ApiResult<T>;
    },
  };
  const data = new Map<string, string>();
  const c = createSignedInControllers({
    api,
    clock: createBrowserClock({ zone: "UTC", monotonic: { timeOrigin: 0, now: () => 0 } }),
    transcribeModel: "test-transcribe",
    debug: false,
    audio: () => ({ muted: true, srcObject: null }),
    createPeer: () => ({}) as PeerLike,
    getMicrophone: async () => ({ getAudioTracks: () => [] }) as StreamLike,
    onStreams: () => {},
    uid: "u1",
    storage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) },
  });
  return { c, sent };
}

describe("signed-in controllers: the company tap (brief 044, item 3)", () => {
  it("with no call, opens the typed Session and posts the tap on it; the toggle shows company after the answer", async () => {
    const { c, sent } = build();
    c.visit.enter();
    await flush();
    await c.company.tap("company");
    const turns = sent.filter((s) => s.path === "/api/turn");
    expect(turns).toHaveLength(1);
    expect(turns[0]!.body).toMatchObject({ sessionId: SS.sessionId, source: "trustedTap", transcript: "", uiControl: { verb: "company", targetIds: [] } });
    expect(c.company.getSnapshot().company).toBe(true);
  });

  it("before the visit has answered, nothing is sent and the toggle stays as it was", async () => {
    const { c, sent } = build();
    await c.company.tap("company");
    expect(sent.filter((s) => s.path === "/api/turn" || s.path === "/api/session/open")).toEqual([]);
    expect(c.company.getSnapshot().company).toBe(false);
  });
});
