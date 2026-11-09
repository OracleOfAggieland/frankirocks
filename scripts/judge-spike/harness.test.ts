import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JUDGE_V1_INSTRUCTIONS } from "@franki/core";
import { afterEach, describe, expect, it } from "vitest";
import { judgeSettings, main, seedOf } from "./cli";
import { type FakeJudgeScript, fakeConnect, placeholderPcm } from "./fake-realtime";
import { DEFAULT_SEED, MAX_RUN_LINES, type Row, SESSION_LINES, SPIKE_JUDGE_SETTINGS, openSession, outputTokensOf, reasoningTokensOf, runHarness, runLine, shuffleLines } from "./harness";
import { type ProbeLine, LINES_URL, loadLines } from "./lines";
import type { Connect } from "./realtime";
import { type RunFile, runFile, summarize, summaryMarkdown } from "./summary";
import { VirtualClock } from "./virtual-clock";

const lines = loadLines();
const ordinary = lines.find((l) => l.id === "o-01")!;
const control = lines.find((l) => l.id === "c-company-1")!;
const MODELS = { voiceModel: "voice-from-config", transcribeModel: "transcribe-from-config", apiKey: "fake-key-for-tests" };

/** Runs one line on a fresh fake session and returns the row and everything the harness sent. */
async function one(line: ProbeLine, script: FakeJudgeScript) {
  const clock = new VirtualClock();
  const fake = fakeConnect({ clock, judge: () => script });
  const row = await clock.run(
    (async () => {
      const s = await openSession(fake.connect, MODELS, clock, 0);
      const r = await runLine(s, line, placeholderPcm(1200), null);
      return { r, s };
    })(),
  );
  const sent = fake.log.sent;
  const creates = sent.filter((e) => e.type === "response.create").map((e) => e.response as Record<string, unknown>);
  return { row: row.r, session: row.s, sent, creates };
}

const purposes = (creates: Record<string, unknown>[]) => creates.map((c) => (c.metadata as Record<string, string>).purpose);

