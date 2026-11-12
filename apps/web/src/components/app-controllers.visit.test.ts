// Brief 027: the visit's wiring in the signed-in controllers, with a fake API and an in-memory storage.
import { describe, expect, it } from "vitest";
import { ADVANCE_ANSWER, RESET_ANSWER, THURSDAY_WORLD } from "../app/specimens/_fixtures/visit";
import type { ApiClient, ApiResult } from "../client/api";
import { createBrowserClock } from "../client/clock";
import type { PeerLike, StreamLike } from "../client/voice-client";
import { createSignedInControllers } from "./app-controllers";

const flush = () => new Promise((r) => setTimeout(r, 0));

function build() {
  const calls: string[] = [];
  const api: ApiClient = {
    async call<T>(path: string) {
      calls.push(path);
      if (path === "/api/seed/reset") return { ok: true, status: 200, body: RESET_ANSWER } as ApiResult<T>;
      if (path === "/api/seed/advance") return { ok: true, status: 200, body: ADVANCE_ANSWER } as ApiResult<T>;
      return { ok: false, kind: "http", status: 503, error: "DEPENDENCY", retryAfterMs: 0 } as ApiResult<T>;
    },
  };
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const c = createSignedInControllers({
    api,
    clock: createBrowserClock({ zone: "UTC", monotonic: { timeOrigin: 0, now: () => 0 } }),
    transcribeModel: null,
    debug: false,
    audio: () => ({ muted: true, srcObject: null }),
    createPeer: () => ({}) as PeerLike,
    getMicrophone: async () => ({ getAudioTracks: () => [] }) as StreamLike,
    onStreams: () => {},
    uid: "u1",
    storage,
  });
  return { c, calls, data };
}

describe("signed-in controllers: the visit (brief 027)", () => {
  it("entering clones once, the bolt's proactive line reaches the shelf, and start over clears the screen", async () => {
    const { c, calls, data } = build();
    c.visit.enter();
    await flush();
    expect(calls.filter((p) => p === "/api/seed/reset")).toHaveLength(1);
    expect(c.visit.getSnapshot().phase).toBe("ready");
    expect([...data.keys()]).toEqual(["franki.visit.u1"]);

    c.visit.press(Date.parse(THURSDAY_WORLD));
    await flush();
    expect(c.proactive.getSnapshot()?.text).toBe("How'd Biscuit do?");

    c.visit.askStartOver();
    c.visit.confirmStartOver();
    await flush();
    expect(calls.filter((p) => p === "/api/seed/reset")).toHaveLength(2);
    expect(c.proactive.getSnapshot()).toBeNull();
    expect(c.typed.getSnapshot().entries).toEqual([]);
  });
});
