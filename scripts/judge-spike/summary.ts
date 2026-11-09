/**
 * The judge spike's numbers (brief 006 item 4): the run file and its Markdown summary. Pure. A stop rule reads
 * `within` only when every number it needs was measured; a missing number gives `not measured`, or `over the
 * line` when the rule fails even if every missing number had come out at its best.
 */
import { CONTROL_CLASSES } from "./lines";
import type { HarnessOutput, Row } from "./harness";
import type { AudioSource } from "./paths";

export const LATENCY_STOP_MS = 850;
export const RECALL_STOP = 0.9;
export const PROBE_COUNT = 15;
/** Browser playback adds about this much after the first audio delta (spec §3 budget). */
export const PLAYBACK_MS = 60;
/** The slow gate falls back to the transcript after this (brief 006 "What is being measured"). */
export const ASR_FALLBACK_MS = 600;

export interface RunMeta {
  date: string;
  source: AudioSource;
  transport: "live" | "fake";
  lineSetCommit: string;
  lineSetHash: string;
  models: { voice: string; transcribe: string };
}

export interface RunFile extends RunMeta {
  version: "judge-spike-run-1";
  sessions: string[][];
  eventNames: string[];
  rows: Row[];
}

export function runFile(meta: RunMeta, out: HarnessOutput): RunFile {
  // No transcript of the owner's own takes leaves the machine in a committed file (brief 006 item 4).
  const rows = meta.source === "owner" ? out.rows.map((r) => ({ ...r, transcript: null })) : out.rows;
  return { version: "judge-spike-run-1", ...meta, sessions: out.sessions, eventNames: out.eventNames, rows };
}

/** Nearest-rank percentile; null for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export type StopState = "over the line" | "within" | "not measured";

export interface Ratio {
  n: number;
  of: number;
  /** Lines that ran but have no number. */
  missing: number;
}

const held = (r: Row) => r.decision === "held";
const judged = (r: Row) => r.decision !== null;
const share = (x: Ratio) => (x.of === 0 ? null : x.n / x.of);

export interface Summary {
  lines: number;
  judged: number;
  validVerdicts: Ratio;
  recall: Ratio;
  recallByClass: Record<string, Ratio>;
  falseHolds: Ratio;
  timeouts: number;
  invalidReasons: Record<string, number>;
  reasoningTokens: { reported: number; values: number[] };
  judgeMs: { p50: number | null; p95: number | null; n: number };
  ordinaryLatencyMs: { p50: number | null; p95: number | null; n: number };
  asrMs: { p50: number | null; p95: number | null; n: number; withinFallback: number };
  probes: { p50: number | null; measured: number; total: number };
  stops: { verdict: StopState; latency: StopState; recall: StopState };
}

function ratio(rows: readonly Row[], hit: (r: Row) => boolean): Ratio {
  const measured = rows.filter(judged);
  return { n: measured.filter(hit).length, of: measured.length, missing: rows.length - measured.length };
}

const dist = (values: number[]) => ({ p50: percentile(values, 50), p95: percentile(values, 95), n: values.length });
const nums = (rows: readonly Row[], f: (r: Row) => number | null) => rows.map(f).filter((v): v is number => v !== null);

export function summarize(run: RunFile): Summary {
  const rows = run.rows;
  const control = rows.filter((r) => r.expect === "hold");
  const ordinary = rows.filter((r) => r.expect === "ordinary");
  const probes = rows.filter((r) => r.probe);
  const invalidReasons: Record<string, number> = {};
  for (const r of rows) if (r.invalidReason !== null) invalidReasons[r.invalidReason] = (invalidReasons[r.invalidReason] ?? 0) + 1;
  const reasoning = nums(rows, (r) => r.reasoningTokens);
  const asr = nums(rows, (r) => r.derived.asrMs);
  const probeLatencies = nums(probes, (r) => r.derived.ordinaryLatencyMs);

  const validVerdicts: Ratio = { n: rows.filter((r) => r.valid === true).length, of: rows.filter((r) => r.t.judgeSent !== null).length, missing: 0 };
  validVerdicts.missing = rows.length - validVerdicts.of;
  const recall = ratio(control, held);

  // Rule 1 (spec §14): no verdict on real audio at all.
  const verdict: StopState = validVerdicts.n > 0 ? "within" : validVerdicts.of > 0 ? "over the line" : "not measured";

  // Rule 2: sequential p50 over the 15 probes above 850 ms. A held probe has no reply latency, so it is missing.
  let latency: StopState = "not measured";
  if (probes.length === PROBE_COUNT && probeLatencies.length === PROBE_COUNT) {
    latency = percentile(probeLatencies, 50)! > LATENCY_STOP_MS ? "over the line" : "within";
  } else if (probeLatencies.length > 0) {
    // Best case: every missing probe as fast as zero. If even that p50 is over, the rule fails.
    const best = [...probeLatencies, ...Array<number>(Math.max(0, PROBE_COUNT - probeLatencies.length)).fill(0)];
    if (percentile(best, 50)! > LATENCY_STOP_MS) latency = "over the line";
  }

  // Rule 3: control recall under 90%. Best case counts every missing control line as held.
  let recallState: StopState = "not measured";
  if (recall.of > 0 || recall.missing > 0) {
    const best = (recall.n + recall.missing) / (recall.of + recall.missing);
    if (best < RECALL_STOP) recallState = "over the line";
    else if (recall.missing === 0 && recall.of > 0) recallState = share(recall)! < RECALL_STOP ? "over the line" : "within";
  }

  return {
    lines: rows.length,
    judged: rows.filter(judged).length,
    validVerdicts,
    recall,
    recallByClass: Object.fromEntries(CONTROL_CLASSES.map((c) => [c, ratio(control.filter((r) => r.class === c), held)])),
    falseHolds: ratio(ordinary, held),
    timeouts: rows.filter((r) => r.timedOut).length,
    invalidReasons,
    reasoningTokens: { reported: reasoning.length, values: [...new Set(reasoning)].sort((a, b) => a - b) },
    judgeMs: dist(nums(rows, (r) => r.derived.judgeMs)),
    ordinaryLatencyMs: dist(nums(rows, (r) => r.derived.ordinaryLatencyMs)),
    asrMs: { ...dist(asr), withinFallback: asr.filter((v) => v <= ASR_FALLBACK_MS).length },
    probes: { p50: percentile(probeLatencies, 50), measured: probeLatencies.length, total: probes.length },
    stops: { verdict, latency, recall: recallState },
  };
}