describe("judge spike harness against the fake transport", () => {
  it("sends the contracts §6 session.update once", async () => {
    const { sent } = await one(ordinary, { texts: ["O"] });
    const updates = sent.filter((e) => e.type === "session.update");
    expect(updates).toHaveLength(1);
    const session = updates[0]!.session as Record<string, any>;
    expect(session.audio.input.turn_detection).toEqual({ type: "server_vad", silence_duration_ms: 300, create_response: false, interrupt_response: false });
    expect(session.audio.input.transcription).toEqual({ model: "transcribe-from-config" });
    expect(session.audio.input.format).toEqual({ type: "audio/pcm", rate: 24_000 });
    expect(session.audio.output).toEqual({ format: { type: "audio/pcm", rate: 24_000 }, voice: "cedar" });
  });

  it("a full O line: judge, reply, cancel at first audio, every time recorded", async () => {
    const { row, sent, creates } = await one(ordinary, { texts: ["O"], delayMs: 190 });
    expect(purposes(creates)).toEqual(["judge", "speech"]);
    const judge = creates[0]!;
    expect(judge.instructions).toBe(JUDGE_V1_INSTRUCTIONS);
    expect(judge.max_output_tokens).toBe("inf");
    expect(judge.reasoning).toEqual({ effort: "minimal" });
    expect((judge.input as { type: string }[]).map((i) => i.type)).toEqual(["message", "item_reference"]);
    expect(creates[1]).toMatchObject({ conversation: "none", output_modalities: ["audio"], input: [{ type: "item_reference", id: "item_1" }] });
    // Cancelled at its first audio delta.
    expect(sent.filter((e) => e.type === "response.cancel")).toEqual([{ type: "response.cancel", response_id: "resp_2" }]);
    expect(row).toMatchObject({ verdict: "O", valid: true, invalidReason: null, timedOut: false, decision: "reply", fragments: 1, judgeText: "O", transcript: "fake transcript", errors: [] });
    for (const [k, v] of Object.entries(row.t)) expect(v, k).not.toBeNull();
    const t = row.t;
    expect(t.speechEnd! < t.commit! && t.commit! < t.itemAdded! && t.itemAdded! <= t.judgeSent! && t.judgeSent! < t.judgeDone!).toBe(true);
    expect(t.judgeDone! <= t.replySent! && t.replySent! < t.firstReplyAudio!).toBe(true);
    expect(row.derived.judgeMs).toBe(t.judgeDone! - t.commit!);
    expect(row.derived.ordinaryLatencyMs).toBe(t.firstReplyAudio! - t.speechEnd!);
    expect(row.derived.asrMs).toBe(t.transcriptionDone! - t.commit!);
  });

  it("takes the end of speech from the send time of the chunk at audio_end_ms", async () => {
    const { row, session } = await one(ordinary, { texts: ["O"] });
    const stop = session.events.find((r) => r.event.type === "input_audio_buffer.speech_stopped")!.event;
    expect(stop.audio_end_ms).toBe(1200);
    expect(row.t.speechEnd).toBe(row.t.streamStart! + 1200);
  });

  it("an H line sends no reply", async () => {
    const { row, creates } = await one(control, { texts: ["H"] });
    expect(purposes(creates)).toEqual(["judge"]);
    expect(row).toMatchObject({ verdict: "H", valid: true, decision: "held" });
    expect(row.t.replySent).toBeNull();
    expect(row.derived.ordinaryLatencyMs).toBeNull();
    expect(row.t.transcriptionDone).not.toBeNull();
  });

  it("an invalid verdict counts as U with its reason, and sends no reply", async () => {
    const { row, creates } = await one(ordinary, { texts: ["O."] });
    expect(row).toMatchObject({ verdict: "U", valid: false, invalidReason: "extraText", judgeText: "O.", decision: "held" });
    expect(purposes(creates)).toEqual(["judge"]);
    const two = await one(ordinary, { texts: ["O", "O"] });
    expect(two.row).toMatchObject({ verdict: "U", invalidReason: "severalMessages" });
    const cut = await one(ordinary, { texts: ["Okay"], status: "incomplete" });
    expect(cut.row).toMatchObject({ verdict: "U", invalidReason: "incomplete", judgeStatus: "incomplete" });
  });

  it("a judge with no response.done is a timeout, held, and cancelled", async () => {
    const { row, sent, creates } = await one(ordinary, { noDone: true });
    expect(row).toMatchObject({ timedOut: true, decision: "held", verdict: null });
    expect(row.t.judgeDone).toBeNull();
    expect(purposes(creates)).toEqual(["judge"]);
    expect(sent.filter((e) => e.type === "response.cancel")).toEqual([{ type: "response.cancel", response_id: "resp_1" }]);
  });

  it("a late O after 600 ms keeps its real time but is held", async () => {
    const { row, creates } = await one(ordinary, { texts: ["O"], delayMs: 900 });
    expect(row).toMatchObject({ verdict: "O", valid: true, timedOut: true, decision: "held" });
    expect(row.derived.judgeMs).toBeGreaterThan(600);
    expect(purposes(creates)).toEqual(["judge"]);
  });

  it("records output and reasoning tokens wherever usage reports them", async () => {
    const { row } = await one(ordinary, { texts: ["O"], usage: { output_tokens: 9, output_token_details: { text_tokens: 1, reasoning_tokens: 8 } } });
    expect(row.reasoningTokens).toBe(8);
    expect(row.outputTokens).toBe(9);
    expect(reasoningTokensOf({ output_tokens: 1 })).toBeNull();
    expect(outputTokensOf({ input_tokens: 3 })).toBeNull();
  });

  it("opens a fresh session every 30 lines and records which lines shared one", async () => {
    const clock = new VirtualClock();
    const fake = fakeConnect({ clock, judge: () => ({ texts: ["H"] }) });
    const many = lines.slice(0, SESSION_LINES + 2);
    const audio = new Map(many.map((l) => [l.id, placeholderPcm(400)]));
    const out = await clock.run(runHarness({ lines: many, audio, voices: new Map(), models: { voice: "v", transcribe: "t" }, judge: SPIKE_JUDGE_SETTINGS, seed: DEFAULT_SEED, apiKey: "k", connect: fake.connect, clock, log: () => {} }));
    expect(fake.log.connections).toBe(2);
    expect(fake.log.closed).toBe(2);
    expect(out.sessions.map((s) => s.length)).toEqual([SESSION_LINES, 2]);
    expect(out.rows.map((r) => r.session)).toEqual([...Array(SESSION_LINES).fill(0), 1, 1]);
    expect(out.eventNames).toContain("conversation.item.added");
  });

  it("shuffles by a fixed seed: the same seed gives the same order, every line once", () => {
    const ids = lines.map((l) => l.id);
    const a = shuffleLines(ids, DEFAULT_SEED);
    expect(shuffleLines(ids, DEFAULT_SEED)).toEqual(a);
    expect([...a].sort()).toEqual([...ids].sort());
    expect(a).not.toEqual(ids);
    expect(shuffleLines(ids, DEFAULT_SEED + 1)).not.toEqual(a);
    expect(() => shuffleLines(ids, -1)).toThrow(RangeError);
    expect(() => shuffleLines(ids, 1.5)).toThrow(RangeError);
  });

  it("refuses more than 70 lines in one run", async () => {
    const tooMany = Array.from({ length: MAX_RUN_LINES + 1 }, (_, i) => ({ ...ordinary, id: `x${i}` }));
    const clock = new VirtualClock();
    await expect(runHarness({ lines: tooMany, audio: new Map(), voices: new Map(), models: { voice: "v", transcribe: "t" }, judge: SPIKE_JUDGE_SETTINGS, seed: DEFAULT_SEED, apiKey: "k", connect: fakeConnect({ clock, judge: () => ({}) }).connect, clock, log: () => {} })).rejects.toThrow(/at most 70/);
  });
});

