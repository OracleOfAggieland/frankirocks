// Brief 040, item 4: the call's open names the visit the screen's visit model holds, as the typed line's open does.
import { describe, expect, it } from "vitest";
import { RESET_ANSWER } from "../app/specimens/_fixtures/visit";
import type { ApiClient, ApiResult } from "../client/api";
import { createBrowserClock } from "../client/clock";
import type { PeerLike, StreamLike } from "../client/voice-client";
import { createSignedInControllers } from "./app-controllers";

const flush = () => new Promise((r) => setTimeout(r, 0));

function build(reset: "clone" | "live" = "clone") {
  const opens: { visitId?: unknown }[] = [];
  const api: ApiClient = {
    async call<T>(path: string, init?: { body?: unknown }) {
      if (path === "/api/session/open") opens.push(init?.body as { visitId?: unknown });
      if (path === "/api/seed/reset") {
        if (reset === "live") return { ok: false, kind: "http", status: 409, error: "LIVE", retryAfterMs: 0 } as ApiResult<T>;
        return { ok: true, status: 200, body: RESET_ANSWER } as ApiResult<T>;
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

describe("signed-in controllers: the visit in the call's open (brief 040, item 4)", () => {
  // Brief 038, finding 1: the screen takes no input until the server has said what the account is, so a call
  // started before the visit's reset has answered sends no open at all.
  it("before the visit has answered, no open is sent", async () => {
    const { c, opens } = build();
    c.voice!.call();
    await flush();
    expect(opens).toHaveLength(0);
  });

  it("on a real account, which has no visit, the open names none", async () => {
    const { c, opens } = build("live");
    c.visit.enter();
    await flush();
    expect(c.visit.getSnapshot().phase).toBe("live");
    c.voice!.call();
    await flush();
    expect(opens).toHaveLength(1);
    expect(opens[0]!.visitId).toBeNull();
  });

  it("once the visit's reset has answered, the call's open names it", async () => {
    const { c, opens } = build();
    c.visit.enter();
    await flush();
    expect(c.visit.getSnapshot().phase).toBe("ready");
    const visitId = c.visit.getSnapshot().visit!.visitId;
    c.voice!.call();
    await flush();
    expect(opens).toHaveLength(1);
    expect(opens[0]!.visitId).toBe(visitId);
  });
});
