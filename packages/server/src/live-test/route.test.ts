import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createFakeClock } from "@franki/core";
import { afterEach, describe, expect, it } from "vitest";
import { LIVE_TEST_MAX_BYTES, LIVE_TEST_MAX_EVENTS, type PostLiveTestInput, liveTestDeps, liveTestStatus, localOrigin, postLiveTestEvents } from "./route";

const URL_ = "http://localhost:3000/api/dev/live-test";
const ORIGIN = "http://localhost:3000";
const clock = createFakeClock({ world: 1_000, ops: 1_000, zone: "UTC" });

let dir: string | null = null;
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});
const run = () => (dir = mkdtempSync(join(tmpdir(), "live-test-route-")));

const post = (events: unknown, over: Partial<PostLiveTestInput> = {}): PostLiveTestInput => {
  const text = typeof events === "string" ? events : JSON.stringify({ events });
  return { origin: ORIGIN, url: URL_, declaredBytes: text.length, body: async () => text, ...over };
};
const lines = (d: string, f: string) => readFileSync(join(d, f), "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("live test route", () => {
  it("is off without FRANKI_LIVE_TEST_DIR: GET says so, POST writes nothing", async () => {
    const deps = liveTestDeps({}, clock);
    expect(liveTestStatus(deps)).toEqual({ status: 200, body: { active: false, run: null, events: 0, words: 0, lastAt: null, script: null } });
    expect(await postLiveTestEvents(deps, post([{ src: "client", kind: "fps" }]))).toEqual({ status: 200, body: { ok: false, active: false } });
  });

  it("is absent in production", async () => {
    const deps = liveTestDeps({ NODE_ENV: "production", FRANKI_LIVE_TEST_DIR: "/x" }, clock);
    expect(liveTestStatus(deps).status).toBe(404);
    expect((await postLiveTestEvents(deps, post([]))).status).toBe(404);
  });

  it("writes events and words to their files and counts the dropped", async () => {
    const d = run();
    const deps = liveTestDeps({ FRANKI_LIVE_TEST_DIR: d }, clock);
    const r = await postLiveTestEvents(deps, post([
      { t: 5, src: "client", kind: "page.load", path: "/lab", page: "p1", seq: 0, m: 1.5 },
      { t: 6, src: "client", kind: "words.owner", text: "Hello Franki", itemId: "i1" },
      { t: 7, src: "runner", kind: "note", step: "B2", text: "laggy" },
      { t: 8, src: "server", kind: "route.done" },
      { src: "client", kind: "x", bad: { nested: true } },
    ]));
    expect(r).toEqual({ status: 200, body: { ok: true, written: 3, dropped: 2 } });
    expect(lines(d, "events.ndjson")).toEqual([{ t: 5, src: "client", kind: "page.load", path: "/lab", page: "p1", seq: 0, m: 1.5 }]);
    expect(lines(d, "words.ndjson").map((l) => l.kind)).toEqual(["words.owner", "note"]);
    const s = liveTestStatus(deps).body;
    expect(s).toMatchObject({ active: true, run: basename(d), events: 1, words: 2, script: null });
    expect(s.lastAt).toEqual(expect.any(Number));
  });

  it("returns the parsed script, or null when it does not parse", () => {
    const d = run();
    const deps = liveTestDeps({ FRANKI_LIVE_TEST_DIR: d }, clock);
    const script = { title: "Nov 15", steps: [{ id: "B2", title: "Interrupt Franki" }] };
    writeFileSync(join(d, "script.json"), JSON.stringify(script));
    expect(liveTestStatus(deps).body.script).toEqual(script);
    writeFileSync(join(d, "script.json"), "{ nope");
    expect(liveTestStatus(deps).body.script).toBeNull();
  });

  it("accepts only the app's own localhost origin", async () => {
    const d = run();
    const deps = liveTestDeps({ FRANKI_LIVE_TEST_DIR: d }, clock);
    for (const origin of [null, "http://evil.test", "http://localhost:4000", "null"]) {
      expect((await postLiveTestEvents(deps, post([], { origin }))).status, String(origin)).toBe(403);
    }
    expect(localOrigin("https://frankirocks.com", "https://frankirocks.com/api/dev/live-test")).toBe(false);
    expect(localOrigin("http://127.0.0.1:3000", "http://127.0.0.1:3000/api/dev/live-test")).toBe(true);
  });

  it("refuses more than 500 events, more than 256 KB, and a body that is not JSON", async () => {
    const d = run();
    const deps = liveTestDeps({ FRANKI_LIVE_TEST_DIR: d }, clock);
    const many = Array.from({ length: LIVE_TEST_MAX_EVENTS + 1 }, () => ({ src: "client", kind: "fps" }));
    expect((await postLiveTestEvents(deps, post(many))).status).toBe(413);
    let read = false;
    expect((await postLiveTestEvents(deps, post([], { declaredBytes: LIVE_TEST_MAX_BYTES + 1, body: async () => ((read = true), "") }))).status).toBe(413);
    expect(read).toBe(false);
    const big = JSON.stringify({ events: [{ src: "client", kind: "words.owner", text: "x".repeat(LIVE_TEST_MAX_BYTES) }] });
    expect((await postLiveTestEvents(deps, post(big, { declaredBytes: null }))).status).toBe(413);
    expect((await postLiveTestEvents(deps, post("not json"))).status).toBe(400);
    expect((await postLiveTestEvents(deps, post(JSON.stringify({ nope: [] })))).status).toBe(400);
    expect(liveTestStatus(deps).body).toMatchObject({ events: 0, words: 0 });
  });
});
