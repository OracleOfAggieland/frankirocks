import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeClock } from "@franki/core";
import { afterEach, describe, expect, it } from "vitest";
import { EVENTS_FILE, WORDS_FILE, checkPosted, countLines, fileFor, liveTestDir, liveTestTrace, nodeFiles, serverEvent, toLines, writeLines } from "./sink";

let dir: string | null = null;
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});
const tmp = () => (dir = mkdtempSync(join(tmpdir(), "live-test-sink-")));
const clock = () => createFakeClock({ world: 1_763_159_000_000, ops: 1_763_159_000_000, zone: "UTC" });

describe("live test sink: on or off", () => {
  it("is on only with FRANKI_LIVE_TEST_DIR set and NODE_ENV not production", () => {
    expect(liveTestDir({})).toBeNull();
    expect(liveTestDir({ FRANKI_LIVE_TEST_DIR: "  " })).toBeNull();
    expect(liveTestDir({ FRANKI_LIVE_TEST_DIR: "/runs/a", NODE_ENV: "production" })).toBeNull();
    expect(liveTestDir({ FRANKI_LIVE_TEST_DIR: "/runs/a", NODE_ENV: "development" })).toBe("/runs/a");
    expect(liveTestTrace({ FRANKI_LIVE_TEST_DIR: "/runs/a", NODE_ENV: "production" }, clock())).toBeNull();
  });
});

describe("live test sink: pure helpers", () => {
  it("routes words kinds and notes to words.ndjson", () => {
    expect(fileFor("words.owner")).toBe(WORDS_FILE);
    expect(fileFor("note")).toBe(WORDS_FILE);
    expect(fileFor("route.done")).toBe(EVENTS_FILE);
    expect(fileFor("notes")).toBe(EVENTS_FILE);
  });

  it("shapes a server event: flat, reserved names kept aside, bad values dropped", () => {
    const e = serverEvent(5, "turn.repair", { turnId: "t1", kind: "x", ms: 3, n: Number.NaN, nested: { a: 1 }, ids: ["a", "b"] } as never);
    expect(e).toEqual({ t: 5, src: "server", kind: "turn.repair", turnId: "t1", kind_: "x", ms: 3, ids: ["a", "b"] });
  });

  it("checks posted events", () => {
    expect(checkPosted({ t: 9, src: "client", kind: "fps", avg: 59.9 }, 1)).toEqual({ t: 9, src: "client", kind: "fps", avg: 59.9 });
    expect(checkPosted({ src: "runner", kind: "step.start", step: "B2" }, 7)).toMatchObject({ t: 7, kind: "step.start" });
    for (const bad of [null, [], "x", { src: "server", kind: "a" }, { src: "client" }, { src: "client", kind: "" }, { src: "client", kind: "a b" }, { src: "client", kind: "a", x: { y: 1 } }, { src: "client", kind: "a", x: [1] }, { src: "client", kind: "a", t: "now" }]) {
      expect(checkPosted(bad, 1), JSON.stringify(bad)).toBeNull();
    }
  });

  it("caps strings: short in events, long in words", () => {
    const long = "x".repeat(10_000);
    expect((checkPosted({ src: "client", kind: "error", message: long }, 1)!.message as string).length).toBe(512);
    expect((checkPosted({ src: "client", kind: "words.owner", text: long }, 1)!.text as string).length).toBe(8_000);
  });

  it("writes one line per event, split by file", () => {
    const lines = toLines([serverEvent(1, "a", {}), checkPosted({ src: "client", kind: "words.typed", text: "hi" }, 2)!]);
    expect(countLines(Buffer.from(lines[EVENTS_FILE]))).toBe(1);
    expect(JSON.parse(lines[WORDS_FILE])).toEqual({ t: 2, src: "client", kind: "words.typed", text: "hi" });
  });
});

describe("live test sink: files", () => {
  it("appends whole lines and counts them back", () => {
    const d = tmp();
    const files = nodeFiles(join(d, "2026-11-14_120000"));
    expect(files.lines(EVENTS_FILE)).toBe(0);
    expect(files.lastWrite(EVENTS_FILE)).toBeNull();
    expect(files.script()).toBeNull();
    writeLines(files, [checkPosted({ src: "client", kind: "fps", avg: 60 }, 1)!, checkPosted({ src: "runner", kind: "note", text: "ok" }, 1)!]);
    writeLines(files, [checkPosted({ src: "client", kind: "fps", avg: 58 }, 2)!]);
    expect(files.run).toBe("2026-11-14_120000");
    expect(files.lines(EVENTS_FILE)).toBe(2);
    expect(files.lines(WORDS_FILE)).toBe(1);
    expect(files.lastWrite(EVENTS_FILE)).toEqual(expect.any(Number));
  });

  it("traces server events to events.ndjson with the clock's time, and never throws", () => {
    const d = tmp();
    const trace = liveTestTrace({ FRANKI_LIVE_TEST_DIR: d }, clock())!;
    trace("route.done", { route: "turn", status: 200, ms: 12 });
    const line = JSON.parse(readFileSync(join(d, EVENTS_FILE), "utf8"));
    expect(line).toEqual({ route: "turn", status: 200, ms: 12, t: 1_763_159_000_000, src: "server", kind: "route.done" });
    const broken = liveTestTrace({ FRANKI_LIVE_TEST_DIR: d }, clock(), { run: "x", append: () => { throw new Error("disk"); }, lines: () => 0, lastWrite: () => null, script: () => null })!;
    expect(() => broken("a", {})).not.toThrow();
  });
});
