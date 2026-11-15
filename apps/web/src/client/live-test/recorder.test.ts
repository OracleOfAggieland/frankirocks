import { describe, expect, it } from "vitest";
import { BATCH_EVENTS, MAX_FIELD, MAX_QUEUE, POST_MAX_EVENTS, type PostResult, Recorder, chunks, cleanFields } from "./recorder";

function rig(answers: (PostResult | "throw" | "hang")[] = []) {
  let mono = 1000.04;
  const posts: { events: Record<string, unknown>[] }[] = [];
  const exits: string[] = [];
  let tickFn: (() => void) | null = null;
  let pending: (() => void) | null = null;
  const rec = new Recorder({
    clock: { mono: () => mono, epoch: () => 1_763_159_000_000 + mono },
    pageId: "page-1",
    post: async (body) => {
      posts.push(JSON.parse(body));
      const a = answers.shift() ?? "ok";
      if (a === "throw") throw new Error("boom");
      if (a === "hang") return new Promise<PostResult>((r) => (pending = () => r("ok")));
      return a;
    },
    postOnExit: (body) => exits.push(body),
    timers: { setInterval: (fn) => ((tickFn = fn), 1), clearInterval: () => (tickFn = null) },
    step: () => "B2",
  });
  return {
    rec,
    posts,
    exits,
    advance: (ms: number) => (mono += ms),
    tick: () => tickFn?.(),
    ticking: () => tickFn !== null,
    release: () => pending?.(),
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("live test recorder", () => {
  it("stamps t, src, kind, m, page and seq on each event", async () => {
    const r = rig();
    r.rec.emit("api.call", { route: "turn", status: 200, ms: 12.34 });
    r.advance(5);
    r.rec.emit("voice.cmd", { type: "send" });
    await r.rec.flush();
    expect(r.posts).toHaveLength(1);
    const [a, b] = r.posts[0]!.events;
    expect(a).toEqual({ route: "turn", status: 200, ms: 12.34, t: 1_763_159_001_000, src: "client", kind: "api.call", m: 1000, page: "page-1", seq: 0 });
    expect(b).toMatchObject({ kind: "voice.cmd", type: "send", seq: 1, m: 1005 });
  });

  it("keeps only flat allowed values and caps strings", () => {
    const long = "x".repeat(MAX_FIELD + 50);
    expect(cleanFields({ a: "s", b: 1, c: true, d: ["x", "y"], e: null, f: undefined, g: { nested: 1 }, h: Number.NaN, i: [1, 2], j: long })).toEqual({
      a: "s",
      b: 1,
      c: true,
      d: ["x", "y"],
      j: "x".repeat(MAX_FIELD),
    });
  });

  it("never writes words through emit; words carry the runner's step", async () => {
    const r = rig();
    r.rec.emit("words.owner", { text: "hello" });
    r.rec.emit("note", { text: "hello" });
    r.rec.words("words.franki", "Hi there", { responseId: "resp_1" });
    await r.rec.flush();
    expect(r.posts[0]!.events).toHaveLength(1);
    expect(r.posts[0]!.events[0]).toMatchObject({ kind: "words.franki", text: "Hi there", responseId: "resp_1", step: "B2" });
  });

  it("posts on the one-second tick, and at once when 200 events wait", async () => {
    const r = rig();
    r.rec.start();
    expect(r.ticking()).toBe(true);
    r.rec.emit("a");
    await settle();
    expect(r.posts).toHaveLength(0);
    r.tick();
    await settle();
    expect(r.posts).toHaveLength(1);
    for (let i = 0; i < BATCH_EVENTS; i++) r.rec.emit("b", { i });
    await settle();
    expect(r.posts).toHaveLength(2);
    expect(r.posts[1]!.events).toHaveLength(BATCH_EVENTS);
  });

  it("splits a long queue into posts within the route's limits", () => {
    const events = Array.from({ length: 450 }, (_, i) => ({ kind: "x", i }));
    const parts = chunks(events);
    expect(parts.map((p) => p.length)).toEqual([POST_MAX_EVENTS, POST_MAX_EVENTS, 50]);
    const big = Array.from({ length: 10 }, () => ({ kind: "w", text: "y".repeat(1_000) }));
    expect(chunks(big, 500, 3_000).every((p) => JSON.stringify(p).length < 3_200)).toBe(true);
  });

  it("keeps events when a post fails or throws, and sends them again in order", async () => {
    const r = rig(["failed", "throw", "ok"]);
    r.rec.emit("one");
    await r.rec.flush();
    r.rec.emit("two");
    await r.rec.flush();
    expect(r.rec.waiting).toBe(2);
    await r.rec.flush();
    expect(r.rec.waiting).toBe(0);
    expect(r.posts.at(-1)!.events.map((e) => e.kind)).toEqual(["one", "two"]);
  });

  it("holds at most 5,000 events while the route is down, then says how many it dropped", async () => {
    const r = rig(["hang"]);
    for (let i = 0; i < MAX_QUEUE + BATCH_EVENTS + 30; i++) r.rec.emit("e", { i });
    // One post of 200 is out; the rest wait, capped.
    expect(r.rec.waiting).toBe(MAX_QUEUE);
    r.release();
    for (let i = 0; i < 100 && r.rec.waiting > 0; i++) {
      await settle();
      await r.rec.flush();
    }
    const all = r.posts.flatMap((p) => p.events);
    expect(all.find((e) => e.kind === "recorder.dropped")).toMatchObject({ n: 30 });
    // The newest events survive; the oldest waiting ones went.
    expect(all.filter((e) => e.kind === "e").at(-1)).toMatchObject({ i: MAX_QUEUE + BATCH_EVENTS + 29 });
  });

  it("sends one post at a time", async () => {
    const r = rig(["hang"]);
    r.rec.emit("a");
    const first = r.rec.flush();
    r.rec.emit("b");
    await r.rec.flush();
    expect(r.posts).toHaveLength(1);
    r.release();
    await first;
    expect(r.posts).toHaveLength(2);
  });

  it("stops and drops everything when the route says the recorder is off", async () => {
    const r = rig(["inactive"]);
    r.rec.start();
    r.rec.emit("a");
    await r.rec.flush();
    expect(r.rec.off).toBe(true);
    expect(r.ticking()).toBe(false);
    r.rec.emit("b");
    expect(r.rec.waiting).toBe(0);
  });

  it("flushes what fits at page hide", () => {
    const r = rig();
    r.rec.emit("a");
    r.rec.flushOnExit();
    expect(JSON.parse(r.exits[0]!).events[0]).toMatchObject({ kind: "a" });
    expect(r.rec.waiting).toBe(0);
  });

  it("never throws into the app", () => {
    const rec = new Recorder({
      clock: {
        mono: () => {
          throw new Error("clock");
        },
        epoch: () => 0,
      },
      pageId: "p",
      post: async () => "ok",
      timers: {
        setInterval: () => {
          throw new Error("timers");
        },
        clearInterval: () => {},
      },
      step: () => {
        throw new Error("step");
      },
    });
    expect(() => {
      rec.start();
      rec.emit("a");
      rec.words("words.typed", "x");
      rec.note("B1", "x");
      rec.flushOnExit();
    }).not.toThrow();
  });

  it("posts runner events as src runner, with notes as their own kind", async () => {
    const posts: string[] = [];
    const rec = new Recorder({ clock: { mono: () => 1, epoch: () => 2 }, pageId: "r", src: "runner", post: async (b) => (posts.push(b), "ok") });
    rec.emit("step.start", { step: "B2", title: "Interrupt Franki" });
    rec.note("B2", "Franki kept talking for a second");
    await rec.flush();
    const events = JSON.parse(posts[0]!).events;
    expect(events[0]).toMatchObject({ src: "runner", kind: "step.start", step: "B2" });
    expect(events[1]).toMatchObject({ src: "runner", kind: "note", step: "B2", text: "Franki kept talking for a second" });
  });
});
