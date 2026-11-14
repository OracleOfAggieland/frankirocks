// The Google sheet's shell, its calls and the callback page's work (brief 049 part B): the shell runs the machine's
// commands, opens Google's window in the press and sends it only to Google's host, hears the callback's one word,
// and sends nothing before the sheet opens or after sign-out. The callback page takes the query out of the address
// bar first and sends the connect once.
import { describe, expect, it } from "vitest";
import { GOOGLE_CONNECTED, GOOGLE_OFF, GOOGLE_URL } from "../app/specimens/_fixtures/google";
import { GOOGLE_AUTH_POLL_MS, type GoogleCallbackOutcome } from "../ui/google/google-machine";
import type { ApiCallOptions, ApiClient, ApiResult } from "./api";
import { callbackQuery, runGoogleCallback } from "./google-callback";
import { GOOGLE_CONNECT_PATH, GOOGLE_DISCONNECT_PATH, GOOGLE_START_PATH, GOOGLE_STATUS_PATH, connectGoogle, isGoogleAuthorizeUrl, readGoogleStatus, startGoogle } from "./google-api";
import { GOOGLE_CALLBACK_MESSAGE, type GooglePopup, GoogleWatch, callbackOutcomeOf } from "./google-watch";

type Answer = { status: number; body: unknown } | "throw";
const ok = (body: unknown): Answer => ({ status: 200, body });
const STATE = "s".repeat(43);

function fakeApi(routes: Record<string, Answer[]>) {
  const calls: { path: string; body: unknown }[] = [];
  const api: ApiClient = {
    async call<T>(path: string, options?: ApiCallOptions): Promise<ApiResult<T>> {
      calls.push({ path, body: options?.body });
      const a = routes[path]?.shift() ?? "throw";
      if (a === "throw") throw new Error("offline");
      if (a.status >= 400) return { ok: false, kind: "http", status: a.status, error: (a.body as { error?: string }).error ?? null, retryAfterMs: 0 };
      return { ok: true, status: a.status, body: a.body as T };
    },
  };
  return { api, calls };
}

