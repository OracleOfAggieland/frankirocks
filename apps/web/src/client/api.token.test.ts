/**
 * The ApiClient's token step (`createApiClient`), pinned as it behaves today. `call` promises a closed ApiResult,
 * but the token is awaited before the timeout is armed and outside the try: a hanging token is not on the
 * timeout, and a rejecting one rejects the call. One case is written red first (`it.fails`): the behaviour wanted
 * later, that a rejecting token resolves `network`.
 *
 * Timers are vitest's fake timers, so `timeoutMs` runs on virtual time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FetchLike, createApiClient } from "./api";

/** A fetch that never answers until aborted, and counts its calls. */
function hangingFetch(): FetchLike & { calls: number } {
  const f = Object.assign(
    (_url: string, init: RequestInit) => {
      f.calls++;
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    },
    { calls: 0 },
  );
  return f;
}

/** A token the test resolves by hand. */
function heldToken() {
  let release: (token: string) => void = () => {};
  const token = new Promise<string>((resolve) => (release = resolve));
  return { getToken: () => token, release: (t: string) => release(t) };
}

function track<T>(p: Promise<T>) {
  const seen: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  p.then(
    (value) => Object.assign(seen, { settled: true, value }),
    (error: unknown) => Object.assign(seen, { settled: true, error }),
  );
  return seen;
}

describe("ApiClient token step", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Today's side of the red case "a rejecting getToken resolves network": the change that removes its `.fails` deletes this case.
  it("today: a rejecting getToken rejects the call instead of resolving an ApiResult", async () => {
    const fetch = hangingFetch();
    const api = createApiClient({ getToken: () => Promise.reject(new Error("auth/network-request-failed")), fetch });
    await expect(api.call("/api/session/close", { body: {}, timeoutMs: 1_500 })).rejects.toThrow("auth/network-request-failed");
    expect(fetch.calls).toBe(0);
  });

  it.fails("a rejecting getToken resolves network", async () => {
    const fetch = hangingFetch();
    const api = createApiClient({ getToken: () => Promise.reject(new Error("auth/network-request-failed")), fetch });
    await expect(api.call("/api/session/close", { body: {}, timeoutMs: 1_500 })).resolves.toEqual({ ok: false, kind: "network" });
  });

  it("today: a hanging getToken is not on the timeout; the timeout starts when the token arrives", async () => {
    const fetch = hangingFetch();
    const token = heldToken();
    const api = createApiClient({ getToken: token.getToken, fetch });
    const seen = track(api.call("/api/session/close", { body: {}, timeoutMs: 1_500 }));

    // Far past timeoutMs with the token still pending: no result, and nothing was sent.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen.settled).toBe(false);
    expect(fetch.calls).toBe(0);

    // The token arrives: the request goes out and its own 1.5 s starts now.
    token.release("id-token-1");
    await vi.advanceTimersByTimeAsync(1_499);
    expect(fetch.calls).toBe(1);
    expect(seen.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual({ settled: true, value: { ok: false, kind: "timeout" } });
  });
});