function row(over: Partial<Row>): Row {
  return {
    lineId: "o-01",
    class: "smallTalk",
    expect: "ordinary",
    probe: false,
    session: 0,
    voice: null,
    audioMs: 1000,
    fragments: 1,
    t: { streamStart: 0, speechEnd: 1000, commit: 1300, itemAdded: 1330, judgeSent: 1330, judgeFirstDelta: 1400, judgeDone: 1500, replySent: 1500, firstReplyAudio: 1800, transcriptionDone: 1700 },
    verdict: "O",
    valid: true,
    invalidReason: null,
    judgeStatus: "completed",
    judgeStatusDetails: null,
    judgeText: "O",
    judgeUsage: null,
    outputTokens: null,
    reasoningTokens: null,
    judgeOtherItems: [],
    timedOut: false,
    decision: "reply",
    transcript: "hi",
    derived: { judgeMs: 200, ordinaryLatencyMs: 800, asrMs: 400 },
    errors: [],
    ...over,
  };
}

const META = { date: "2026-11-09T00:00:00.000Z", source: "synthetic" as const, transport: "fake" as const, lineSetCommit: "abc", lineSetHash: "f".repeat(64), models: { voice: "v", transcribe: "t" }, judge: SPIKE_JUDGE_SETTINGS };
const run = (rows: Row[], source: "synthetic" | "owner" = "synthetic"): RunFile => runFile({ ...META, source }, { rows, seed: DEFAULT_SEED, order: rows.map((r) => r.lineId), sessions: [rows.map((r) => r.lineId)], eventNames: [] });
const probes = (n: number, latency: number | null) =>
  Array.from({ length: n }, (_, i) => row({ lineId: `o-${i}`, probe: true, derived: { judgeMs: 200, ordinaryLatencyMs: latency, asrMs: 400 }, decision: latency === null ? "held" : "reply" }));
