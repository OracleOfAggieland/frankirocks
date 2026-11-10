import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_JUDGE_SETTINGS, JUDGE_V1_INSTRUCTIONS, JUDGE_V2_INSTRUCTIONS, type JudgeSettings, encodeWav } from "@franki/core";
import { afterEach, describe, expect, it } from "vitest";
import { judgeSettings, main, runSettings, seedOf } from "./cli";
import { HARNESS_PARSE_WAIT_MS, fakeDecisionsPort, lineParser } from "./decisions";
import { FAKE_REFUSAL, type FakeJudgeScript, type FakeOptions, fakeConnect, placeholderPcm } from "./fake-realtime";
import { DEFAULT_RUN, DEFAULT_SEED, MAX_RUN_LINES, NO_SPEECH, type Row, type RunSettings, SESSION_LINES, SPIKE_JUDGE_SETTINGS, openSession, outputTokensOf, reasoningTokensOf, runHarness, runLine, shuffleLines, silentTakes } from "./harness";
import { type ProbeLine, LINES_URL, loadLines } from "./lines";
import type { Connect } from "./realtime";
import { COMMIT_TO_SEND_FLAG_MS, type RunFile, runFile, summarize, summaryMarkdown } from "./summary";
import { SPEECH_RMS_THRESHOLD } from "./trim";
import { VirtualClock } from "./virtual-clock";

/** The contract's 600 ms, which every run before brief 011 used. */
const AT_600: JudgeSettings = { contract: "judge_v1", maxOutputTokens: "inf", effort: "minimal", deadlineMs: 600 };

const lines = loadLines();
const ordinary = lines.find((l) => l.id === "o-01")!;
const control = lines.find((l) => l.id === "c-company-1")!;
const MODELS = { voiceModel: "voice-from-config", transcribeModel: "transcribe-from-config", apiKey: "fake-key-for-tests" };
const SEQUENTIAL: RunSettings = { mode: "sequential", staggerMs: 0 };
const PARALLEL: RunSettings = DEFAULT_RUN;

