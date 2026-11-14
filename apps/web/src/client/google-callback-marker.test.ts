// Brief 049 review S5: the callback page sends a connect only for a wait the sheet began. The sheet places a
// one-time marker when it opens Google's window and removes it whenever that wait ends; the callback page takes it
// before it posts. A link to /google/callback opened anywhere else sends nothing.
import { describe, expect, it } from "vitest";
import type { ApiClient, ApiResult } from "./api";
import { runGoogleCallback } from "./google-callback";
import { GOOGLE_OFF, GOOGLE_URL } from "../app/specimens/_fixtures/google";
import { GOOGLE_CONNECT_PATH, GOOGLE_START_PATH, GOOGLE_STATUS_PATH } from "./google-api";
import { type GoogleWaitStore, GoogleWatch, waitMarker } from "./google-watch";

const STATE = "s".repeat(43);

function memoryStore(): GoogleWaitStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return { items, get: (k) => items.get(k) ?? null, set: (k, v) => void items.set(k, v), remove: (k) => void items.delete(k) };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** The sheet's shell, with Google off and a start that answers Google's URL. */
function sheet(marker: ReturnType<typeof waitMarker>) {
  const api: ApiClient = {
    async call<T>(path: string): Promise<ApiResult<T>> {
      if (path === GOOGLE_STATUS_PATH) return { ok: true, status: 200, body: { google: GOOGLE_OFF } as T };
      if (path === GOOGLE_START_PATH) return { ok: true, status: 200, body: { url: GOOGLE_URL, expiresAt: "2026-11-14T00:10:00.000Z" } as T };
      throw new Error("offline");
    },
  };
  return new GoogleWatch({ api, now: () => 0, newId: () => "x", openPopup: () => ({ navigate: () => {}, close: () => {} }), listen: () => () => {}, marker, timers: { setTimeout: () => 0, clearTimeout: () => {} } });
}

function callbackWith(marker: ReturnType<typeof waitMarker>) {
  const calls: string[] = [];
  const api: ApiClient = {
    async call<T>(path: string): Promise<ApiResult<T>> {
      calls.push(path);
      return { ok: true, status: 200, body: { google: { email: null, mail: "connected", calendar: "off", needsReconnect: false, connectedAt: null }, outcome: "connected" } as T };
    },
  };
  return {
    calls,
    run: () => runGoogleCallback({ search: `?code=4%2Fabc&state=${STATE}`, scrub: () => {}, signedIn: async () => api, newId: () => `req${"7".padStart(40, "A")}`, tell: () => {}, claimWait: () => marker.claim() }),
  };
}

describe("S5: the callback posts only for the sheet's own wait", () => {
  it("with no marker, nothing is sent and the outcome is refused", async () => {
    const marker = waitMarker(memoryStore());
    const cb = callbackWith(marker);
    expect(await cb.run()).toBe("refused");
    expect(cb.calls).toEqual([]);
  });

  it("the sheet's press places the marker; the callback takes it once", async () => {
    const store = memoryStore();
    const marker = waitMarker(store);
    const watch = sheet(marker);
    watch.start();
    watch.open();
    await flush();
    watch.connect();
    expect(store.items.size).toBe(1);
    const cb = callbackWith(marker);
    expect(await cb.run()).toBe("connected");
    expect(cb.calls).toEqual([GOOGLE_CONNECT_PATH]);
    expect(store.items.size).toBe(0);
    // A second load of the same link sends nothing.
    expect(await callbackWith(marker).run()).toBe("refused");
  });

  it("the sheet removes its marker when the wait ends", async () => {
    const store = memoryStore();
    const marker = waitMarker(store);
    const watch = sheet(marker);
    watch.start();
    watch.open();
    await flush();
    watch.connect();
    expect(store.items.size).toBe(1);
    watch.stop();
    expect(store.items.size).toBe(0);
  });

  it("a browser with no storage at all relies on the server's state check alone", async () => {
    const marker = waitMarker(null);
    marker.place();
    expect(marker.claim()).toBe(true);
  });
});