function harness(routes: Record<string, Answer[]>, opts: { blocked?: boolean } = {}) {
  let now = 0;
  let ids = 0;
  const { api, calls } = fakeApi(routes);
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let nextId = 1;
  const popups: { navigated: string[]; closed: number }[] = [];
  let heard: ((o: GoogleCallbackOutcome) => void) | null = null;
  let listening = 0;
  const watch = new GoogleWatch({
    api,
    now: () => now,
    newId: () => `req${String(++ids).padStart(40, "A")}`,
    openPopup: () => {
      if (opts.blocked) return null;
      const p = { navigated: [] as string[], closed: 0 };
      popups.push(p);
      const handle: GooglePopup = { navigate: (u) => p.navigated.push(u), close: () => void p.closed++ };
      return handle;
    },
    listen: (fn) => {
      heard = fn;
      listening++;
      return () => {
        heard = null;
        listening--;
      };
    },
    timers: {
      setTimeout: (fn, ms) => {
        const id = nextId++;
        timers.push({ fn, at: now + ms, id });
        return id;
      },
      clearTimeout: (h) => {
        const i = timers.findIndex((t) => t.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
    },
  });
  watch.start();
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
    await flush();
  };
  return { watch, calls, timers, popups, flush, advance, hear: (o: GoogleCallbackOutcome) => heard?.(o), listening: () => listening };
}

describe("GoogleWatch", () => {
  it("sends nothing before the sheet is opened", async () => {
    const h = harness({});
    await h.flush();
    expect(h.calls).toEqual([]);
  });

  it("opens Google's window in the press, sends it to the start answer's URL, and closes it on the callback's word", async () => {
    const h = harness({
      [GOOGLE_STATUS_PATH]: [ok({ google: GOOGLE_OFF }), ok({ google: GOOGLE_CONNECTED })],
      [GOOGLE_START_PATH]: [ok({ url: GOOGLE_URL, expiresAt: "2026-11-13T20:15:00.000Z" })],
    });
    h.watch.open();
    await h.flush();
    h.watch.connect();
    expect(h.popups).toHaveLength(1);
    await h.flush();
    expect(h.popups[0]!.navigated).toEqual([GOOGLE_URL]);
    expect(h.watch.getSnapshot().phase).toBe("authorizing");
    h.hear("connected");
    await h.flush();
    expect(h.popups[0]!.closed).toBe(1);
    expect(h.watch.getSnapshot()).toMatchObject({ phase: "idle", note: "connected", google: GOOGLE_CONNECTED });
    expect(h.calls.map((c) => c.path)).toEqual([GOOGLE_STATUS_PATH, GOOGLE_START_PATH, GOOGLE_STATUS_PATH]);
  });

  it("a blocked window sends no start", async () => {
    const h = harness({ [GOOGLE_STATUS_PATH]: [ok({ google: GOOGLE_OFF })] }, { blocked: true });
    h.watch.open();
    await h.flush();
    h.watch.connect();
    await h.flush();
    expect(h.watch.getSnapshot().note).toBe("popupBlocked");
    expect(h.calls.map((c) => c.path)).toEqual([GOOGLE_STATUS_PATH]);
  });

  it("a start answer whose URL is not Google's never reaches the window", async () => {
    const h = harness({
      [GOOGLE_STATUS_PATH]: [ok({ google: GOOGLE_OFF })],
      [GOOGLE_START_PATH]: [ok({ url: "https://evil.example/o/oauth2/v2/auth", expiresAt: "2026-11-13T20:15:00.000Z" })],
    });
    h.watch.open();
    await h.flush();
    h.watch.connect();
    await h.flush();
    expect(h.popups[0]!.navigated).toEqual([]);
    expect(h.popups[0]!.closed).toBe(1);
    expect(h.watch.getSnapshot().note).toBe("startFailed");
  });

  it("reads the status as a backup while waiting, and ends the wait when it shows the connection", async () => {
    const h = harness({
      [GOOGLE_STATUS_PATH]: [ok({ google: GOOGLE_OFF }), ok({ google: GOOGLE_OFF }), ok({ google: GOOGLE_CONNECTED }), ok({ google: GOOGLE_CONNECTED })],
      [GOOGLE_START_PATH]: [ok({ url: GOOGLE_URL, expiresAt: "2026-11-13T20:15:00.000Z" })],
    });
    h.watch.open();
    await h.flush();
    h.watch.connect();
    await h.flush();
    await h.advance(GOOGLE_AUTH_POLL_MS);
    expect(h.watch.getSnapshot().phase).toBe("authorizing");
    await h.advance(GOOGLE_AUTH_POLL_MS);
    expect(h.watch.getSnapshot()).toMatchObject({ phase: "idle", note: "connected" });
    expect(h.popups[0]!.closed).toBe(1);
  });

  it("disconnect sends one call with a new request ID, only after Yes", async () => {
    const h = harness({ [GOOGLE_STATUS_PATH]: [ok({ google: GOOGLE_CONNECTED })], [GOOGLE_DISCONNECT_PATH]: [ok({ google: GOOGLE_OFF })] });
    h.watch.open();
    await h.flush();
    h.watch.askDisconnect();
    h.watch.notNow();
    h.watch.askDisconnect();
    expect(h.calls.map((c) => c.path)).toEqual([GOOGLE_STATUS_PATH]);
    h.watch.confirmDisconnect();
    await h.flush();
    expect(h.calls[1]).toEqual({ path: GOOGLE_DISCONNECT_PATH, body: { requestId: `req${"1".padStart(40, "A")}` } });
    expect(h.watch.getSnapshot()).toMatchObject({ phase: "idle", note: "disconnected", google: GOOGLE_OFF });
  });

  it("stop closes the window, stops listening, drops late answers, and sends nothing more", async () => {
    const h = harness({ [GOOGLE_STATUS_PATH]: [ok({ google: GOOGLE_OFF })], [GOOGLE_START_PATH]: [ok({ url: GOOGLE_URL, expiresAt: "2026-11-13T20:15:00.000Z" })] });
    h.watch.open();
    await h.flush();
    h.watch.connect();
    h.watch.stop();
    await h.flush();
    expect(h.popups[0]!.closed).toBe(1);
    expect(h.popups[0]!.navigated).toEqual([]);
    expect(h.listening()).toBe(0);
    expect(h.watch.getSnapshot().phase).toBe("unread");
    h.watch.open();
    h.watch.connect();
    await h.flush();
    expect(h.calls.map((c) => c.path)).toEqual([GOOGLE_STATUS_PATH, GOOGLE_START_PATH]);
  });

  it("hears only the callback's own message shape", () => {
    expect(callbackOutcomeOf({ kind: GOOGLE_CALLBACK_MESSAGE, outcome: "connected" })).toBe("connected");
    expect(callbackOutcomeOf({ kind: GOOGLE_CALLBACK_MESSAGE, outcome: "<b>hi</b>" })).toBeNull();
    expect(callbackOutcomeOf({ kind: "other", outcome: "connected" })).toBeNull();
    expect(callbackOutcomeOf("connected")).toBeNull();
    expect(callbackOutcomeOf(null)).toBeNull();
  });
});

describe("google-api", () => {
  it("only Google's own authorization host is a Google URL", () => {
    expect(isGoogleAuthorizeUrl(GOOGLE_URL)).toBe(true);
    for (const bad of ["http://accounts.google.com/x", "https://accounts.google.com.evil.example/x", "https://user:pw@accounts.google.com/x", "javascript:alert(1)", "not a url", "https://evil.example/?https://accounts.google.com"]) {
      expect(isGoogleAuthorizeUrl(bad)).toBe(false);
    }
  });

  it("maps CONFIG to notConfigured, and a body the contract refuses to a failure", async () => {
    const { api } = fakeApi({
      [GOOGLE_STATUS_PATH]: [{ status: 500, body: { error: "CONFIG" } }, ok({ google: { ...GOOGLE_OFF, token: "x" } }), { status: 503, body: { error: "DEPENDENCY" } }],
      [GOOGLE_START_PATH]: [{ status: 500, body: { error: "CONFIG" } }],
    });
    expect(await readGoogleStatus(api)).toEqual({ ok: false, why: "notConfigured" });
    expect(await readGoogleStatus(api)).toEqual({ ok: false, why: "failed" });
    expect(await readGoogleStatus(api)).toEqual({ ok: false, why: "failed" });
    expect(await startGoogle(api)).toEqual({ ok: false, why: "notConfigured" });
  });

  it("connect: 200 is the route's outcome, a 4xx is refused, anything else unknown", async () => {
    const body = { requestId: `req${"1".padStart(40, "A")}`, code: "4/abc", state: STATE };
    const { api } = fakeApi({
      [GOOGLE_CONNECT_PATH]: [ok({ google: GOOGLE_CONNECTED, outcome: "connected" }), ok({ google: GOOGLE_OFF, outcome: "nothingGranted" }), { status: 409, body: { error: "STALE" } }, { status: 503, body: { error: "DEPENDENCY" } }, "throw"],
    });
    expect(await connectGoogle(api, body)).toBe("connected");
    expect(await connectGoogle(api, body)).toBe("nothingGranted");
    expect(await connectGoogle(api, body)).toBe("refused");
    expect(await connectGoogle(api, body)).toBe("unknown");
    await expect(connectGoogle(api, body)).rejects.toThrow();
  });
});

describe("the callback page's work", () => {
  it("reads code and state once; an error is denied and its text never read; anything else is bad", () => {
    expect(callbackQuery(`?code=4%2Fabc&state=${STATE}&scope=x`)).toEqual({ kind: "code", code: "4/abc", state: STATE });
    expect(callbackQuery("?error=access_denied&error_description=%3Cscript%3E")).toEqual({ kind: "denied" });
    expect(callbackQuery(`?code=a&code=b&state=${STATE}`)).toEqual({ kind: "bad" });
    expect(callbackQuery("?code=a")).toEqual({ kind: "bad" });
    expect(callbackQuery("")).toEqual({ kind: "bad" });
  });

  function deps(search: string, routes: Record<string, Answer[]>, signedIn = true) {
    const { api, calls } = fakeApi(routes);
    const order: string[] = [];
    const told: GoogleCallbackOutcome[] = [];
    return {
      calls,
      order,
      told,
      d: {
        search,
        scrub: () => void order.push("scrub"),
        signedIn: async () => {
          order.push("signedIn");
          return signedIn ? api : null;
        },
        newId: () => `req${"7".padStart(40, "A")}`,
        tell: (o: GoogleCallbackOutcome) => void told.push(o),
      },
    };
  }

  it("scrubs the address first, sends the connect once, and tells the sheet one word", async () => {
    const x = deps(`?code=4%2Fabc&state=${STATE}`, { [GOOGLE_CONNECT_PATH]: [ok({ google: GOOGLE_CONNECTED, outcome: "connected" })] });
    expect(await runGoogleCallback(x.d)).toBe("connected");
    expect(x.order).toEqual(["scrub", "signedIn"]);
    expect(x.calls).toEqual([{ path: GOOGLE_CONNECT_PATH, body: { requestId: `req${"7".padStart(40, "A")}`, code: "4/abc", state: STATE } }]);
    expect(x.told).toEqual(["connected"]);
  });

  it("a denial, a malformed query or a code the contract refuses sends nothing", async () => {
    for (const search of ["?error=access_denied", "?state=x", `?code=${"x".repeat(600)}&state=${STATE}`, `?code=4%2Fabc&state=short`, `?code=%E2%80%AE&state=${STATE}`]) {
      const x = deps(search, {});
      const outcome = await runGoogleCallback(x.d);
      expect(outcome).toBe(search.startsWith("?error") ? "denied" : "refused");
      expect(x.order).toEqual(["scrub"]);
      expect(x.calls).toEqual([]);
      expect(x.told).toEqual([outcome]);
    }
  });

  it("no one signed in, or a call that throws, is unknown", async () => {
    const a = deps(`?code=4%2Fabc&state=${STATE}`, {}, false);
    expect(await runGoogleCallback(a.d)).toBe("unknown");
    expect(a.calls).toEqual([]);
    const b = deps(`?code=4%2Fabc&state=${STATE}`, { [GOOGLE_CONNECT_PATH]: ["throw"] });
    expect(await runGoogleCallback(b.d)).toBe("unknown");
    expect(b.told).toEqual(["unknown"]);
  });
});