/** Runs one line on a fresh fake session and returns the row and everything the harness sent. */
async function one(line: ProbeLine, script: FakeJudgeScript, pcm: Uint8Array = placeholderPcm(1200), run: RunSettings = SEQUENTIAL, fakeOpts: Partial<FakeOptions> = {}, judge: JudgeSettings = SPIKE_JUDGE_SETTINGS) {
  const clock = new VirtualClock();
  const fake = fakeConnect({ clock, judge: () => script, ...fakeOpts });
  const row = await clock.run(
    (async () => {
      const s = await openSession(fake.connect, MODELS, clock, 0);
      const r = await runLine(s, line, pcm, null, judge, run);
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
    const parallelOnly = new Set(["replyCreated", "replyCancelSent"]);
    for (const [k, v] of Object.entries(row.t)) if (!parallelOnly.has(k)) expect(v, k).not.toBeNull();
    const t = row.t;
    expect(t.audible).toBe(t.firstReplyAudio);
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

  it("brief 009 item 3: takes the end of audible speech from the chunk holding the last loud frame", async () => {
    // 1,200 ms of tone, then 1,000 ms of quiet; the last loud frame starts at 1,180 ms.
    const take = concat(placeholderPcm(1200), new Uint8Array(1000 * 48));
    for (const mode of [SEQUENTIAL, PARALLEL]) {
      const { row } = await one(ordinary, { texts: ["O"] }, take, mode);
      expect(row.t.lastLoudSent).toBe(row.t.streamStart! + 1180);
      expect(row.derived.vadEndAfterLoudMs).toBe(row.t.speechEnd! - row.t.lastLoudSent!);
      expect(row.derived.ordinaryLatencyFromLoudMs).toBe(row.t.audible! - row.t.lastLoudSent!);
      expect(row.derived.ordinaryLatencyMs).toBe(row.t.audible! - row.t.speechEnd!);
    }
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
    const { row, creates } = await one(ordinary, { texts: ["O"], delayMs: 900 }, undefined, SEQUENTIAL, {}, AT_600);
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
    const out = await clock.run(runHarness({ lines: many, audio, voices: new Map(), models: { voice: "v", transcribe: "t" }, judge: SPIKE_JUDGE_SETTINGS, run: DEFAULT_RUN, seed: DEFAULT_SEED, apiKey: "k", connect: fake.connect, clock, log: () => {} }));
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
    await expect(runHarness({ lines: tooMany, audio: new Map(), voices: new Map(), models: { voice: "v", transcribe: "t" }, judge: SPIKE_JUDGE_SETTINGS, run: DEFAULT_RUN, seed: DEFAULT_SEED, apiKey: "k", connect: fakeConnect({ clock, judge: () => ({}) }).connect, clock, log: () => {} })).rejects.toThrow(/at most 70/);
  });

  it("witness: a take with a long silent tail streams to 100 ms after its last speech, and the judge goes out at the commit", async () => {
    const take = concat(placeholderPcm(1200), roomTone(2000, 150));
    const { row, sent } = await one(ordinary, { texts: ["O"] }, take);
    expect(row).toMatchObject({ takeMs: 3200, trimmedMs: 1900, audioMs: 1300, fragments: 1, errors: [] });
    // Only the trimmed take went out before the silence the harness adds.
    const appended = sent.filter((e) => e.type === "input_audio_buffer.append").map((e) => Buffer.from(String(e.audio), "base64"));
    expect(Buffer.concat(appended).subarray(0, 1300 * 48).equals(Buffer.from(take.subarray(0, 1300 * 48)))).toBe(true);
    expect(row.derived.commitToJudgeSentMs).toBe(row.t.judgeSent! - row.t.commit!);
    expect(row.derived.commitToJudgeSentMs!).toBeLessThanOrEqual(COMMIT_TO_SEND_FLAG_MS);
    // The commit lands about 300 ms after the last loud frame, not after the 2 s tail.
    expect(row.t.commit! - row.t.streamStart!).toBeLessThan(1200 + 400);
  });

  it("witness: a pause inside the line is streamed as recorded", async () => {
    const take = concat(placeholderPcm(600), new Uint8Array(800 * 48), placeholderPcm(600), new Uint8Array(1500 * 48));
    const { row } = await one(ordinary, { texts: ["O"] }, take);
    expect(row).toMatchObject({ takeMs: 3500, trimmedMs: 1400, audioMs: 2100, fragments: 2 });
    expect(row.derived.commitToJudgeSentMs!).toBeLessThanOrEqual(COMMIT_TO_SEND_FLAG_MS);
  });

  it("witness: an all-silent take is refused before any session opens", async () => {
    const clock = new VirtualClock();
    const fake = fakeConnect({ clock, judge: () => ({}) });
    const audio = new Map([
      [ordinary.id, placeholderPcm(1000)],
      [control.id, roomTone(2000, SPEECH_RMS_THRESHOLD)],
    ]);
    expect(silentTakes([ordinary, control], audio)).toEqual([control.id]);
    await expect(clock.run(runHarness({ lines: [ordinary, control], audio, voices: new Map(), models: { voice: "v", transcribe: "t" }, judge: SPIKE_JUDGE_SETTINGS, run: DEFAULT_RUN, seed: DEFAULT_SEED, apiKey: "k", connect: fake.connect, clock, log: () => {} }))).rejects.toThrow(`refusing takes with no speech (${NO_SPEECH}): ${control.id}`);
    expect(fake.log.connections).toBe(0);
    // runLine on its own records the refusal and streams nothing.
    const { row, sent } = await one(control, { texts: ["H"] }, new Uint8Array(1000 * 48));
    expect(row.errors).toEqual([NO_SPEECH]);
    expect(row).toMatchObject({ takeMs: 1000, audioMs: 0, decision: null });
    expect(sent.filter((e) => e.type === "input_audio_buffer.append")).toHaveLength(0);
  });
});

describe("judge spike harness, parallel mode (brief 009)", () => {
  const cancels = (sent: { type: string }[]) => sent.filter((e) => e.type === "response.cancel") as unknown as { type: string; response_id: string }[];

  it("sends the judge and the speculative reply together, out of band on the same items, each with its purpose", async () => {
    const { row, sent, creates } = await one(ordinary, { texts: ["O"], delayMs: 190 }, undefined, PARALLEL);
    expect(purposes(creates)).toEqual(["judge", "speculative"]);
    const ref = [{ type: "item_reference", id: "item_1" }];
    expect((creates[0]!.input as unknown[]).slice(1)).toEqual(ref);
    expect(creates[0]).toMatchObject({ conversation: "none" });
    expect(creates[1]).toMatchObject({ conversation: "none", output_modalities: ["audio"], input: ref, metadata: { purpose: "speculative", turnId: ordinary.id } });
    // The two creates go out back to back: the reply right after the judge.
    const i = sent.findIndex((e) => e.type === "response.create");
    expect(sent[i + 1]!.type).toBe("response.create");
    expect(row.t.replySent).toBe(row.t.judgeSent);
    expect(row).toMatchObject({ verdict: "O", valid: true, decision: "reply", concurrencyErrors: [], mutedReplyAudio: null, errors: [] });
    expect(cancels(sent)).toEqual([{ type: "response.cancel", response_id: "resp_2" }]);
  });

  it("an H line cancels the reply at the verdict, before any audio, and has no audible time", async () => {
    const { row, sent } = await one(control, { texts: ["H"], delayMs: 150 }, undefined, PARALLEL, { replyAudioDelayMs: 250 });
    expect(row).toMatchObject({ verdict: "H", decision: "held", mutedReplyAudio: false });
    expect(row.t.replyCancelSent).toBe(row.t.judgeDone);
    expect(row.t.firstReplyAudio).toBeNull();
    expect(row.t.audible).toBeNull();
    expect(row.derived.ordinaryLatencyMs).toBeNull();
    expect(cancels(sent)).toEqual([{ type: "response.cancel", response_id: "resp_2" }]);
  });

  it("an invalid answer holds and cancels the reply at once", async () => {
    const { row, sent } = await one(ordinary, { texts: ["O."], delayMs: 150 }, undefined, PARALLEL);
    expect(row).toMatchObject({ verdict: "U", invalidReason: "extraText", decision: "held" });
    expect(row.t.replyCancelSent).toBe(row.t.judgeDone);
    expect(cancels(sent)).toHaveLength(1);
  });

  it("a judge with no answer holds at 600 ms: the reply is cancelled then, the judge at 3 s", async () => {
    const { row, sent } = await one(ordinary, { noDone: true }, undefined, PARALLEL, {}, AT_600);
    expect(row).toMatchObject({ timedOut: true, decision: "held", verdict: null, mutedReplyAudio: true });
    expect(row.t.replyCancelSent! - row.t.commit!).toBe(600);
    expect(cancels(sent).map((e) => e.response_id)).toEqual(["resp_2", "resp_1"]);
  });

  it("a stagger sends the reply that much after the judge", async () => {
    const { row } = await one(ordinary, { texts: ["O"], delayMs: 300 }, undefined, { mode: "parallel", staggerMs: 120 });
    expect(row.t.replySent! - row.t.judgeSent!).toBe(120);
    expect(row.decision).toBe("reply");
  });

  it("with a stagger, an early O sends the reply at once and an early H sends none (spec §3: min(O, t0 + stagger))", async () => {
    const early = await one(ordinary, { texts: ["O"], delayMs: 60 }, undefined, { mode: "parallel", staggerMs: 120 });
    expect(early.row.t.replySent).toBe(early.row.t.judgeDone);
    expect(early.row.t.audible).toBe(early.row.t.firstReplyAudio);
    const held = await one(control, { texts: ["H"], delayMs: 60 }, undefined, { mode: "parallel", staggerMs: 120 });
    expect(purposes(held.creates)).toEqual(["judge"]);
    expect(held.row).toMatchObject({ decision: "held", mutedReplyAudio: null });
    expect(held.row.t.replySent).toBeNull();
  });
});

describe("judge spike parallel summary, witnesses on the fake transport (brief 009 item 4)", () => {
  const parallelRun = (rows: Row[]) => runFile({ ...META, run: PARALLEL }, { rows, seed: DEFAULT_SEED, order: rows.map((r) => r.lineId), sessions: [rows.map((r) => r.lineId)], eventNames: [] });

  it("witness: an O line where the reply's audio comes first is audible at the verdict", async () => {
    const { row } = await one(ordinary, { texts: ["O"], delayMs: 300 }, undefined, PARALLEL, { replyAudioDelayMs: 100 });
    expect(row.t.firstReplyAudio! < row.t.judgeDone!).toBe(true);
    expect(row.t.audible).toBe(row.t.judgeDone);
    expect(row.t.replyCancelSent).toBe(row.t.judgeDone);
    const p = summarize(parallelRun([row])).parallel!;
    expect(p.audioBeforeVerdict).toEqual({ n: 1, of: 1 });
    expect(p.judgeFromSendMs.p50).toBe(300);
    expect(p.replyFromSendMs.p50).toBe(100);
  });

  it("witness: an O line where the verdict comes first is audible at the first reply audio", async () => {
    const { row } = await one(ordinary, { texts: ["O"], delayMs: 150 }, undefined, PARALLEL, { replyAudioDelayMs: 250 });
    expect(row.t.judgeDone! < row.t.firstReplyAudio!).toBe(true);
    expect(row.t.audible).toBe(row.t.firstReplyAudio);
    expect(row.t.replyCancelSent).toBe(row.t.firstReplyAudio);
    expect(row.decision).toBe("reply");
    expect(summarize(parallelRun([row])).parallel!.audioBeforeVerdict).toEqual({ n: 0, of: 1 });
  });

  it("witness: an H line whose reply is cancelled after some audio arrived counts as muted", async () => {
    const { row, sent } = await one(control, { texts: ["H"], delayMs: 300 }, undefined, PARALLEL, { replyAudioDelayMs: 100 });
    expect(row).toMatchObject({ verdict: "H", decision: "held", mutedReplyAudio: true });
    expect(row.t.firstReplyAudio! < row.t.replyCancelSent!).toBe(true);
    expect(row.t.replyCancelSent).toBe(row.t.judgeDone);
    expect(row.t.audible).toBeNull();
    expect(sent.filter((e) => e.type === "response.cancel")).toEqual([{ type: "response.cancel", response_id: "resp_2" }]);
    const s = summarize(parallelRun([row]));
    expect(s.parallel!.mutedOnHeld).toEqual({ n: 1, of: 1 });
    expect(summaryMarkdown(parallelRun([row]))).toContain("- Reply audio received on held lines, kept muted: 1 of 1 held lines whose reply went out");
  });

  it("witness: a refused second response is recorded in full, holds the line, and is not retried in sequence", async () => {
    const { row, creates, sent } = await one(ordinary, { texts: ["O"], delayMs: 180 }, undefined, PARALLEL, { concurrent: "refuse" });
    expect(purposes(creates)).toEqual(["judge", "speculative"]);
    expect(row.concurrencyErrors).toHaveLength(1);
    expect(row.concurrencyErrors![0]).toEqual({ type: "error", event_id: "event_1", error: { ...FAKE_REFUSAL, param: null, event_id: null } });
    // The judge's own verdict is still kept; the line is held, and no reply ever went out after it.
    expect(row).toMatchObject({ verdict: "O", valid: true, decision: "held" });
    expect(row.t.replyCreated).toBeNull();
    expect(row.t.audible).toBeNull();
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(2);
    const p = summarize(parallelRun([row])).parallel!;
    expect(p.errorLines).toEqual([{ lineId: ordinary.id, count: 1, first: `${FAKE_REFUSAL.code}: ${FAKE_REFUSAL.message}` }]);
    expect(p).toMatchObject({ overlapped: 1, ranAtOnce: 0 });
    const md = summaryMarkdown(parallelRun([row]));
    expect(md).toContain("- Lines with an error event: 1, all held (the full events are in the run file)");
    expect(md).toContain(`  - ${ordinary.id}: ${FAKE_REFUSAL.code}: ${FAKE_REFUSAL.message}`);
    expect(md).toContain("**Two out-of-band responses ran at once: no.**");
  });

  it("witness: events from the two responses interleave and are matched by response ID, not by order", async () => {
    // The reply's response.created comes first, its audio before the judge's text, and its own response.done
    // (completed) before the judge's. Matching by arrival order would take the reply's done for the verdict.
    const { row, session, sent } = await one(ordinary, { texts: ["O"], delayMs: 200 }, undefined, PARALLEL, {
      createdDelayMs: { judge: 20, reply: 2 },
      replyAudioDelayMs: 10,
      replyDoneMs: 60,
    });
    const order = session.events
      .filter((r) => r.at >= row.t.judgeSent! && r.event.type.startsWith("response."))
      .map((r) => `${r.event.type}:${String((r.event.response as { id?: string } | undefined)?.id ?? r.event.response_id)}`);
    expect(order).toEqual([
      "response.created:resp_2",
      "response.output_audio.delta:resp_2",
      "response.created:resp_1",
      "response.output_text.delta:resp_1",
      "response.done:resp_2",
      "response.done:resp_1",
    ]);
    expect(row).toMatchObject({ verdict: "O", valid: true, judgeText: "O", decision: "reply", concurrencyErrors: [], errors: [] });
    expect(row.t.judgeDone! - row.t.judgeSent!).toBe(200);
    expect(row.t.judgeFirstDelta! - row.t.judgeSent!).toBe(40);
    expect(row.t.firstReplyAudio! - row.t.replySent!).toBe(10);
    expect(row.t.replyCreated! - row.t.replySent!).toBe(2);
    expect(row.t.audible).toBe(row.t.judgeDone);
    // The reply had finished by itself, so nothing was cancelled.
    expect(sent.filter((e) => e.type === "response.cancel")).toHaveLength(0);
    const md = summaryMarkdown(parallelRun([row]));
    expect(md).toContain("**Two out-of-band responses ran at once: yes.** On all 1 lines");
  });

  it("prints the mode and stagger at the top, and the parallel section only for a parallel run", () => {
    const top = (r: RunFile) => summaryMarkdown(r).split("\n").slice(0, 6).join("\n");
    expect(top(parallelRun([row({})]))).toContain("- Mode: parallel, stagger 0 ms");
    expect(top(runFile({ ...META, run: { mode: "parallel", staggerMs: 120 } }, { rows: [], seed: 0, order: [], sessions: [], eventNames: [] }))).toContain("- Mode: parallel, stagger 120 ms");
    expect(top(runFile({ ...META, run: SEQUENTIAL }, { rows: [], seed: 0, order: [], sessions: [], eventNames: [] }))).toContain("- Mode: sequential (the reply goes out after a valid O)");
    expect(top(run([]))).toContain("- Mode: sequential (a run from before brief 009");
    expect(summaryMarkdown(run([row({})]))).not.toContain("## Parallel");
    expect(summaryMarkdown(parallelRun([row({})]))).toContain("## Parallel");
    expect(summaryMarkdown(parallelRun([...probes(15, 700)]))).toContain("- Parallel p50 over 850 ms on 15 probes: **within**");
  });

  it("a whole parallel dry run: control lines held with muted audio counted, ordinary lines audible", async () => {
    const clock = new VirtualClock();
    const some = [ordinary, control, lines.find((l) => l.id === "o-02")!, lines.find((l) => l.id === "c-forget-1")!];
    const expectOf = new Map(some.map((l) => [l.id, l.expect]));
    const fake = fakeConnect({ clock, judge: (_i, turnId) => ({ texts: [expectOf.get(turnId) === "hold" ? "H" : "O"], delayMs: 300 }), replyAudioDelayMs: 200 });
    const audio = new Map(some.map((l) => [l.id, placeholderPcm(800)]));
    const out = await clock.run(runHarness({ lines: some, audio, voices: new Map(), models: { voice: "v", transcribe: "t" }, judge: SPIKE_JUDGE_SETTINGS, run: PARALLEL, seed: DEFAULT_SEED, apiKey: "k", connect: fake.connect, clock, log: () => {} }));
    const s = summarize(runFile({ ...META, run: PARALLEL }, out));
    // Every line's reply audio (200 ms) beat its verdict (300 ms), held lines included.
    expect(s.parallel).toMatchObject({ audioBeforeVerdict: { n: 4, of: 4 }, mutedOnHeld: { n: 2, of: 2 }, overlapped: 4, ranAtOnce: 4, errorLines: [] });
    expect(out.rows.filter((r) => r.expect === "ordinary").every((r) => r.decision === "reply" && r.t.audible === r.t.judgeDone)).toBe(true);
  });
});

/** Byte-joins PCM parts. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Room tone at an exact RMS: a square wave of ±level. */
function roomTone(ms: number, level: number): Uint8Array {
  const out = new Uint8Array(ms * 48);
  const v = new DataView(out.buffer);
  for (let i = 0; i < out.byteLength / 2; i++) v.setInt16(i * 2, i % 2 === 0 ? level : -level, true);
  return out;
}

function row(over: Partial<Row>): Row {
  return {
    lineId: "o-01",
    class: "smallTalk",
    expect: "ordinary",
    probe: false,
    session: 0,
    voice: null,
    audioMs: 1000,
    takeMs: 1000,
    trimmedMs: 0,
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
    derived: { judgeMs: 200, ordinaryLatencyMs: 800, asrMs: 400, commitToJudgeSentMs: 30 },
    errors: [],
    ...over,
  };
}

const META = { date: "2026-11-09T00:00:00.000Z", source: "synthetic" as const, transport: "fake" as const, lineSetCommit: "abc", lineSetHash: "f".repeat(64), models: { voice: "v", transcribe: "t" }, judge: AT_600 };
const run = (rows: Row[], source: "synthetic" | "owner" = "synthetic"): RunFile => runFile({ ...META, source }, { rows, seed: DEFAULT_SEED, order: rows.map((r) => r.lineId), sessions: [rows.map((r) => r.lineId)], eventNames: [] });
const probes = (n: number, latency: number | null) =>
  Array.from({ length: n }, (_, i) => row({ lineId: `o-${i}`, probe: true, derived: { judgeMs: 200, ordinaryLatencyMs: latency, ordinaryLatencyFromLoudMs: latency, asrMs: 400, commitToJudgeSentMs: 30 }, decision: latency === null ? "held" : "reply" }));
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
      row({ lineId: "o-a", decision: "held", verdict: "U", valid: false, invalidReason: "extraText", derived: { judgeMs: 200, ordinaryLatencyMs: null, asrMs: 700, commitToJudgeSentMs: 30 } }),
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
    const invalid = { valid: false, verdict: "U" as const, invalidReason: "incomplete" as const, judgeStatus: "incomplete", decision: "held" as const, derived: { judgeMs: 450, ordinaryLatencyMs: null, asrMs: 400, commitToJudgeSentMs: 30 } };
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
    const late = row({ lineId: "c-late", class: "forget", expect: "hold", verdict: "H", valid: true, timedOut: true, decision: "held", t: { ...row({}).t, judgeDone: 2100 }, derived: { judgeMs: 800, ordinaryLatencyMs: null, asrMs: 400, commitToJudgeSentMs: 30 } });
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
      row({ lineId: "o-a", session: 0, derived: { judgeMs: 400, ordinaryLatencyMs: 800, asrMs: 400, commitToJudgeSentMs: 30 } }),
      row({ lineId: "c-a", session: 0, expect: "hold", class: "forget", verdict: "H", decision: "held", derived: { judgeMs: 500, ordinaryLatencyMs: null, asrMs: 400, commitToJudgeSentMs: 30 } }),
      row({ lineId: "o-b", session: 1, derived: { judgeMs: 1100, ordinaryLatencyMs: 900, asrMs: 400, commitToJudgeSentMs: 30 } }),
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

  it("witness: flags a commit-to-judge-sent gap over 50 ms, with the p50 and the largest gap", () => {
    const at = (lineId: string, gap: number) => row({ lineId, t: { ...row({}).t, judgeSent: 1300 + gap } });
    const fair = summaryMarkdown(run([at("o-a", 20), at("o-b", 50)]));
    expect(fair).toContain("Commit to judge sent (the harness's own wait; judge time is fair only when this is near zero): p50 20 ms, largest 50 ms, over 2 line(s).");
    expect(fair).toContain("No line waited over 50 ms from commit to judge sent.");
    const rows = [at("o-a", 20), at("o-b", 30), at("o-slow", 120)];
    const s = summarize(run(rows));
    expect(s.commitToSendMs).toEqual({ p50: 30, max: 120, n: 3, flagged: [{ lineId: "o-slow", ms: 120 }] });
    expect(summaryMarkdown(run(rows))).toContain("**Over 50 ms from commit to judge sent on 1 line(s); their judge time includes the harness's wait:** o-slow (120 ms)");
  });

  it("witness: the Nov 9 run's commit-to-send gaps are over 300 ms on 34 lines, up to 1,281 ms", () => {
    const first = JSON.parse(readFileSync(new URL("./results/2026-11-09T18-41-59-158Z-owner.json", import.meta.url), "utf8")) as RunFile;
    const g = summarize(first).commitToSendMs;
    expect(g.n).toBe(60);
    expect(Math.round(g.max!)).toBe(1281);
    expect(g.flagged.filter((f) => f.ms > 300)).toHaveLength(34);
    expect(g.flagged.find((f) => f.ms === g.max)!.lineId).toBe("c-forget-2");
  });

  it("drops the transcripts of the owner's own takes", () => {
    expect(run([row({})], "owner").rows[0]!.transcript).toBeNull();
    expect(run([row({})], "synthetic").rows[0]!.transcript).toBe("hi");
  });

  it("brief 009 item 3: the stop rule reads latency from the last loud frame, and both measures print with their gap", () => {
    // From the last loud frame 700 ms (within); from audio_end_ms 1,000 ms, which alone would be over the line.
    const rows = Array.from({ length: 15 }, (_, i) => row({ lineId: `o-${i}`, probe: true, derived: { judgeMs: 200, ordinaryLatencyMs: 1000, ordinaryLatencyFromLoudMs: 700, vadEndAfterLoudMs: 290, asrMs: 400, commitToJudgeSentMs: 30 } }));
    const s = summarize(run(rows));
    expect(s.stops.latency).toBe("within");
    expect(s.probes.p50).toBe(700);
    expect(s.vadEndAfterLoudMs).toEqual({ p50: 290, p95: 290, n: 15 });
    const md = summaryMarkdown(run(rows));
    expect(md).toContain("| Ordinary latency from the last loud frame (end of audible speech to audible time; +60 ms playback in the browser) | 700 ms | 700 ms | 15 |");
    expect(md).toContain("| Ordinary latency from the VAD's end of speech (`speech_stopped.audio_end_ms` to audible time) | 1000 ms | 1000 ms | 15 |");
    expect(md).toContain("VAD end of speech (`audio_end_ms`) after the last loud frame: p50 290 ms, p95 290 ms, over 15 line(s).");
    // A run from before brief 009 has no last-loud-frame time: the latency rule is not measured, and says so.
    const before = JSON.parse(readFileSync(new URL("./results/2026-11-09T19-19-59-517Z-owner.json", import.meta.url), "utf8")) as RunFile;
    const b = summarize(before);
    expect(b.stops.latency).toBe("not measured");
    expect(Math.round(b.ordinaryLatencyMs.p50!)).toBe(1325);
    expect(summaryMarkdown(before)).toContain("VAD end of speech after the last loud frame: not measured (no row has both times).");
  });

  it("prints the judge settings at the top and the largest and p50 token counts", () => {
    const rows = [10, 12, 19].map((n, i) => row({ lineId: `o-${i}`, outputTokens: n + 1, reasoningTokens: n }));
    const s = summarize(run(rows));
    expect(s.reasoningTokens).toEqual({ n: 3, p50: 12, max: 19 });
    expect(s.outputTokens).toEqual({ n: 3, p50: 13, max: 20 });
    const md = summaryMarkdown(run(rows));
    expect(md.split("\n").slice(0, 6).join("\n")).toContain("- Judge: judge_v1, deadline 600 ms, max_output_tokens inf (no cap), reasoning effort minimal");
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
    expect(out.judge).toEqual({ contract: "judge_v1", maxOutputTokens: "inf", effort: "minimal", deadlineMs: APP_JUDGE_SETTINGS.deadlineMs });
    expect(out.run).toEqual({ mode: "parallel", staggerMs: 0 });
    expect(logs[3]).toMatch(/^harness: mode parallel, stagger 0 ms;/);
    expect(Object.fromEntries(out.rows.map((r) => [r.lineId, r.decision]))).toEqual({ "c-forget-1": "held", "o-01": "reply" });
  });

  it("passes --max-tokens and --effort to the judge and the run file, and refuses bad values", async () => {
    const d = spikeDir();
    const logs: string[] = [];
    expect(await main(["harness", "--lines", "o-01", "--max-tokens", "64", "--effort", "low"], { spikeDir: d, env: {}, log: (l) => logs.push(l) })).toBe(0);
    expect(logs[1]).toBe("harness: judge judge_v1, deadline 1200 ms, max_output_tokens 64, effort low; line order seed 7");
    const file = readdirSync(join(d, "dist", "dry-run")).find((f) => f.endsWith(".json"))!;
    expect((JSON.parse(readFileSync(join(d, "dist", "dry-run", file), "utf8")) as RunFile).judge).toEqual({ contract: "judge_v1", maxOutputTokens: 64, effort: "low", deadlineMs: 1_200 });
    expect(judgeSettings({})).toEqual(SPIKE_JUDGE_SETTINGS);
    expect(judgeSettings({ "max-tokens": "inf" }).maxOutputTokens).toBe("inf");
    for (const bad of ["0", "-3", "1.5", "16x", "Infinity"]) expect(() => judgeSettings({ "max-tokens": bad })).toThrow(/--max-tokens/);
    expect(() => judgeSettings({ effort: "max" })).toThrow(/--effort/);
  });

  it("takes --mode and --stagger-ms, defaults to parallel with no stagger, and refuses bad values", async () => {
    expect(runSettings({})).toEqual({ mode: "parallel", staggerMs: 0 });
    expect(runSettings({ mode: "sequential" })).toEqual({ mode: "sequential", staggerMs: 0 });
    expect(runSettings({ "stagger-ms": "120" })).toEqual({ mode: "parallel", staggerMs: 120 });
    expect(() => runSettings({ mode: "both" })).toThrow(/--mode/);
    for (const bad of ["-1", "1.5", "x", "1201"]) expect(() => runSettings({ "stagger-ms": bad })).toThrow(/--stagger-ms/);
    expect(() => runSettings({ mode: "sequential", "stagger-ms": "120" })).toThrow(/parallel only/);
    const d = spikeDir();
    const logs: string[] = [];
    expect(await main(["harness", "--lines", "o-01,c-forget-1", "--mode", "sequential"], { spikeDir: d, env: {}, log: (l) => logs.push(l) })).toBe(0);
    expect(logs[3]).toBe("harness: mode sequential; the reply goes out only after a valid O");
    const file = readdirSync(join(d, "dist", "dry-run")).find((f) => f.endsWith(".json"))!;
    const out = JSON.parse(readFileSync(join(d, "dist", "dry-run", file), "utf8")) as RunFile;
    expect(out.run).toEqual({ mode: "sequential", staggerMs: 0 });
    expect(out.rows.every((r) => r.t.replyCreated === null)).toBe(true);
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

  it("refuses an all-silent take before connecting, live or dry", async () => {
    const d = spikeDir();
    mkdirSync(join(d, "audio", "owner"), { recursive: true });
    writeFileSync(join(d, "audio", "owner", "o-01.wav"), encodeWav(new Uint8Array(2000 * 48)));
    for (const live of [false, true]) {
      let liveCalls = 0;
      const logs: string[] = [];
      const code = await main(["harness", "--source", "owner", "--lines", "o-01", ...(live ? ["--live"] : [])], {
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
      expect(logs.join("\n")).toContain(`refusing takes with no speech (${NO_SPEECH}):\n  o-01`);
      expect(existsSync(join(d, "dist"))).toBe(false);
    }
  });

  it("logs how much trailing silence it trimmed", async () => {
    const d = spikeDir();
    mkdirSync(join(d, "audio", "owner"), { recursive: true });
    writeFileSync(join(d, "audio", "owner", "o-01.wav"), encodeWav(concat(placeholderPcm(1000), new Uint8Array(1500 * 48))));
    const logs: string[] = [];
    expect(await main(["harness", "--source", "owner", "--lines", "o-01"], { spikeDir: d, env: {}, log: (l) => logs.push(l) })).toBe(0);
    expect(logs[0]).toBe("harness: 1 lines, 1.1 s of audio, source owner, fake transport");
    expect(logs[2]).toBe(`harness: 1.4 s of trailing silence trimmed from the takes (speech threshold RMS ${SPEECH_RMS_THRESHOLD}, 100 ms kept)`);
    const file = readdirSync(join(d, "dist", "dry-run")).find((f) => f.endsWith(".json"))!;
    const out = JSON.parse(readFileSync(join(d, "dist", "dry-run", file), "utf8")) as RunFile;
    expect(out.version).toBe("judge-spike-run-4");
    expect(out.rows[0]).toMatchObject({ takeMs: 2500, trimmedMs: 1400, audioMs: 1100 });
  });

  it("keeps the synth command dry without --live", async () => {
    const d = spikeDir();
    const logs: string[] = [];
    expect(await main(["synth", "--lines", "o-01"], { spikeDir: d, env: {}, log: (l) => logs.push(l) })).toBe(0);
    expect(logs.at(-1)).toContain("dry run, nothing sent");
    expect(existsSync(join(d, "audio"))).toBe(false);
  });
});

describe("judge spike, judge_v2 and the slow parse per line (voice-control R17)", () => {
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

  it("--judge judge_v2 sends the v2 instructions with metadata.contract; the default is judge_v1 at the app's deadline", async () => {
    expect(judgeSettings({ judge: "judge_v2" })).toEqual({ ...SPIKE_JUDGE_SETTINGS, contract: "judge_v2" });
    expect(SPIKE_JUDGE_SETTINGS).toMatchObject({ contract: "judge_v1", deadlineMs: APP_JUDGE_SETTINGS.deadlineMs });
    expect(() => judgeSettings({ judge: "judge_v3" })).toThrow(/--judge/);
    const v2 = await one(ordinary, { texts: ["O"] }, undefined, SEQUENTIAL, {}, { ...SPIKE_JUDGE_SETTINGS, contract: "judge_v2" });
    const judge = v2.creates.find((c) => (c.metadata as Record<string, string>).purpose === "judge")!;
    expect(judge.instructions).toBe(JUDGE_V2_INSTRUCTIONS);
    expect(judge.metadata).toMatchObject({ contract: "judge_v2" });
    const v1 = await one(ordinary, { texts: ["O"] });
    expect(v1.creates.find((c) => (c.metadata as Record<string, string>).purpose === "judge")!.metadata).toMatchObject({ contract: "judge_v1" });
  });

  it("each row has the regex match, the probabilities, the parse time and missedDeadline", async () => {
    const forget = lines.find((l) => l.class === "forget")!;
    const parse = lineParser(fakeDecisionsPort(), {}, false);
    const fast = await parse(forget.id, "please forget what I said");
    expect(fast.regex).toEqual({ hit: true, ids: ["RX1"] });
    expect(fast.parse).toMatchObject({ chosen: null, ordinary: true, ms: 0, missedDeadline: false, failure: null });
    expect(Object.values(fast.parse.probabilities!).every((p) => p === 0)).toBe(true);

    // A port that answers in 1,100 ms: on the Harness's wait, but past the app's 1,000 ms.
    const slowPort = { decide: async (body: Parameters<ReturnType<typeof fakeDecisionsPort>["decide"]>[0]) => ({ ...(await fakeDecisionsPort().decide(body, HARNESS_PARSE_WAIT_MS)), ms: 1_100 }) };
    const late = await lineParser(slowPort, {}, false)("o-01", "my dog loves the park");
    expect(late.parse).toMatchObject({ ms: 1_100, missedDeadline: true, ordinary: true });
    expect(late.regex).toEqual({ hit: false, ids: [] });

    const clock = new VirtualClock();
    const fake = fakeConnect({ clock, judge: () => ({ texts: ["O"] }) });
    const out = await clock.run(
      runHarness({ lines: [ordinary], audio: new Map([[ordinary.id, placeholderPcm(1200)]]), voices: new Map(), models: { voice: "v", transcribe: "t" }, judge: SPIKE_JUDGE_SETTINGS, run: SEQUENTIAL, seed: 1, apiKey: "k", connect: fake.connect, clock, log: () => {}, parseLine: parse }),
    );
    expect(out.rows[0]!.regex).toEqual({ hit: false, ids: [] });
    expect(out.rows[0]!.parse).toMatchObject({ ordinary: true, ms: 0, missedDeadline: false });
  });

  it("the summary prints judge recall, slow-parse recall and joint miss per class, false holds for each, and the parse time", () => {
    const probs = (p: Record<string, number>) => ({ forget: 0, quiet: 0, correct: 0, transition: 0, hardRule: 0, crisis: 0, company: 0, alone: 0, why: 0, rushed: 0, food: 0, action: 0, answer: 0, uncertainSpeaker: 0, ...p });
    const parse = (p: Record<string, number>, ms: number, ordinary: boolean) => ({ probabilities: probs(p), chosen: ordinary ? null : Object.keys(p)[0]!, ordinary, ms, missedDeadline: ms > 1_000, failure: null });
    const rows = [
      // company: the judge passes 2 of 3; the parse catches 2; one line both miss.
      row({ lineId: "c-company-1", class: "company", expect: "hold", verdict: "H", decision: "held", parse: parse({ company: 0.9 }, 200, false) }),
      row({ lineId: "c-company-2", class: "company", expect: "hold", verdict: "O", decision: "reply", parse: parse({ company: 0.5 }, 300, false) }),
      row({ lineId: "c-company-3", class: "company", expect: "hold", verdict: "O", decision: "reply", parse: parse({}, 1_100, true) }),
      // ordinary: the judge holds one, the parse finds one not ordinary.
      row({ lineId: "o-01", verdict: "H", decision: "held", parse: parse({}, 100, true) }),
      row({ lineId: "o-02", parse: parse({ food: 0.3 }, 1_500, false) }),
    ];
    const r = run(rows);
    const s = summarize(r);
    expect(s.slowParse!.byClass.company).toEqual({ judgeRecall: { n: 1, of: 3, missing: 0 }, parseRecall: { n: 2, of: 3, missing: 0 }, jointMiss: { n: 1, of: 3, missing: 0 } });
    expect(s.slowParse!.falseHolds).toEqual({ judge: { n: 1, of: 2, missing: 0 }, parse: { n: 1, of: 2, missing: 0 } });
    expect(s.slowParse!.overDeadline).toEqual({ n: 2, of: 5, missing: 0 });
    expect(s.slowParse!.ms).toEqual({ p50: 300, p95: 1_500, n: 5 });
    const md = summaryMarkdown({ ...r, decisions: "fake" });
    expect(md).toContain("## Slow parse");
    expect(md).toContain("**Fake Decisions port");
    expect(md).toContain("| company | 33.3% (1 of 3) | 66.7% (2 of 3) | 33.3% (1 of 3) |");
    expect(md).toContain("- False holds on ordinary lines: judge 50.0% (1 of 2), slow parse 50.0% (1 of 2)");
    expect(md).toContain("- Parses over 1000 ms: 40.0% (2 of 5); parse time p50 300 ms, p95 1500 ms, over 5 parse(s)");
    expect(summaryMarkdown({ ...r, decisions: "live" })).not.toContain("**Fake Decisions port");
    // A run from before brief 011 has no parse and no section.
    expect(summarize(run([row({})])).slowParse).toBeNull();
    expect(summaryMarkdown(run([row({})]))).not.toContain("## Slow parse");
  });

  it("the run file records the deadline, the contract name and the Decisions port; lines.json is not written", async () => {
    const d = spikeDir();
    const before = readFileSync(join(d, "lines.json"), "utf8");
    const logs: string[] = [];
    expect(await main(["harness", "--lines", "o-01,c-forget-1", "--judge", "judge_v2"], { spikeDir: d, env: {}, log: (l) => logs.push(l) })).toBe(0);
    const file = readdirSync(join(d, "dist", "dry-run")).find((f) => f.endsWith(".json"))!;
    const out = JSON.parse(readFileSync(join(d, "dist", "dry-run", file), "utf8")) as RunFile;
    expect(out.judge).toMatchObject({ contract: "judge_v2", deadlineMs: APP_JUDGE_SETTINGS.deadlineMs });
    expect(out.decisions).toBe("fake");
    expect(out.rows.every((r) => r.parse !== undefined && r.regex !== undefined)).toBe(true);
    expect(logs).toContain("harness: slow parse per line through the fake Decisions port (every probability 0, 0 ms)");
    const md = readFileSync(join(d, "dist", "dry-run", file.replace(/\.json$/, ".md")), "utf8");
    expect(md).toContain("- Judge: judge_v2, deadline 1200 ms");
    expect(readFileSync(join(d, "lines.json"), "utf8")).toBe(before);
  });
});
