// Brief 050 part C: the report script, on the fixture run in fixtures/basic (made-up words).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "./lib/analyze.mjs";
import { InputError, loadRun, metaStart, parseNdjson } from "./lib/run.mjs";
import { renderReport } from "./lib/render.mjs";
import { MIN_N_FOR_P95, describe as describeNums, percentile } from "./lib/stats.mjs";
import { buildWindows, stepAt, stepRows } from "./lib/steps.mjs";
import { joinTurns } from "./lib/turns.mjs";
import { writeReport } from "./report.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/basic", import.meta.url));
const T0 = 1763159000000;
const temps: string[] = [];

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "franki-live-test-"));
  temps.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("percentile math", () => {
  it("is nearest-rank, like packages/core's latency percentile", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([3, 1, 2], 50)).toBe(2);
    expect(percentile([], 50)).toBeNull();
  });

  it("drops non-numbers and holds back a p95 under 20 values", () => {
    const small = describeNums([10, null, "x", 30, Number.NaN, 20]);
    expect(small).toMatchObject({ n: 3, p50: 20, p95: null, max: 30, min: 10, smallN: true });
    const big = describeNums(Array.from({ length: MIN_N_FOR_P95 }, (_, i) => i * 10.4));
    expect(big.smallN).toBe(false);
    expect(big.p95).toBe(Math.round(18 * 10.4));
    expect(describeNums([])).toMatchObject({ n: 0, p50: null, p95: null, max: null });
  });
});

describe("step windows", () => {
  const ev = (t: number, kind: string, step: string, extra: Record<string, unknown> = {}) => ({ t, src: "runner", kind, step, ...extra });

  it("opens at step.start and closes at its step.end", () => {
    const w = buildWindows([ev(10, "step.start", "A"), ev(20, "step.end", "A", { result: "pass" }), ev(30, "step.start", "B"), ev(40, "step.end", "B", { result: "fail" })], 0, 50);
    expect(w.map((x) => [x.step, x.start, x.end, x.result, x.closedBy])).toEqual([
      ["A", 10, 20, "pass", "end"],
      ["B", 30, 40, "fail", "end"],
    ]);
    expect(stepAt(w, 15)).toBe("A");
    expect(stepAt(w, 25)).toBeNull();
    expect(stepAt(w, 40)).toBe("B");
  });

  it("closes an unfinished step at the next start, and the last one at the run's end", () => {
    const w = buildWindows([ev(10, "step.start", "A"), ev(30, "step.start", "B")], 0, 90);
    expect(w.map((x) => [x.step, x.end, x.closedBy])).toEqual([
      ["A", 30, "next"],
      ["B", 90, "runEnd"],
    ]);
    const rows = stepRows([{ id: "A", title: "a", group: "" }, { id: "Z", title: "z", group: "" }], w);
    expect(rows.map((r) => [r.id, r.result, r.open, r.started])).toEqual([
      ["A", null, true, true],
      ["Z", null, false, false],
      ["B", null, true, true],
    ]);
  });

  it("keeps the last result of a step started twice, and sums its length", () => {
    const w = buildWindows([ev(0, "step.start", "A"), ev(10, "step.end", "A", { result: "fail" }), ev(20, "step.start", "A"), ev(25, "step.end", "A", { result: "pass" })], 0, 30);
    const [row] = stepRows([], w);
    expect(row).toMatchObject({ id: "A", result: "pass", attempts: 2, lengthMs: 15 });
  });

  it("gives an end with no start a window of its own", () => {
    const w = buildWindows([ev(10, "step.start", "A"), ev(20, "step.end", "A", { result: "pass" }), ev(35, "step.end", "B", { result: "skip" })], 0, 40);
    expect(w[1]).toMatchObject({ step: "B", start: 20, end: 35, result: "skip", closedBy: "noStart" });
  });
});

