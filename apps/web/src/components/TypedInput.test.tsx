import { type SS, type TurnRequest, type W } from "@franki/core";
import { testId } from "@franki/core/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ApiCallOptions, type ApiClient, type ApiResult, createApiClient } from "../client/api";
import { createBrowserClock } from "../client/clock";
import { TURN_TIMEOUT_MS, TypedTurns } from "../client/typed-turns";
import { ConversationView, TypedInput } from "./TypedInput";

const SESSION = testId("session");
const SS0: SS = { sessionId: SESSION, epoch: 0, policyRev: 0, bundleRev: 1, rulesRev: 0, generation: 1 };
const ACK = { stamp: SS0, issuedOpsAt: "2026-11-03T12:00:00.000Z", expiresOpsAt: "2026-11-03T12:00:10.000Z" };
const OPEN_OK = { sessionId: SESSION, generation: 1, deck: null, state: "connecting", ack: ACK, proactive: null };

const note = (text: string): W => ({
  noteId: testId(`note-${text.length}`),
  rev: 1,
  kind: "result",
  text,
  rootKeys: [],
  dependsOn: [],
  sens: "S0",
  expiresAt: "2026-11-03T12:00:10.000Z",
  unprompted: false,
  momentId: null,
  tokens: [],
});

const turnOk = (req: TurnRequest, notes: W[] = []) => ({
  requestId: req.requestId,
  stamp: { ...SS0, turnId: req.turnId },
  status: "ordinary",
  deck: null,
  permit: null,
  notes,
  cards: [],
  pendingId: null,
  question: null,
  retryAfterMs: 0,
  receiptId: null,
  error: null,
});

type Handler = (path: string, body: unknown) => ApiResult<unknown> | Promise<ApiResult<unknown>>;

/** An ApiClient that records each call and answers through `handler`. */
function fakeApi(handler: Handler) {
  const calls: { path: string; body: unknown }[] = [];
  const api: ApiClient = {
    async call<T>(path: string, options: ApiCallOptions = {}) {
      calls.push({ path, body: options.body });
      return (await handler(path, options.body)) as ApiResult<T>;
    },
  };
  return { api, calls, turns: () => calls.filter((c) => c.path === "/api/turn").map((c) => c.body as TurnRequest) };
}

const ok = (body: unknown): ApiResult<unknown> => ({ ok: true, status: 200, body });
const clock = () => createBrowserClock({ zone: "America/Chicago", monotonic: { timeOrigin: 1_793_707_200_000, now: () => 0 } });
let idCounter = 0;
const newId = () => testId(`id${++idCounter}`);

