import { describe, expect, it } from "vitest";
import { ADVANCE_ANSWER, CLONE_WORLD, PROACTIVE_ANSWER, RESET_ANSWER, THURSDAY_WORLD, vid } from "../app/specimens/_fixtures/visit";
import { type FetchLike, createApiClient } from "./api";
import { ADVANCE_PATH, PERSONA_FIXTURE_ID, RESET_PATH, VISIT_STORAGE_PREFIX } from "./seed-guesses";
import { CALL_END_LIMIT_MS, type CallLike, VisitModel, parseStoredVisit } from "./visit-model";

const flush = () => new Promise((r) => setTimeout(r, 0));

function memoryStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

function harness(opts: { answer?: (url: string, body: unknown) => Response; storage?: ReturnType<typeof memoryStorage>; call?: CallLike | null } = {}) {
  const seen: { url: string; body: unknown }[] = [];
  const answer = opts.answer ?? ((url: string) => Response.json(url === RESET_PATH ? RESET_ANSWER : ADVANCE_ANSWER));
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init.body));
    seen.push({ url, body });
    return answer(url, body);
  };
  const storage = opts.storage ?? memoryStorage();
  const shown: unknown[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let resets = 0;
  let ids = 0;
  const model = new VisitModel({
    api: createApiClient({ getToken: async () => "tok", fetch }),
    uid: "u1",
    storage,
    newId: () => vid(`id${++ids}`),
    call: opts.call ?? null,
    zone: () => "America/Chicago",
    sessionId: () => null,
    onShow: (p) => shown.push(p),
    onAfterReset: () => void resets++,
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => {},
  });
  return { model, seen, storage, shown, timers, afterResets: () => resets };
}

const KEY = `${VISIT_STORAGE_PREFIX}u1`;