const controls = (held: number, of: number) =>
  Array.from({ length: of }, (_, i) => row({ lineId: `c-${i}`, class: "forget", expect: "hold", decision: i < held ? "held" : "reply", verdict: i < held ? "H" : "O" }));

describe("judge spike summary", () => {
  it("reads within only when every number is there", () => {
    const s = summarize(run([...probes(15, 700), ...controls(30, 30)]));
    expect(s.stops).toEqual({ verdict: "within", latency: "within", recall: "within" });
    expect(s.probes).toEqual({ p50: 700, measured: 15, total: 15 });
  });

  it("never writes within when a number is missing", () => {
    const md = summaryMarkdown(run([...probes(14, 700), ...probes(1, null), ...controls(29, 29), row({ lineId: "c-x", expect: "hold", class: "quiet", decision: null, verdict: null, t: { ...row({}).t, judgeSent: null } })]));
    expect(md).toContain("Sequential p50 over 850 ms on 15 probes: **not measured**");
    expect(md).toContain("Control recall under 90%: **not measured**");
    const empty = summaryMarkdown(run([]));
    expect(empty).not.toContain("**within**");
    expect(empty.match(/\*\*not measured\*\*/g)).toHaveLength(3);
  });

  it("says over the line when the rule fails even at the best case", () => {
    const s = summarize(run([...probes(10, 900), ...controls(20, 30)]));
    expect(s.stops.latency).toBe("over the line");
    expect(s.stops.recall).toBe("over the line");
    expect(summarize(run([row({ valid: false, verdict: "U", invalidReason: "extraText", decision: "held" })])).stops.verdict).toBe("over the line");
  });

  it("counts recall per class, false holds, invalid reasons and the ASR fallback", () => {
    const rows = [
      ...controls(4, 5),
      row({ lineId: "o-a", decision: "held", verdict: "U", valid: false, invalidReason: "extraText", derived: { judgeMs: 200, ordinaryLatencyMs: null, asrMs: 700 } }),
      row({ lineId: "o-b" }),
    ];
    const s = summarize(run(rows));
    expect(s.views.judgeDeadline.recallByClass.forget).toEqual({ n: 4, of: 5, missing: 0 });
    expect(s.views.judgeDeadline.falseHolds).toEqual({ n: 1, of: 2, missing: 0 });
    expect(s.invalidReasons).toEqual({ extraText: 1 });
    expect(s.asrMs.withinFallback).toBe(rows.length - 1);
    expect(summaryMarkdown(run(rows))).toContain("Fake transport");
  });

  it("witness: every answer invalid reads over the line and 0% judge recall, while the app view still holds", () => {
    const invalid = { valid: false, verdict: "U" as const, invalidReason: "incomplete" as const, judgeStatus: "incomplete", decision: "held" as const, derived: { judgeMs: 450, ordinaryLatencyMs: null, asrMs: 400 } };
    const rows = [
      ...controls(30, 30).map((r) => ({ ...r, ...invalid })),
      ...Array.from({ length: 30 }, (_, i) => row({ lineId: `o-${i}`, probe: i < 15, ...invalid })),
    ];
    const s = summarize(run(rows));
    expect(s.stops.verdict).toBe("over the line");
    expect(s.stops.recall).toBe("over the line");
    expect(s.validVerdicts.deadline).toEqual({ n: 0, of: 60, missing: 0 });
    expect(s.views.judgeDeadline.recall).toEqual({ n: 0, of: 30, missing: 0 });
    expect(s.views.judgeUntimed.recall.n).toBe(0);
    expect(s.views.appDeadline.recall).toEqual({ n: 30, of: 30, missing: 0 });
    expect(s.views.judgeDeadline.falseHolds).toEqual({ n: 30, of: 30, missing: 0 });
    const md = summaryMarkdown(run(rows));
    expect(md).toContain("No valid verdict on real audio (fewer than 90% of lines with one): **over the line** (0 of 60 lines had a valid verdict within 600 ms)");
    expect(md).toContain("Control recall under 90%: **over the line** (judge H or U within 600 ms: 0.0% (0 of 30))");
    expect(md).toContain("| As the app would act, within 600 ms | 100.0% (30 of 30) |");
    expect(md).not.toContain("**within**");
  });

  it("witness: a valid late H counts in the untimed view only", () => {
    const late = row({ lineId: "c-late", class: "forget", expect: "hold", verdict: "H", valid: true, timedOut: true, decision: "held", t: { ...row({}).t, judgeDone: 2100 }, derived: { judgeMs: 800, ordinaryLatencyMs: null, asrMs: 400 } });
    const s = summarize(run([late]));
    expect(s.views.judgeDeadline.recall).toEqual({ n: 0, of: 1, missing: 0 });
    expect(s.views.judgeUntimed.recall).toEqual({ n: 1, of: 1, missing: 0 });
    expect(s.views.appDeadline.recall.n).toBe(1);
    expect(s.validVerdicts).toEqual({ deadline: { n: 0, of: 1, missing: 0 }, untimed: { n: 1, of: 1, missing: 0 } });
    expect(s.stops.verdict).toBe("over the line");
    // A late O is a false hold within 600 ms and passes at any time.
    const lateO = row({ timedOut: true, decision: "held", t: { ...row({}).t, judgeDone: 2100 } });
    const o = summarize(run([lateO]));
    expect(o.views.judgeDeadline.falseHolds.n).toBe(1);
    expect(o.views.judgeUntimed.falseHolds.n).toBe(0);
    // A timeout with no response.done has no verdict in any view.
    const hung = row({ lineId: "c-hung", class: "forget", expect: "hold", verdict: null, valid: null, timedOut: true, decision: "held", t: { ...row({}).t, judgeDone: null } });
    expect(summarize(run([hung])).views.judgeUntimed.recall.n).toBe(0);
    expect(summarize(run([hung])).views.appUntimed.recall.n).toBe(1);
  });

  it("witness: the first live run (Nov 9, at the 16-token cap) now reads over the line", () => {
    const file = new URL("./results/2026-11-09T18-41-59-158Z-owner.json", import.meta.url);
    const first = JSON.parse(readFileSync(file, "utf8")) as RunFile;
    const s = summarize(first);
    expect(s.stops.verdict).toBe("over the line");
    expect(s.stops.recall).toBe("over the line");
    expect(s.views.judgeDeadline.recall.n).toBe(0);
    expect(s.validVerdicts.untimed.n).toBe(2);
    expect(s.reasoningTokens.max).toBe(19);
  });

  it("prints per-session judge p50 with the session's mix of lines", () => {
    const rows = [
      row({ lineId: "o-a", session: 0, derived: { judgeMs: 400, ordinaryLatencyMs: 800, asrMs: 400 } }),
      row({ lineId: "c-a", session: 0, expect: "hold", class: "forget", verdict: "H", decision: "held", derived: { judgeMs: 500, ordinaryLatencyMs: null, asrMs: 400 } }),
      row({ lineId: "o-b", session: 1, derived: { judgeMs: 1100, ordinaryLatencyMs: 900, asrMs: 400 } }),
    ];
    const s = summarize(run(rows));
    expect(s.sessions).toEqual([
      { session: 0, lines: 2, control: 1, ordinary: 1, judgeMs: { p50: 400, n: 2 } },
      { session: 1, lines: 1, control: 0, ordinary: 1, judgeMs: { p50: 1100, n: 1 } },
    ]);
    const md = summaryMarkdown(run(rows));
    expect(md).toContain(`Lines ran in a seeded order (seed ${DEFAULT_SEED}), up to 30 per session.`);
    expect(md).toContain("| 1 | 2 | 1 | 1 | 400 ms | 2 |");
    expect(md).toContain("| 2 | 1 | 0 | 1 | 1100 ms | 1 |");
  });

  it("drops the transcripts of the owner's own takes", () => {
    expect(run([row({})], "owner").rows[0]!.transcript).toBeNull();
    expect(run([row({})], "synthetic").rows[0]!.transcript).toBe("hi");
  });

  it("prints the judge settings at the top and the largest and p50 token counts", () => {
    const rows = [10, 12, 19].map((n, i) => row({ lineId: `o-${i}`, outputTokens: n + 1, reasoningTokens: n }));
    const s = summarize(run(rows));
    expect(s.reasoningTokens).toEqual({ n: 3, p50: 12, max: 19 });
    expect(s.outputTokens).toEqual({ n: 3, p50: 13, max: 20 });
    const md = summaryMarkdown(run(rows));
    expect(md.split("\n").slice(0, 6).join("\n")).toContain("- Judge: max_output_tokens inf (no cap), reasoning effort minimal");
    expect(md).toContain("Output tokens per judge response (reasoning included): largest 20, p50 13, over 3 response(s)");
    expect(md).toContain("Reasoning tokens per judge response: largest 19, p50 12, over 3 response(s)");
    expect(summaryMarkdown(runFile({ ...META, judge: { maxOutputTokens: 16, effort: "low" } }, { rows, seed: 0, order: rows.map((r) => r.lineId), sessions: [], eventNames: [] }))).toContain("max_output_tokens 16, reasoning effort low");
    expect(summaryMarkdown(run([]))).toContain("Reasoning tokens per judge response: not reported in any usage object");
  });
});