describe("the turn join", () => {
  const owner = (t: number, text: string, itemId?: string) => ({ t, src: "client", kind: "words.owner", text, ...(itemId ? { itemId } : {}) });
  const franki = (t: number, text: string, responseId?: string) => ({ t, src: "client", kind: "words.franki", text, ...(responseId ? { responseId } : {}) });
  const lat = (t: number, turnId: string, commit: number, extra: Record<string, unknown> = {}) => ({ t, src: "client", kind: "latency.row", turnId, commit, lastLoud: commit - 200, path: "fastO", endToAudibleMs: 700, commitDelayMs: 200, ...extra });

  it("joins by time without the export, and marks the row approximate", () => {
    // The row is written late (t=9000), but its commit time places it before the owner's words.
    const rows = joinTurns({ words: [owner(2300, "one"), franki(2900, "reply one")], latency: [lat(9000, "turn-1", 2000)], storedTurns: null, serverEvents: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ turnId: "turn-1", owner: "one", franki: "reply one", path: "fastO", endToAudibleMs: 700, join: "time" });
  });

  it("joins by ID with stored turns: itemId, turnId and spokenResponseId", () => {
    const stored = [
      { id: "turn-1", data: { role: "user", sessionId: "s1", seq: 0, itemIds: ["item-1"], text: "stored words", committedAt: new Date(2000).toISOString(), spokenResponseId: "resp-1" } },
    ];
    // Franki's earlier line is a decoy: the ID picks the later one.
    const rows = joinTurns({
      words: [owner(5000, "one", "item-1"), franki(2100, "decoy"), franki(5600, "reply one", "resp-1")],
      latency: [lat(9000, "turn-1", 2000)],
      storedTurns: stored,
      serverEvents: [{ t: 3000, src: "server", kind: "tool.suggest", turnId: "turn-1" }],
      range: { start: 0, end: 10_000 },
    });
    const turn = rows.find((r) => r.turnId === "turn-1")!;
    expect(turn).toMatchObject({ owner: "one", franki: "reply one", endToAudibleMs: 700, tools: ["tool.suggest"], join: "id", source: "stored" });
    // The decoy line has no turn before it, so it is a row of its own.
    expect(rows.find((r) => r.franki === "decoy")?.owner).toBeNull();
  });

  it("drops stored turns far outside the run", () => {
    const stored = [{ id: "old", data: { role: "user", sessionId: "s0", seq: 0, itemIds: [], text: "last week", committedAt: new Date(T0 - 7 * 86_400_000).toISOString() } }];
    expect(joinTurns({ words: [], latency: [], storedTurns: stored, serverEvents: [], range: { start: T0, end: T0 + 60_000 } })).toEqual([]);
  });

  it("ties a typed line to the turn route's time", () => {
    const rows = joinTurns({
      words: [{ t: 100, src: "client", kind: "words.typed", text: "typed one" }],
      latency: [],
      storedTurns: null,
      serverEvents: [{ t: 50, src: "server", kind: "route.done", route: "turn", ms: 9 }, { t: 900, src: "server", kind: "route.done", route: "turn", ms: 800 }],
    });
    expect(rows[0]).toMatchObject({ typed: true, path: "typed", serverMs: 800, join: "time" });
  });
});

describe("reading a run", () => {
  it("skips unreadable lines and lines with no kind or time", () => {
    const { rows, bad } = parseNdjson('{"t":2,"kind":"b"}\nnot json\n{"t":1,"kind":"a"}\n{"kind":"x"}\n{"t":3}\n\n[1]\n');
    expect(rows.map((r) => r.kind)).toEqual(["a", "b"]);
    expect(bad).toBe(4);
  });

  it("finds the start time under any of its likely names", () => {
    expect(metaStart({ startedAt: "2025-11-14T22:23:20.000Z" })).toBe(T0);
    expect(metaStart({ start: T0 })).toBe(T0);
    expect(metaStart({})).toBeNull();
  });

  it("refuses a folder that is not a run", () => {
    const dir = mkdtempSync(join(tmpdir(), "franki-live-test-"));
    temps.push(dir);
    expect(() => loadRun(dir)).toThrow(InputError);
    expect(() => loadRun(join(dir, "missing"))).toThrow(InputError);
  });
});

