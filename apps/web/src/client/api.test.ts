import { describe, expect, it } from "vitest";
import { type FetchLike, createApiClient } from "./api";

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (url: string) => Response = () => Response.json({ ok: true })) {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (url, init) => {
    seen.push({ url, init });
    return respond(url);
  };
  return { fetch, seen };
}

const header = (s: Seen, name: string) => (s.init.headers as Record<string, string>)[name];

describe("ApiClient", () => {
  it("attaches Bearer token", async () => {
    const { fetch, seen } = fakeFetch();
    const api = createApiClient({ getToken: async () => "id-token-1", fetch });
    const r = await api.call("/api/session/open", { body: { requestId: "r" } });
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(header(seen[0]!, "authorization")).toBe("Bearer id-token-1");
    expect(header(seen[0]!, "content-type")).toBe("application/json");
    expect(seen[0]!.init.method).toBe("POST");
    expect(seen[0]!.init.body).toBe(JSON.stringify({ requestId: "r" }));
  });

  it("reads the token on every call, so a refreshed token is used", async () => {
    const { fetch, seen } = fakeFetch();
    let n = 0;
    const api = createApiClient({ getToken: async () => `tok-${++n}`, fetch });
    await api.call("/api/debug/memory", { query: { section: "turns", cursor: null } });
    await api.call("/api/debug/memory", { query: { section: "turns" } });
    expect(seen.map((s) => header(s, "authorization"))).toEqual(["Bearer tok-1", "Bearer tok-2"]);
    expect(seen[0]!.url).toBe("/api/debug/memory?section=turns");
    expect(seen[0]!.init.method).toBe("GET");
  });

  it("no /api call while signed out except /api/health", async () => {
    const { fetch, seen } = fakeFetch();
    const api = createApiClient({ getToken: async () => null, fetch });
    for (const path of ["/api/session/open", "/api/session/state", "/api/session/close", "/api/turn", "/api/debug/memory"]) {
      expect(await api.call(path, { body: {} })).toEqual({ ok: false, kind: "signedOut" });
    }
    expect(seen).toHaveLength(0);
    const health = await api.call("/api/health");
    expect(health.ok).toBe(true);
    expect(seen.map((s) => s.url)).toEqual(["/api/health"]);
    expect(header(seen[0]!, "authorization")).toBeUndefined();
  });

  it("sends no token to /api/health even when signed in", async () => {
    const { fetch, seen } = fakeFetch();
    const api = createApiClient({ getToken: async () => "id-token-1", fetch });
    await api.call("/api/health");
    expect(header(seen[0]!, "authorization")).toBeUndefined();
  });

  it("refuses paths outside /api/", async () => {
    const { fetch } = fakeFetch();
    const api = createApiClient({ getToken: async () => "t", fetch });
    await expect(api.call("https://example.com/api/turn")).rejects.toThrow(/only calls \/api\//);
  });

  it("returns the contracts §6 error code on an error status", async () => {
    const { fetch } = fakeFetch(() => Response.json({ error: "STALE", retryAfterMs: 0 }, { status: 409 }));
    const api = createApiClient({ getToken: async () => "t", fetch });
    expect(await api.call("/api/turn", { body: {} })).toEqual({ ok: false, kind: "http", status: 409, error: "STALE", retryAfterMs: 0 });
  });

  it("reports a network failure and a timeout separately", async () => {
    const failing = createApiClient({ getToken: async () => "t", fetch: async () => Promise.reject(new TypeError("offline")) });
    expect(await failing.call("/api/turn", { body: {} })).toEqual({ ok: false, kind: "network" });

    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const slow = createApiClient({ getToken: async () => "t", fetch: hanging });
    expect(await slow.call("/api/turn", { body: {}, timeoutMs: 5 })).toEqual({ ok: false, kind: "timeout" });
  });
});