describe("judge spike CLI", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });
  const spikeDir = () => {
    dir = mkdtempSync(join(tmpdir(), "judge-spike-"));
    copyFileSync(LINES_URL, join(dir, "lines.json"));
    return dir;
  };

  it("never connects without --live, and runs the whole flow on the fake transport", async () => {
    const d = spikeDir();
    let liveCalls = 0;
    const liveConnect: Connect = async () => {
      liveCalls++;
      throw new Error("must not connect");
    };
    const logs: string[] = [];
    const code = await main(["harness", "--lines", "o-01,c-forget-1"], { spikeDir: d, env: {}, log: (l) => logs.push(l), liveConnect });
    expect(code).toBe(0);
    expect(liveCalls).toBe(0);
    expect(logs[0]).toMatch(/^harness: 2 lines, 3\.0 s of audio, source synthetic, fake transport$/);
    expect(existsSync(join(d, "results"))).toBe(false);
    const files = readdirSync(join(d, "dist", "dry-run"));
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
    const out = JSON.parse(readFileSync(join(d, "dist", "dry-run", files.find((f) => f.endsWith(".json"))!), "utf8")) as RunFile;
    expect(out.transport).toBe("fake");
    expect(out.judge).toEqual({ maxOutputTokens: "inf", effort: "minimal" });
    expect(Object.fromEntries(out.rows.map((r) => [r.lineId, r.decision]))).toEqual({ "c-forget-1": "held", "o-01": "reply" });
  });

  it("passes --max-tokens and --effort to the judge and the run file, and refuses bad values", async () => {
    const d = spikeDir();
    const logs: string[] = [];
    expect(await main(["harness", "--lines", "o-01", "--max-tokens", "64", "--effort", "low"], { spikeDir: d, env: {}, log: (l) => logs.push(l) })).toBe(0);
    expect(logs[1]).toBe("harness: judge max_output_tokens 64, effort low; line order seed 7");
    const file = readdirSync(join(d, "dist", "dry-run")).find((f) => f.endsWith(".json"))!;
    expect((JSON.parse(readFileSync(join(d, "dist", "dry-run", file), "utf8")) as RunFile).judge).toEqual({ maxOutputTokens: 64, effort: "low" });
    expect(judgeSettings({})).toEqual(SPIKE_JUDGE_SETTINGS);
    expect(judgeSettings({ "max-tokens": "inf" }).maxOutputTokens).toBe("inf");
    for (const bad of ["0", "-3", "1.5", "16x", "Infinity"]) expect(() => judgeSettings({ "max-tokens": bad })).toThrow(/--max-tokens/);
    expect(() => judgeSettings({ effort: "max" })).toThrow(/--effort/);
  });

  it("refuses a live run without usable audio before connecting", async () => {
    const d = spikeDir();
    let liveCalls = 0;
    const logs: string[] = [];
    const code = await main(["harness", "--live", "--lines", "o-01"], {
      spikeDir: d,
      env: { OPENAI_API_KEY: "fake-key-for-tests" },
      log: (l) => logs.push(l),
      liveConnect: async () => {
        liveCalls++;
        throw new Error("must not connect");
      },
    });
    expect(code).toBe(1);
    expect(liveCalls).toBe(0);
    expect(logs.join("\n")).toContain("o-01: missing");
  });

  it("runs the whole line set in one dry run, in two sessions that each mix control and ordinary lines", async () => {
    const d = spikeDir();
    const logs: string[] = [];
    const code = await main(["harness"], { spikeDir: d, env: {}, log: (l) => logs.push(l) });
    expect(code).toBe(0);
    expect(logs[0]).toMatch(/^harness: 60 lines, 90\.0 s of audio/);
    expect(logs[1]).toContain("line order seed 7");
    const file = readdirSync(join(d, "dist", "dry-run")).find((f) => f.endsWith(".json"))!;
    const out = JSON.parse(readFileSync(join(d, "dist", "dry-run", file), "utf8")) as RunFile;
    expect(out.seed).toBe(DEFAULT_SEED);
    expect(out.order).toEqual(shuffleLines(lines, DEFAULT_SEED).map((l) => l.id));
    expect(out.rows.map((r) => r.lineId)).toEqual(out.order);
    expect(out.sessions.flat()).toEqual(out.order);
    for (const ids of out.sessions) {
      expect(ids.some((id) => id.startsWith("c-"))).toBe(true);
      expect(ids.some((id) => id.startsWith("o-"))).toBe(true);
    }
    // The fake judge still answers each line by its own label after the shuffle.
    expect(out.rows.every((r) => r.verdict === (r.expect === "hold" ? "H" : "O"))).toBe(true);
    expect(logs.join("\n")).toMatch(/\| 1 \| 30 \| \d+ \| \d+ \| \d+ ms \| 30 \|/);
  });

  it("takes --seed, records it with the order, and refuses a bad seed", async () => {
    const d = spikeDir();
    expect(await main(["harness", "--lines", "o-01,o-02,c-forget-1,c-quiet-1", "--seed", "12345"], { spikeDir: d, env: {}, log: () => {} })).toBe(0);
    const file = readdirSync(join(d, "dist", "dry-run")).find((f) => f.endsWith(".json"))!;
    const out = JSON.parse(readFileSync(join(d, "dist", "dry-run", file), "utf8")) as RunFile;
    expect(out.seed).toBe(12345);
    expect(out.order).toEqual(shuffleLines(lines.filter((l) => ["o-01", "o-02", "c-forget-1", "c-quiet-1"].includes(l.id)), 12345).map((l) => l.id));
    expect(seedOf({})).toBe(DEFAULT_SEED);
    expect(seedOf({ seed: "0" })).toBe(0);
    for (const bad of ["-1", "1.5", "x", "4294967296"]) expect(() => seedOf({ seed: bad })).toThrow(/--seed/);
  });

  it("keeps the synth command dry without --live", async () => {
    const d = spikeDir();
    const logs: string[] = [];
    expect(await main(["synth", "--lines", "o-01"], { spikeDir: d, env: {}, log: (l) => logs.push(l) })).toBe(0);
    expect(logs.at(-1)).toContain("dry run, nothing sent");
    expect(existsSync(join(d, "audio"))).toBe(false);
  });
});