describe("the report on the fixture", () => {
  it("works with no export and no script, from words.ndjson alone", () => {
    const dir = copyFixture();
    rmSync(join(dir, "script.json"));
    const { summary } = analyze(loadRun(dir));
    expect(summary.hasExport).toBe(false);
    expect(summary.hasScript).toBe(false);
    expect(summary.steps).toMatchObject({ total: 3, pass: 1, fail: 1, skip: 1 });
    expect(summary.turns.total).toBe(3);
  });

  it("writes report.md and summary.json with the fixture's numbers", () => {
    const dir = copyFixture();
    const s = writeReport(dir);
    expect(s.steps).toEqual({ total: 4, pass: 1, fail: 1, skip: 1, noResult: 1 });
    expect(s.lines.bad).toBe(2);
    expect(s.latency.overall.endToAudibleMs).toMatchObject({ n: 2, p50: 900, p95: null, max: 1500 });
    expect(s.routes["tool POST"]).toMatchObject({ n: 1, errors: 1, errorsByCode: { internal: 1 } });
    expect(s.models["slowParse | gpt-6.1-terra"]).toMatchObject({ n: 1, inTok: 900, outTok: 40 });
    expect(s.serverSteps.fastSlots).toMatchObject({ n: 1, validShare: 0, over900Share: 1 });
    expect(s.smoothness).toMatchObject({ lowestAvg: 31.5, lowestAvgStep: "B2", longFrames: 7, longtasks: 1 });
    expect(s.callQuality).toMatchObject({ samples: 2, maxJitterMs: 30, maxLost: 5, maxRttMs: 120 });
    expect(s.errors.total).toBe(3);
    expect(s.gaps).toMatchObject({ noResult: ["D4"], notStarted: ["D4"], outsideAnyStep: 4 });
    // Unknown kinds are counted and otherwise skipped.
    expect(s.unknownKinds).toEqual({ "future.kind": 1 });

    const md = readFileSync(join(dir, "report.md"), "utf8");
    const json = readFileSync(join(dir, "summary.json"), "utf8");
    expect(md.indexOf("## Summary")).toBeLessThan(md.indexOf("## Steps"));
    expect(md).toContain("Hello Franki, are you there?");
    expect(md).toContain("Franki talked over me");
    expect(md).toContain("n too small");
    // Words go to report.md only.
    for (const words of ["Hello Franki", "takeout", "talked over me", "forty dollars"]) expect(json).not.toContain(words);
  });

  it("uses the export's stored turns for an ID join when it exists", () => {
    const dir = copyFixture();
    mkdirSync(join(dir, "firestore"));
    writeFileSync(
      join(dir, "firestore", "turns.json"),
      JSON.stringify({
        docs: [
          { id: "turn-1", sessionId: "s1", data: { role: "user", sessionId: "s1", seq: 0, itemIds: ["item-1"], text: "Hello Franki, are you there?", committedAt: new Date(T0 + 2700).toISOString(), admittedAt: new Date(T0 + 2900).toISOString(), spokenResponseId: "resp-1", state: "transcribed", judge: "O" } },
          { id: "turn-1a", sessionId: "s1", data: { role: "assistant", sessionId: "s1", seq: 1, itemIds: [], text: "I am here. What can I do?", committedAt: new Date(T0 + 3800).toISOString() } },
        ],
      }),
    );
    const { summary, detail } = analyze(loadRun(dir));
    expect(summary.hasExport).toBe(true);
    const t1 = detail.turns.find((r) => r.turnId === "turn-1")!;
    expect(t1).toMatchObject({ join: "id", step: "A1", endToAudibleMs: 900, franki: "I am here. What can I do?" });
    expect(t1.stored).toMatchObject({ admitMs: 200 });
    expect(summary.turns).toMatchObject({ total: 3, byId: 1, approximate: 2 });
    const md = renderReport(analyze(loadRun(dir)));
    expect(md).toContain("| A1 | +0:03 | Hello Franki, are you there? |");
  });

  it("leaves the fixture folder itself untouched", () => {
    expect(existsSync(join(FIXTURE, "report.md"))).toBe(false);
  });
});
