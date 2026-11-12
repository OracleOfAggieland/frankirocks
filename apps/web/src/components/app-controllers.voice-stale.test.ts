// Brief 044, item 2: a call whose open names an old visit ends, and the screen's visit model reloads the visit.
import { describe, expect, it } from "vitest";
import { RESET_ANSWER } from "../app/specimens/_fixtures/visit";
import type { ApiClient, ApiResult } from "../client/api";
import { createBrowserClock } from "../client/clock";
import type { PeerLike, StreamLike } from "../client/voice-client";
import { createSignedInControllers } from "./app-controllers";

const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

function build() {
  const opens: { visitId?: unknown }[] = [];
  const api: ApiClient = {
    async call<T>(path: string, init?: { body?: unknown }) {
      if (path === "/api/seed/reset") return { ok: true, status: 200, body: RESET_ANSWER } as ApiResult<T>;
      if (path === "/api/session/open") {
        opens.push(init?.body as { visitId?: unknown });
        return { ok: false, kind: "http", status: 409, error: "STALE", retryAfterMs: 0 } as ApiResult<T>;
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
  return { c, opens };
}

describe("signed-in controllers: an open answered STALE (brief 044, item 2)", () => {
  it("ends the call with no retry, and the visit reloads", async () => {
    const { c, opens } = build();
    c.visit.enter();
    await flush();
    expect(c.visit.getSnapshot().phase).toBe("ready");
    const visitId = c.visit.getSnapshot().visit!.visitId;
    c.voice!.call();
    await flush();
    expect(opens).toHaveLength(1);
    expect(opens[0]!.visitId).toBe(visitId);
    const v = c.voice!.getSnapshot();
    expect(v.phase).toBe("CLOSED");
    expect(v.error).toBe("visit");
    expect(v.awaitingOpen).toBe(false);
    expect(v.deadlines).toEqual({});
    // The visit model was told: nothing newer is stored, so this tab's visit is over.
    expect(c.visit.getSnapshot().phase).toBe("failed");
    // A press on the same visit opens nothing.
    c.voice!.call();
    await flush();
    expect(opens).toHaveLength(1);
  });
});
