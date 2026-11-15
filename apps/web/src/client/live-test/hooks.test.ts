/**
 * Brief 050 part B: the optional hooks in the voice client and the API client. Absent, they do nothing; present,
 * they hear events, commands and requests; throwing, they never reach the call.
 */
import type { VoiceCommand, VoiceEvent } from "@franki/core";
import { describe, expect, it } from "vitest";
import { type ApiClient, createApiClient } from "../api";
import { createBrowserClock } from "../clock";
import { type AudioLike, VoiceClient } from "../voice-client";

const hangingApi: ApiClient = { call: () => new Promise(() => {}) };

function client() {
  const clock = createBrowserClock({ zone: "UTC", monotonic: { timeOrigin: 1_763_159_000_000, now: () => 0 } });
  const audio: AudioLike = { muted: true, srcObject: null };
  return new VoiceClient({
    api: hangingApi,
    clock,
    audio,
    transcribeModel: "test-transcribe",
    createPeer: () => {
      throw new Error("no peer in this test");
    },
    getMicrophone: () => new Promise(() => {}),
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
    newId: () => "id",
  });
}

describe("the voice client's observer", () => {
  it("hears each event in and each command out", () => {
    const v = client();
    const events: VoiceEvent[] = [];
    const commands: VoiceCommand[] = [];
    const links: unknown[] = [];
    v.observe({ event: (e) => events.push(e), command: (c) => commands.push(c), link: (p, c) => links.push([p, c]) });
    expect(links).toEqual([[null, null]]);
    v.call();
    expect(events.map((e) => e.type)).toEqual(["callPressed"]);
    expect(commands.map((c) => c.kind)).toContain("open");
    v.observe(null);
    v.hangUp();
    expect(events).toHaveLength(1);
  });

  it("a throwing observer never changes the call", () => {
    const quiet = client();
    quiet.call();
    const loud = client();
    loud.observe({
      event: () => {
        throw new Error("x");
      },
      command: () => {
        throw new Error("y");
      },
    });
    expect(() => loud.call()).not.toThrow();
    expect(loud.getSnapshot().phase).toBe(quiet.getSnapshot().phase);
  });
});

describe("the API client's observer", () => {
  it("is told each request that reached the network and how it ended", async () => {
    const seen: unknown[] = [];
    const api = createApiClient({
      getToken: async () => "token",
      fetch: async (input) => (input.startsWith("/api/turn") ? Response.json({ ok: true }) : Response.json({ error: "STALE" }, { status: 409 })),
      observe: (route, method) => {
        seen.push(["start", route, method]);
        return (end) => seen.push(["end", route, end]);
      },
    });
    await api.call("/api/turn", { body: {} });
    await api.call("/api/session/open?x=1", { body: {} });
    expect(seen).toEqual([
      ["start", "/api/turn", "POST"],
      ["end", "/api/turn", { status: 200, err: null }],
      ["start", "/api/session/open", "POST"],
      ["end", "/api/session/open", { status: 409, err: null }],
    ]);
  });

  it("hears failures, and nothing while signed out", async () => {
    const seen: unknown[] = [];
    let token: string | null = null;
    const api = createApiClient({
      getToken: async () => token,
      fetch: async () => {
        throw new Error("offline");
      },
      observe: () => (end) => seen.push(end),
    });
    expect(await api.call("/api/turn", { body: {} })).toEqual({ ok: false, kind: "signedOut" });
    token = "t";
    expect(await api.call("/api/turn", { body: {} })).toEqual({ ok: false, kind: "network" });
    expect(seen).toEqual([{ status: null, err: "network" }]);
  });

  it("a throwing observer never changes the answer", async () => {
    const api = createApiClient({
      getToken: async () => "t",
      fetch: async () => Response.json({ fine: 1 }),
      observe: () => {
        throw new Error("x");
      },
    });
    expect(await api.call("/api/turn", { body: {} })).toEqual({ ok: true, status: 200, body: { fine: 1 } });
    const api2 = createApiClient({
      getToken: async () => "t",
      fetch: async () => Response.json({ fine: 1 }),
      observe: () => () => {
        throw new Error("y");
      },
    });
    expect(await api2.call("/api/turn", { body: {} })).toEqual({ ok: true, status: 200, body: { fine: 1 } });
  });
});