function rig(handler?: Handler) {
  const f = fakeApi(handler ?? ((path, body) => (path === "/api/session/open" ? ok(OPEN_OK) : ok(turnOk(body as TurnRequest, [note("Got it.")])))));
  const typed = new TypedTurns({ api: f.api, clock: clock(), newId, sleep: async () => {} });
  return { ...f, typed };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TypedInput (R18)", () => {
  it("disabled when empty", async () => {
    const markup = (canSend: boolean, enabled = true) =>
      renderToStaticMarkup(<TypedInput text="" enabled={enabled} sending={false} canSend={canSend} error={null} onChange={() => {}} onSubmit={() => {}} />);
    expect(markup(false)).toMatch(/<button type="submit" disabled=""/);
    expect(markup(true)).not.toMatch(/<button type="submit" disabled=""/);
    // Signed out: box and button both disabled (R9.4).
    expect(markup(true, false)).toMatch(/<textarea[^>]*disabled=""[\s\S]*<button type="submit" disabled=""/);

    const { typed, calls } = rig();
    for (const text of ["", "   ", "\n\t "]) {
      typed.setText(text);
      expect(typed.canSend()).toBe(false);
      expect(await typed.submit()).toBe(false);
    }
    typed.setText("x".repeat(8193));
    expect(typed.canSend()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("one request per press", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { typed, calls, turns } = rig(async (path, body) => {
      if (path === "/api/session/open") return ok(OPEN_OK);
      await gate;
      return ok(turnOk(body as TurnRequest));
    });
    typed.setText("My dog is called Pip");
    const first = typed.submit();
    // While the request is in flight, the send control is disabled and further presses send nothing (R18.9).
    await vi.waitFor(() => expect(turns()).toHaveLength(1));
    expect(typed.getSnapshot().sending).toBe(true);
    expect(typed.canSend()).toBe(false);
    expect(await typed.submit()).toBe(false);
    expect(await typed.submit()).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["/api/session/open", "/api/turn"]);
    const req = turns()[0]!;
    expect(req).toMatchObject({ source: "typed", items: [], judge: "typed", transcriptState: "final", transcript: "My dog is called Pip", ...SS0 });
  });

  it("keeps text on error", async () => {
    const { typed } = rig((path) => (path === "/api/session/open" ? ok(OPEN_OK) : { ok: false, kind: "http", status: 500, error: "DEPENDENCY", retryAfterMs: 0 }));
    typed.setText("My dog is called Pip");
    expect(await typed.submit()).toBe(false);
    const s = typed.getSnapshot();
    expect(s.text).toBe("My dog is called Pip");
    expect(s.error).toMatch(/Not sent/);
    expect(s.entries).toEqual([]);
    expect(s.sending).toBe(false);
    expect(typed.canSend()).toBe(true);
  });

  it("keeps text on a 10 s timeout", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    // The real ApiClient with a fetch that never answers /api/turn; only its 10 s timer ends the wait.
    const api = createApiClient({
      getToken: async () => "tok",
      fetch: (url, init) => {
        seen.push(url);
        if (url === "/api/session/open") return Promise.resolve(Response.json(OPEN_OK));
        return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      },
    });
    const typed = new TypedTurns({ api, clock: clock(), newId });
    typed.setText("hello");
    const done = typed.submit();
    // Settle promises without moving fake time (vi.waitFor would advance it).
    for (let i = 0; i < 50 && seen.length < 2; i++) await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(["/api/session/open", "/api/turn"]);
    await vi.advanceTimersByTimeAsync(TURN_TIMEOUT_MS - 1);
    expect(typed.getSnapshot(), "still waiting just before 10 s").toMatchObject({ sending: true, error: null });
    await vi.advanceTimersByTimeAsync(1);
    expect(await done).toBe(false);
    const s = typed.getSnapshot();
    expect(s).toMatchObject({ text: "hello", sending: false, entries: [] });
    expect(s.error).toMatch(/10 seconds/);
    expect(typed.canSend()).toBe(true);
  });

  it("clientSeq increments by 1", async () => {
    let failNext = false;
    const { typed, turns } = rig((path, body) => {
      if (path === "/api/session/open") return ok(OPEN_OK);
      if (failNext) {
        failNext = false;
        return { ok: false, kind: "timeout" };
      }
      return ok(turnOk(body as TurnRequest));
    });
    for (const line of ["one", "two", "three"]) {
      typed.setText(line);
      expect(await typed.submit()).toBe(true);
    }
    // A failed line keeps its clientSeq; resending the same text repeats the same request (replay-safe).
    failNext = true;
    typed.setText("four");
    expect(await typed.submit()).toBe(false);
    expect(await typed.submit()).toBe(true);
    typed.setText("five");
    expect(await typed.submit()).toBe(true);

    const reqs = turns();
    expect(reqs.map((r) => r.clientSeq)).toEqual([1, 2, 3, 4, 4, 5]);
    expect(reqs[4]!.requestId).toBe(reqs[3]!.requestId);
    expect(reqs[4]!.turnId).toBe(reqs[3]!.turnId);
    expect(new Set(reqs.map((r) => r.requestId)).size).toBe(5);
    expect(typed.getSnapshot().lastClientSeq).toBe(5);
  });

  it("shows the reply as text in the conversation view, with stored markup escaped", async () => {
    const { typed } = rig();
    typed.setText("<b>hi</b>");
    expect(await typed.submit()).toBe(true);
    const s = typed.getSnapshot();
    expect(s.text).toBe("");
    expect(s.entries.map((e) => [e.role, e.text])).toEqual([
      ["user", "<b>hi</b>"],
      ["franki", "Got it."],
    ]);
    const html = renderToStaticMarkup(<ConversationView entries={s.entries} />);
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("opens a new Session after the old one is gone, starting clientSeq at 1", async () => {
    let gone = false;
    const { typed, calls, turns } = rig((path, body) => {
      if (path === "/api/session/open") return ok(OPEN_OK);
      if (gone) {
        gone = false;
        return { ok: false, kind: "http", status: 409, error: "STALE", retryAfterMs: 0 };
      }
      return ok(turnOk(body as TurnRequest));
    });
    typed.setText("one");
    await typed.submit();
    gone = true;
    typed.setText("two");
    expect(await typed.submit()).toBe(false);
    expect(await typed.submit()).toBe(true);
    expect(calls.filter((c) => c.path === "/api/session/open")).toHaveLength(2);
    expect(turns().map((r) => r.clientSeq)).toEqual([1, 2, 1]);
  });
});
