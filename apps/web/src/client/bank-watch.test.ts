// The bank sheet's shell (brief 046 part B): it runs the machine's commands through client/api.ts and its timers,
// sends nothing before the sheet opens, and nothing after sign-out.
import { describe, expect, it } from "vitest";
import { BANK_DISCONNECTED, BANK_IMPORTING, BANK_READ } from "../app/specimens/_fixtures/bank";
import { BANK_POLL_MS } from "../ui/bank/bank-machine";
import type { ApiCallOptions, ApiClient, ApiResult } from "./api";
import { BANK_CONNECT_PATH, BANK_DISCONNECT_PATH, BANK_LINK_TOKEN_PATH, BANK_STATUS_PATH, BANK_SYNC_PATH } from "./api";
import { BankWatch } from "./bank-watch";

type Answer = { status: number; body: unknown } | "throw";

function harness(routes: Record<string, Answer[]>) {
  let now = 0;
  let ids = 0;
  const calls: { path: string; body: unknown }[] = [];
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let nextId = 1;
  const api: ApiClient = {
    async call<T>(path: string, options?: ApiCallOptions): Promise<ApiResult<T>> {
      calls.push({ path, body: options?.body });
      const a = routes[path]?.shift() ?? "throw";
      if (a === "throw") throw new Error("offline");
      if (a.status >= 400) return { ok: false, kind: "http", status: a.status, error: (a.body as { error?: string }).error ?? null, retryAfterMs: 0 };
      return { ok: true, status: a.status, body: a.body as T };
    },
  };
  const watch = new BankWatch({
    api,
    now: () => now,
    newId: () => `req${String(++ids).padStart(40, "A")}`,
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
  return { watch, calls, timers, flush, advance };
}

const ok = (body: unknown): Answer => ({ status: 200, body });

describe("BankWatch", () => {
  it("sends nothing before the sheet is opened", async () => {
    const h = harness({});
    await h.flush();
    expect(h.calls).toEqual([]);
    expect(h.watch.getSnapshot().phase).toBe("unread");
  });

  it("opens, reads the list, and shows what the server answered", async () => {
    const h = harness({ [BANK_STATUS_PATH]: [ok({ banks: [BANK_READ], canConnect: true })] });
    h.watch.open();
    expect(h.watch.getSnapshot().phase).toBe("reading");
    await h.flush();
    expect(h.calls.map((c) => c.path)).toEqual([BANK_STATUS_PATH]);
    expect(h.watch.getSnapshot().banks).toEqual([BANK_READ]);
    expect(h.watch.getSnapshot().phase).toBe("idle");
  });

  it("connect: token, Link, then one connect with Link's fields and a new requestId", async () => {
    const h = harness({
      [BANK_STATUS_PATH]: [ok({ banks: [], canConnect: true }), ok({ banks: [BANK_READ], canConnect: true })],
      [BANK_LINK_TOKEN_PATH]: [ok({ linkToken: "link-1", expiresAt: "2026-11-13T23:00:00.000Z" })],
      [BANK_CONNECT_PATH]: [ok({ bank: BANK_READ, existing: false })],
    });
    h.watch.open();
    await h.flush();
    h.watch.connect();
    await h.flush();
    const s = h.watch.getSnapshot();
    expect(s.phase).toBe("linking");
    expect(s.link?.linkToken).toBe("link-1");
    h.watch.linkOpened(s.link!.session);
    h.watch.linkSuccess(s.link!.session, { publicToken: "public-1", institutionId: "ins_1", institutionName: "x".repeat(200) });
    await h.flush();
    const connect = h.calls.find((c) => c.path === BANK_CONNECT_PATH)!;
    expect(connect.body).toEqual({ requestId: `req${"1".padStart(40, "A")}`, publicToken: "public-1", institutionId: "ins_1", institutionName: null });
    expect(h.watch.getSnapshot().note).toBe("connected");
    expect(h.calls.filter((c) => c.path === BANK_CONNECT_PATH)).toHaveLength(1);
  });

  it("a refused connect is never sent again; Connect starts a new Link session", async () => {
    const h = harness({
      [BANK_STATUS_PATH]: [ok({ banks: [], canConnect: true })],
      [BANK_LINK_TOKEN_PATH]: [ok({ linkToken: "link-1", expiresAt: "2026-11-13T23:00:00.000Z" }), ok({ linkToken: "link-2", expiresAt: "2026-11-13T23:00:00.000Z" })],
      [BANK_CONNECT_PATH]: [{ status: 409, body: { error: "STALE" } }],
    });
    h.watch.open();
    await h.flush();
    h.watch.connect();
    await h.flush();
    const first = h.watch.getSnapshot().link!.session;
    h.watch.linkSuccess(first, { publicToken: "public-1", institutionId: null, institutionName: null });
    await h.flush();
    expect(h.watch.getSnapshot().note).toBe("connectRefused");
    h.watch.connect();
    await h.flush();
    const s = h.watch.getSnapshot();
    expect(s.link?.linkToken).toBe("link-2");
    expect(s.link!.session).not.toBe(first);
    expect(h.calls.filter((c) => c.path === BANK_CONNECT_PATH)).toHaveLength(1);
  });

  it("polls an importing bank with sync on the calm interval, and stops once it is imported", async () => {
    const h = harness({
      [BANK_STATUS_PATH]: [ok({ banks: [BANK_IMPORTING], canConnect: true })],
      [BANK_SYNC_PATH]: [ok({ bank: BANK_IMPORTING }), ok({ bank: BANK_READ })],
    });
    h.watch.open();
    await h.flush();
    await h.advance(BANK_POLL_MS - 1);
    expect(h.calls.filter((c) => c.path === BANK_SYNC_PATH)).toHaveLength(0);
    await h.advance(1);
    expect(h.calls.filter((c) => c.path === BANK_SYNC_PATH)).toEqual([{ path: BANK_SYNC_PATH, body: { connectorId: BANK_IMPORTING.connectorId } }]);
    await h.advance(BANK_POLL_MS);
    expect(h.calls.filter((c) => c.path === BANK_SYNC_PATH)).toHaveLength(2);
    expect(h.watch.getSnapshot().banks).toEqual([BANK_READ]);
    expect(h.timers).toEqual([]);
    await h.advance(BANK_POLL_MS * 3);
    expect(h.calls.filter((c) => c.path === BANK_SYNC_PATH)).toHaveLength(2);
  });

  it("disconnect asks first; Yes sends one disconnect, Not now sends nothing", async () => {
    const h = harness({
      [BANK_STATUS_PATH]: [ok({ banks: [BANK_READ], canConnect: true }), ok({ banks: [], canConnect: true })],
      [BANK_DISCONNECT_PATH]: [ok({ bank: BANK_DISCONNECTED })],
    });
    h.watch.open();
    await h.flush();
    h.watch.askDisconnect(BANK_READ.connectorId);
    h.watch.notNow();
    expect(h.calls.filter((c) => c.path === BANK_DISCONNECT_PATH)).toHaveLength(0);
    h.watch.askDisconnect(BANK_READ.connectorId);
    h.watch.confirmDisconnect();
    await h.flush();
    expect(h.calls.filter((c) => c.path === BANK_DISCONNECT_PATH)).toHaveLength(1);
    expect(h.watch.getSnapshot().banks).toEqual([]);
    expect(h.watch.getSnapshot().note).toBe("disconnected");
  });

  it("after stop, nothing more is sent and a late answer is dropped", async () => {
    let release: (a: ApiResult<unknown>) => void = () => {};
    const calls: string[] = [];
    const api: ApiClient = {
      call<T>(path: string) {
        calls.push(path);
        return new Promise<ApiResult<T>>((r) => {
          release = r as (a: ApiResult<unknown>) => void;
        });
      },
    };
    const watch = new BankWatch({ api, now: () => 0, newId: () => "x" });
    watch.start();
    watch.open();
    watch.stop();
    watch.start();
    release({ ok: true, status: 200, body: { banks: [BANK_READ], canConnect: true } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(watch.getSnapshot().banks).toBeNull();
    expect(watch.getSnapshot().phase).toBe("unread");
    watch.stop();
    watch.open();
    expect(calls).toEqual([BANK_STATUS_PATH]);
  });
});
