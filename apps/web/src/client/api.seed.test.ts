import { AdvanceResponse, ResetResponse, validate } from "@franki/core";
import { describe, expect, it, vi } from "vitest";
import { ADVANCE_ANSWER, QUIET_ADVANCE_ANSWER, RESET_ANSWER, THURSDAY_WORLD, vid } from "../app/specimens/_fixtures/visit";
import { type FetchLike, advanceVisit, createApiClient, resetVisit } from "./api";
import { ADVANCE_PATH, PERSONA_FIXTURE_ID, RESET_PATH } from "./seed-guesses";

function fake(respond: () => Response | Promise<Response>) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    seen.push({ url, init });
    return respond();
  };
  return { api: createApiClient({ getToken: async () => "tok", fetch }), seen };
}

const RESET = { requestId: vid("r"), sessionId: null, fixtureId: PERSONA_FIXTURE_ID, visitId: vid("v"), clientZone: "America/Chicago" };
const ADVANCE = { requestId: vid("r2"), fixtureNamespace: vid("ns"), to: THURSDAY_WORLD };

describe("seed fixtures", () => {
  it("are valid against the closed responses", () => {
    expect(validate(ResetResponse, RESET_ANSWER).ok).toBe(true);
    expect(validate(AdvanceResponse, ADVANCE_ANSWER).ok).toBe(true);
    expect(validate(AdvanceResponse, QUIET_ADVANCE_ANSWER).ok).toBe(true);
  });
});

describe("resetVisit", () => {
  it("posts the contract's request and returns the validated answer", async () => {
    const { api, seen } = fake(() => Response.json(RESET_ANSWER));
    const r = await resetVisit(api, RESET);
    expect(r).toEqual({ ok: true, body: RESET_ANSWER });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(RESET_PATH);
    expect(seen[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual(RESET);
  });

  it("answers barrier on 423, with the retry hint", async () => {
    const { api } = fake(() => Response.json({ error: "BARRIER", retryAfterMs: 1500 }, { status: 423 }));
    expect(await resetVisit(api, RESET)).toEqual({ ok: false, why: "barrier", retryAfterMs: 1500 });
  });

  it("answers barrier on a BARRIER code under another status", async () => {
    const { api } = fake(() => Response.json({ error: "BARRIER", retryAfterMs: 0 }, { status: 409 }));
    expect(await resetVisit(api, RESET)).toEqual({ ok: false, why: "barrier", retryAfterMs: 0 });
  });

  it("answers failed for an answer outside the closed response", async () => {
    const { api } = fake(() => Response.json({ ...RESET_ANSWER, extra: 1 }));
    expect(await resetVisit(api, RESET)).toEqual({ ok: false, why: "failed" });
  });

  it("answers failed for another error status", async () => {
    const { api } = fake(() => Response.json({ error: "AUTH", retryAfterMs: 0 }, { status: 403 }));
    expect(await resetVisit(api, RESET)).toEqual({ ok: false, why: "failed" });
  });

  it("never sends a request the contract would refuse", async () => {
    const { api, seen } = fake(() => Response.json(RESET_ANSWER));
    expect(await resetVisit(api, { ...RESET, visitId: "short" })).toEqual({ ok: false, why: "failed" });
    expect(seen).toHaveLength(0);
  });

  it("answers timeout when the route never answers", async () => {
    vi.useFakeTimers();
    try {
      const fetch: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      const api = createApiClient({ getToken: async () => "tok", fetch });
      const pending = resetVisit(api, RESET);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await pending).toEqual({ ok: false, why: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends nothing while signed out", async () => {
    const seen: string[] = [];
    const api = createApiClient({ getToken: async () => null, fetch: async (u) => (seen.push(u), Response.json({})) });
    expect(await resetVisit(api, RESET)).toEqual({ ok: false, why: "signedOut" });
    expect(seen).toEqual([]);
  });
});

describe("advanceVisit", () => {
  it("posts the contract's request and returns the proactive line", async () => {
    const { api, seen } = fake(() => Response.json(ADVANCE_ANSWER));
    const r = await advanceVisit(api, ADVANCE);
    expect(r).toEqual({ ok: true, body: ADVANCE_ANSWER });
    expect(seen[0]!.url).toBe(ADVANCE_PATH);
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual(ADVANCE);
  });

  it("answers barrier on 423", async () => {
    const { api } = fake(() => Response.json({ error: "BARRIER", retryAfterMs: 2500 }, { status: 423 }));
    expect(await advanceVisit(api, ADVANCE)).toEqual({ ok: false, why: "barrier", retryAfterMs: 2500 });
  });

  it("answers timeout when the route never answers", async () => {
    vi.useFakeTimers();
    try {
      const fetch: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      const api = createApiClient({ getToken: async () => "tok", fetch });
      const pending = advanceVisit(api, ADVANCE);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await pending).toEqual({ ok: false, why: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers failed on a network error", async () => {
    const api = createApiClient({ getToken: async () => "tok", fetch: async () => Promise.reject(new Error("down")) });
    expect(await advanceVisit(api, ADVANCE)).toEqual({ ok: false, why: "failed" });
  });
});
