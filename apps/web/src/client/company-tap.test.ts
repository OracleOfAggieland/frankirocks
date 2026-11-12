/* eslint-disable @typescript-eslint/no-explicit-any -- the test reads request bodies. */
// Brief 044, item 3: the company toggle's tap goes to /api/turn as a trusted tap, and the toggle shows only what
// the server last confirmed.
import { describe, expect, it } from "vitest";
import { COPY } from "../ui/copy";
import type { ApiClient, ApiResult } from "./api";
import { CompanyTap } from "./company-tap";

const SS = { sessionId: "s".repeat(43), epoch: 1, policyRev: 2, bundleRev: 3, rulesRev: 4, generation: 1 };
const answer = (status: string, policyRev = 3) => ({
  requestId: "r".repeat(43),
  stamp: { ...SS, policyRev, turnId: "t".repeat(43) },
  status,
  deck: null,
  permit: null,
  notes: [],
  cards: [],
  pendingId: null,
  question: null,
  retryAfterMs: 0,
  receiptId: null,
  error: null,
});

function build(reply: (body: any) => ApiResult<unknown>, opts: { call?: typeof SS | null } = {}) {
  const posts: any[] = [];
  const adopted: unknown[] = [];
  let n = 0;
  const api: ApiClient = {
    async call<T>(path: string, init?: { body?: unknown }) {
      if (path === "/api/turn") posts.push(init?.body);
      return reply(init?.body) as ApiResult<T>;
    },
  };
  const tap = new CompanyTap({
    api,
    newId: () => `${String(++n).padStart(43, "i")}`,
    worldNow: () => 1_700_000_000_000,
    stampFor: async () => (opts.call === undefined || opts.call === null ? { stamp: SS, typed: true } : { stamp: opts.call, typed: false }),
    adoptTypedStamp: (s) => adopted.push(s),
  });
  return { tap, posts, adopted };
}

describe("CompanyTap (brief 044, item 3)", () => {
  it("posts a trusted company tap with no words and no targets, and shows company only once the server answers", async () => {
    const { tap, posts, adopted } = build(() => ({ ok: true, status: 200, body: answer("ready") }));
    expect(tap.getSnapshot().company).toBe(false);
    const p = tap.tap("company");
    // While the tap is in flight the toggle shows what the server last said, not the guess.
    expect(tap.getSnapshot()).toMatchObject({ company: false, sending: true });
    await p;
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ ...SS, source: "trustedTap", transcript: "", items: [], judge: "typed", uiControl: { verb: "company", targetIds: [] } });
    expect(tap.getSnapshot()).toMatchObject({ company: true, sending: false, error: null });
    expect(adopted).toHaveLength(1);
  });

  it("with a call open, taps on the call's Session and leaves the typed stamp alone", async () => {
    const call = { ...SS, sessionId: "c".repeat(43) };
    const { tap, posts, adopted } = build(() => ({ ok: true, status: 200, body: { ...answer("blocked"), stamp: { ...answer("blocked").stamp, sessionId: call.sessionId } } }), { call });
    await tap.tap("company");
    expect(posts[0].sessionId).toBe(call.sessionId);
    expect(tap.getSnapshot().company).toBe(true);
    expect(adopted).toHaveLength(0);
  });

  it("a refused or failed tap changes nothing the toggle shows", async () => {
    const { tap } = build(() => ({ ok: false, kind: "http", status: 503, error: "DEPENDENCY", retryAfterMs: 0 }));
    await tap.tap("company");
    expect(tap.getSnapshot()).toMatchObject({ company: false, sending: false });
    expect(tap.getSnapshot().error).not.toBeNull();
  });

  it("a stale alone tap is sent once more with the answer's stamp", async () => {
    let n = 0;
    const { tap, posts } = build(() => ({ ok: true, status: 200, body: answer(++n === 1 ? "stale" : "ready", 5) }));
    await tap.tap("alone");
    expect(posts).toHaveLength(2);
    expect(posts[1].policyRev).toBe(5);
    expect(tap.getSnapshot().company).toBe(false);
  });

  it("with no Session to tap on, sends nothing", async () => {
    const posts: unknown[] = [];
    const tap = new CompanyTap({
      api: { call: async (path: string, init?: { body?: unknown }) => (posts.push(init?.body), { ok: true, status: 200, body: answer("ready") }) as never },
      newId: () => "i".repeat(43),
      worldNow: () => 0,
      stampFor: async () => COPY.company.betweenCalls,
      adoptTypedStamp: () => {},
    });
    expect(await tap.tap("company")).toBe(false);
    expect(posts).toEqual([]);
    expect(tap.getSnapshot()).toMatchObject({ company: false, error: COPY.company.betweenCalls });
  });

  it("clear forgets what the server said", async () => {
    const { tap } = build(() => ({ ok: true, status: 200, body: answer("ready") }));
    await tap.tap("company");
    tap.clear();
    expect(tap.getSnapshot().company).toBe(false);
  });
});
