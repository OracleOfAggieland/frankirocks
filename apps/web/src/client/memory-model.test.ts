import { describe, expect, it, vi } from "vitest";
import { FIXTURE_MEMORY } from "../app/specimens/_fixtures/memory";
import type { ApiCallOptions, ApiClient, ApiResult } from "./api";
import { MAIN_CHIPS, MemoryModel } from "./memory-model";

function api(answer: (view: string, cursor: string | null) => unknown | null) {
  const calls: { path: string; query: ApiCallOptions["query"] }[] = [];
  const client: ApiClient = {
    async call<T>(path: string, options: ApiCallOptions = {}) {
      calls.push({ path, query: options.query });
      const body = answer(String(options.query?.view), (options.query?.cursor as string | null | undefined) ?? null);
      return (body === null ? { ok: false, kind: "http", status: 503, error: "DEPENDENCY", retryAfterMs: 0 } : { ok: true, status: 200, body }) as ApiResult<T>;
    },
  };
  return { client, calls };
}

const fixture = (view: string) => (FIXTURE_MEMORY as Record<string, unknown>)[view] ?? null;

describe("MemoryModel (brief 020)", () => {
  it("refresh reads the four views from GET /api/memory and fills the surfaces", async () => {
    const { client, calls } = api(fixture);
    const m = new MemoryModel({ api: client });
    await m.refresh();
    expect(calls.map((c) => [c.path, c.query?.view]).sort()).toEqual([
      ["/api/memory", "lab"],
      ["/api/memory", "overview"],
      ["/api/memory", "receipt"],
      ["/api/memory", "strip"],
    ]);
    const s = m.getSnapshot().surfaces;
    expect(s.jar.length).toBe(8);
    expect(s.lab?.counters[0]?.value).toBe(128);
    expect(s.strip?.filled).toBe(4);
    expect(s.receipt?.cleaned).toBe(true);
  });

  it("an invalid or failed read shows nothing, and keeps what the last good read showed", async () => {
    let good = false;
    const { client } = api((view) => (good ? fixture(view) : view === "lab" ? { not: "a response" } : null));
    const m = new MemoryModel({ api: client });
    await m.refresh();
    expect(m.getSnapshot().surfaces).toEqual({ jar: [], lab: null, strip: null, receipt: null });
    good = true;
    await m.refresh();
    good = false;
    await m.refresh();
    expect(m.getSnapshot().surfaces.lab?.counters[0]?.value).toBe(128);
  });

  it("the readout reads every overview page in order", async () => {
    const first = FIXTURE_MEMORY.overview.snapshot!;
    const page1 = { ...FIXTURE_MEMORY.overview, snapshot: { ...first, cursor: first.cards[3]!.id } };
    const page2 = { ...FIXTURE_MEMORY.overview, snapshot: { ...first, cards: [], cursor: null } };
    const { client, calls } = api((_v, cursor) => (cursor === null ? page1 : page2));
    const m = new MemoryModel({ api: client });
    await m.openReadout();
    expect(calls.map((c) => c.query?.cursor ?? null)).toEqual([null, page1.snapshot.cursor]);
    expect(m.getSnapshot().readout).toHaveLength(2);
    m.closeReadout();
    expect(m.getSnapshot().readout).toBeNull();
  });

  it("a tap on the chip opens the readout, and a second tap closes it without another read", async () => {
    const { client, calls } = api(fixture);
    const m = new MemoryModel({ api: client });
    expect(m.toggleReadout()).toBe("opening");
    await vi.waitFor(() => expect(m.getSnapshot().readout).not.toBeNull());
    const reads = calls.length;
    expect(m.toggleReadout()).toBe("closed");
    expect(m.getSnapshot().readout).toBeNull();
    expect(calls).toHaveLength(reads);
    expect(m.toggleReadout()).toBe("opening");
    await vi.waitFor(() => expect(m.getSnapshot().readout).not.toBeNull());
  });

  it("false gone: a claimed gone with no receipt shows the ask, and the answer goes to the control seam", () => {
    const { client } = api(fixture);
    const answers: string[] = [];
    const m = new MemoryModel({ api: client, goneControl: (a) => answers.push(a) });
    m.onReply({ transcript: "forget my brother", lines: ["Gone."], receiptId: null });
    expect(m.getSnapshot().goneAsk).toBe(true);
    m.answerGone("yes");
    expect(m.getSnapshot().goneAsk).toBe(false);
    expect(answers).toEqual(["yes"]);
    m.onReply({ transcript: "forget my brother", lines: ["Gone."], receiptId: "r".repeat(43) });
    expect(m.getSnapshot().goneAsk).toBe(false);
    m.onReply({ transcript: "hello", lines: ["Hi there."], receiptId: null });
    expect(m.getSnapshot().goneAsk).toBe(false);
  });

  it("the chip is the code constant of spec §15", () => {
    expect(MAIN_CHIPS).toEqual(["What do you know about me?"]);
  });

  it("clear drops everything it holds", async () => {
    const { client } = api(fixture);
    const m = new MemoryModel({ api: client });
    await m.refresh();
    await m.openReadout();
    m.clear();
    expect(m.getSnapshot()).toEqual({ surfaces: { jar: [], lab: null, strip: null, receipt: null }, readout: null, goneAsk: false });
  });
});