const ms = (v: number | null) => (v === null ? "—" : `${Math.round(v)} ms`);
const pct = (x: Ratio) => (x.of === 0 ? "—" : `${((x.n / x.of) * 100).toFixed(1)}% (${x.n} of ${x.of}${x.missing > 0 ? `, ${x.missing} not measured` : ""})`);

export function summaryMarkdown(run: RunFile, s: Summary = summarize(run)): string {
  const out: string[] = [];
  out.push(`# Judge spike run, ${run.date}`);
  out.push("");
  if (run.transport === "fake") out.push("**Fake transport: these numbers come from the scripted fake server, not from OpenAI. They measure nothing.**", "");
  out.push(`- Audio: ${run.source}${run.source === "synthetic" ? " (text-to-speech, not a person's voice)" : " (the owner's own takes)"}`);
  out.push(`- Line set: commit ${run.lineSetCommit}, hash ${run.lineSetHash.slice(0, 12)}`);
  out.push(`- Models: voice ${run.models.voice}, transcription ${run.models.transcribe}`);
  out.push(`- Lines: ${s.lines} run, ${s.judged} judged, in ${run.sessions.length} session(s)`);
  out.push("");
  out.push("## Spec §14 stop rules");
  out.push("");
  out.push(`- No valid verdict on real audio: **${s.stops.verdict}**`);
  out.push(`- Sequential p50 over 850 ms on 15 probes: **${s.stops.latency}** (p50 ${ms(s.probes.p50)} over ${s.probes.measured} of ${s.probes.total} probes; browser playback adds about ${PLAYBACK_MS} ms)`);
  out.push(`- Control recall under 90%: **${s.stops.recall}** (${pct(s.recall)})`);
  out.push("");
  out.push("## Judge");
  out.push("");
  out.push(`- Valid verdicts: ${pct(s.validVerdicts)}`);
  out.push(`- Control recall (held as H, U or timeout): ${pct(s.recall)}`);
  for (const [c, r] of Object.entries(s.recallByClass)) out.push(`  - ${c}: ${pct(r)}`);
  out.push(`- False holds on ordinary lines: ${pct(s.falseHolds)}`);
  out.push(`- Timeouts (no response.done within 600 ms of commit): ${s.timeouts}`);
  const reasons = Object.entries(s.invalidReasons);
  out.push(`- Invalid-verdict reasons: ${reasons.length === 0 ? "none" : reasons.map(([k, v]) => `${k} ${v}`).join(", ")}${s.invalidReasons.extraText ? " (extraText includes any preamble)" : ""}`);
  out.push(
    `- Reasoning tokens in judge usage: ${s.reasoningTokens.reported === 0 ? "not reported in any usage object" : `reported on ${s.reasoningTokens.reported} line(s), values ${s.reasoningTokens.values.join(", ")}`}`,
  );
  out.push("");
  out.push("## Times");
  out.push("");
  out.push("| Measure | p50 | p95 | n |");
  out.push("|---|---|---|---|");
  out.push(`| Judge (commit to judge done) | ${ms(s.judgeMs.p50)} | ${ms(s.judgeMs.p95)} | ${s.judgeMs.n} |`);
  out.push(`| Ordinary latency (end of speech to first reply audio; +${PLAYBACK_MS} ms playback in the browser) | ${ms(s.ordinaryLatencyMs.p50)} | ${ms(s.ordinaryLatencyMs.p95)} | ${s.ordinaryLatencyMs.n} |`);
  out.push(`| ASR (commit to transcription done) | ${ms(s.asrMs.p50)} | ${ms(s.asrMs.p95)} | ${s.asrMs.n} |`);
  out.push("");
  out.push(`Transcripts within ${ASR_FALLBACK_MS} ms of commit: ${s.asrMs.n === 0 ? "—" : `${s.asrMs.withinFallback} of ${s.asrMs.n}`}.`);
  out.push("");
  out.push("## Sessions");
  out.push("");
  run.sessions.forEach((ids, i) => out.push(`- Session ${i + 1}: ${ids.join(", ")}`));
  out.push("");
  return out.join("\n");
}