describe("VisitModel", () => {
  it("first entry stores a visit ID, calls reset once with it, and keeps the month", async () => {
    const h = harness();
    h.model.enter();
    expect(parseStoredVisit(h.storage.data.get(KEY) ?? null)).toEqual({ visitId: vid("id1"), fixtureNamespace: null, worldClockMs: null });
    await flush();
    expect(h.seen).toEqual([{ url: RESET_PATH, body: { requestId: vid("id2"), sessionId: null, fixtureId: PERSONA_FIXTURE_ID, visitId: vid("id1"), clientZone: "America/Chicago" } }]);
    expect(h.model.getSnapshot()).toMatchObject({ phase: "ready", worldMs: Date.parse(CLONE_WORLD) });
    expect(parseStoredVisit(h.storage.data.get(KEY) ?? null)).toEqual({ visitId: vid("id1"), fixtureNamespace: RESET_ANSWER.fixtureNamespace, worldClockMs: Date.parse(CLONE_WORLD) });
    expect(h.afterResets()).toBe(1);
  });

  it("a reload keeps the same month and sends nothing", async () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ visitId: vid("old"), fixtureNamespace: vid("ns"), worldClockMs: Date.parse(CLONE_WORLD) }) });
    const h = harness({ storage });
    h.model.enter();
    await flush();
    expect(h.seen).toEqual([]);
    expect(h.model.getSnapshot()).toMatchObject({ phase: "ready", visit: { visitId: vid("old") } });
  });

  it("a failed clone shows try again, and try again resets with a new visit ID", async () => {
    let fail = true;
    const h = harness({ answer: () => (fail ? Response.json({ error: "DEPENDENCY", retryAfterMs: 0 }, { status: 503 }) : Response.json(RESET_ANSWER)) });
    h.model.enter();
    await flush();
    expect(h.model.getSnapshot()).toMatchObject({ phase: "failed", failure: "clone" });
    fail = false;
    h.model.retry();
    await flush();
    expect(h.seen.map((s) => (s.body as { visitId: string }).visitId)).toEqual([vid("id1"), vid("id3")]);
    expect(h.model.getSnapshot().phase).toBe("ready");
  });

  it("the bolt advances and shows the proactive line", async () => {
    const h = harness();
    h.model.enter();
    await flush();
    h.model.press(Date.parse(THURSDAY_WORLD));
    await flush();
    expect(h.seen[1]).toEqual({ url: ADVANCE_PATH, body: { requestId: vid("id3"), fixtureNamespace: RESET_ANSWER.fixtureNamespace, to: THURSDAY_WORLD } });
    expect(h.shown).toEqual([PROACTIVE_ANSWER]);
    expect(h.model.getSnapshot()).toMatchObject({ bolt: "idle", worldMs: Date.parse(THURSDAY_WORLD) });
  });

  it("a barrier holds the bolt until the wait is over", async () => {
    const h = harness({ answer: (url) => (url === RESET_PATH ? Response.json(RESET_ANSWER) : Response.json({ error: "BARRIER", retryAfterMs: 1500 }, { status: 423 })) });
    h.model.enter();
    await flush();
    h.model.press(Date.parse(THURSDAY_WORLD));
    await flush();
    expect(h.model.getSnapshot().bolt).toBe("waiting");
    expect(h.timers.at(-1)!.ms).toBe(1500);
    h.timers.at(-1)!.fn();
    expect(h.model.getSnapshot().bolt).toBe("idle");
  });

  it("start over during a call hangs up, waits for the call to close, then resets", async () => {
    let open = true;
    const listeners = new Set<() => void>();
    let hungUp = 0;
    const call: CallLike = {
      inCall: () => open,
      hangUp: () => void hungUp++,
      subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    };
    const h = harness({ call });
    h.model.enter();
    await flush();
    h.model.askStartOver();
    h.model.confirmStartOver();
    expect(hungUp).toBe(1);
    expect(h.model.getSnapshot()).toMatchObject({ phase: "resetting", endingCall: true });
    await flush();
    expect(h.seen).toHaveLength(1);
    open = false;
    for (const l of listeners) l();
    await flush();
    expect(h.seen).toHaveLength(2);
    expect(h.model.getSnapshot().phase).toBe("ready");
    expect(h.afterResets()).toBe(2);
  });

  it("a call that never closes stops holding the reset after the limit", async () => {
    const call: CallLike = { inCall: () => true, hangUp: () => {}, subscribe: () => () => {} };
    const h = harness({ call });
    h.model.enter();
    await flush();
    h.model.askStartOver();
    h.model.confirmStartOver();
    const limit = h.timers.find((t) => t.ms === CALL_END_LIMIT_MS)!;
    limit.fn();
    await flush();
    expect(h.seen).toHaveLength(2);
  });

  it("stop drops later answers", async () => {
    const h = harness();
    h.model.enter();
    h.model.stop();
    await flush();
    expect(h.model.getSnapshot().phase).toBe("cloning");
  });

  it("reads a stored visit fail-closed", () => {
    expect(parseStoredVisit(null)).toBeNull();
    expect(parseStoredVisit("{not json")).toBeNull();
    expect(parseStoredVisit(JSON.stringify({ visitId: "" }))).toBeNull();
    expect(parseStoredVisit(JSON.stringify({ visitId: "v", fixtureNamespace: 3, worldClockMs: "x" }))).toEqual({ visitId: "v", fixtureNamespace: null, worldClockMs: null });
  });

  it("a LIVE answer is stored, and a reload of a real account is live with no reset (brief 038 finding 1)", async () => {
    const h = harness({ answer: () => Response.json({ error: "LIVE", retryAfterMs: 0 }, { status: 409 }) });
    h.model.enter();
    await flush();
    expect(h.model.getSnapshot().phase).toBe("live");
    expect(parseStoredVisit(h.storage.data.get(KEY) ?? null)).toEqual({ visitId: vid("id1"), fixtureNamespace: null, worldClockMs: null, live: true });
    const again = harness({ storage: h.storage });
    again.model.enter();
    await flush();
    expect(again.model.getSnapshot().phase).toBe("live");
    expect(again.seen).toEqual([]);
  });

  it("a bolt answered STALE takes up the newer visit another tab stored (brief 038 finding 4)", async () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ visitId: vid("old"), fixtureNamespace: vid("ns"), worldClockMs: Date.parse(CLONE_WORLD) }) });
    const h = harness({ storage, answer: () => Response.json({ error: "STALE", retryAfterMs: 0 }, { status: 409 }) });
    h.model.enter();
    // Tab B starts over and stores its new visit.
    storage.data.set(KEY, JSON.stringify({ visitId: vid("new"), fixtureNamespace: vid("ns2"), worldClockMs: Date.parse(THURSDAY_WORLD) }));
    h.model.press(Date.parse(THURSDAY_WORLD) + 3_600_000);
    await flush();
    expect(h.model.getSnapshot()).toMatchObject({ phase: "ready", visit: { visitId: vid("new"), fixtureNamespace: vid("ns2") }, worldMs: Date.parse(THURSDAY_WORLD) });
    expect(h.afterResets()).toBe(1);
  });
});
