/**
 * The judge spike's numbers (brief 006 item 4, brief 007 item 3): the run file and its Markdown summary. Pure. A
 * stop rule reads `within` only when every number it needs was measured; a missing number gives `not measured`,
 * or `over the line` when the rule fails even if every missing number had come out at its best. The stop rules
 * read the judge's own verdicts within the deadline, never a hold defaulted from an invalid answer.
 */
import { CANDIDATE_P, DECISIONS_DEADLINE_MS, type JudgeSettings, type JudgeVerdict } from "@franki/core";
import { CONTROL_CLASSES } from "./lines";
import type { DecisionsKind } from "./decisions";
import type { HarnessOutput, Row, RunSettings } from "./harness";
import type { AudioSource } from "./paths";

export const LATENCY_STOP_MS = 850;
export const RECALL_STOP = 0.9;
/** Brief 007 item 3: the "no valid verdict" rule fails when fewer than 90% of the lines have one. */
export const VALID_VERDICT_STOP = 0.9;
export const PROBE_COUNT = 15;
/** Browser playback adds about this much after the first audio delta (spec §3 budget). */
export const PLAYBACK_MS = 60;
/** The slow gate falls back to the transcript after this (brief 006 "What is being measured"). */
export const ASR_FALLBACK_MS = 600;
/**
 * Brief 008: a line whose commit-to-judge-sent gap is over this is flagged. That gap is the harness's own wait, so
 * the judge time measured from commit is fair only when it is near zero.
 */
export const COMMIT_TO_SEND_FLAG_MS = 50;

export interface RunMeta {
  date: string;
  source: AudioSource;
  transport: "live" | "fake";
  lineSetCommit: string;
  lineSetHash: string;
  models: { voice: string; transcribe: string };
  /** The judge's settings for this run. Runs before brief 011 carry only the cap and effort, and ran judge_v1 at 600 ms. */
  judge: Pick<JudgeSettings, "maxOutputTokens" | "effort"> & Partial<Pick<JudgeSettings, "contract" | "deadlineMs">>;
  /** Sequential or parallel, and the stagger (brief 009). Absent in runs before it, which were all sequential. */
  run?: RunSettings;
  /** The Decisions_Port of the slow parse per line (voice-control R17.2). Absent in runs before brief 011. */
  decisions?: DecisionsKind;
}

export interface RunFile extends RunMeta {
  version: "judge-spike-run-4";
  /** The line-order seed, and the line IDs in the order they ran. */
  seed: number;
  order: string[];
  sessions: string[][];
  eventNames: string[];
  rows: Row[];
}

export function runFile(meta: RunMeta, out: HarnessOutput): RunFile {
  // No transcript of the owner's own takes leaves the machine in a committed file (brief 006 item 4).
  const rows = meta.source === "owner" ? out.rows.map((r) => ({ ...r, transcript: null })) : out.rows;
  return { version: "judge-spike-run-4", ...meta, seed: out.seed, order: out.order, sessions: out.sessions, eventNames: out.eventNames, rows };
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

const judged = (r: Row) => r.decision !== null;
const share = (x: Ratio) => (x.of === 0 ? null : x.n / x.of);

/** Whether the deadline applies: `deadline` is what ships (contracts §5, 600 ms); `untimed` counts any time. */
export type Timing = "deadline" | "untimed";

/** The judge's own valid verdict for a row, or null: an invalid answer, a timeout or no response.done is none. */
export function judgeVerdictOf(r: Row, timing: Timing): JudgeVerdict | null {
  if (!judged(r) || r.valid !== true || r.verdict === null || r.t.judgeDone === null) return null;
  if (timing === "deadline" && r.timedOut) return null;
  return r.verdict;
}

/**
 * What a view counts as held. `judge`: only the judge's own H or U. `app`: anything but a valid O holds, as the
 * Browser_Client acts (an invalid answer or a timeout is U).
 */
export type ViewName = "judge" | "app";
const heldIn = (view: ViewName, timing: Timing) => (r: Row) => {
  const v = judgeVerdictOf(r, timing);
  return view === "judge" ? v === "H" || v === "U" : v !== "O";
};
/** An ordinary line passes only on a valid O. Both views count anything else as a false hold, so they agree here. */
const notPassed = (timing: Timing) => (r: Row) => judgeVerdictOf(r, timing) !== "O";

export interface View {
  recall: Ratio;
  recallByClass: Record<string, Ratio>;
  falseHolds: Ratio;
}

export const VIEWS: readonly { view: ViewName; timing: Timing; key: ViewKey; label: string }[] = [
  { view: "judge", timing: "deadline", key: "judgeDeadline", label: "Judge verdicts, within 600 ms" },
  { view: "judge", timing: "untimed", key: "judgeUntimed", label: "Judge verdicts, any time" },
  { view: "app", timing: "deadline", key: "appDeadline", label: "As the app would act, within 600 ms" },
  { view: "app", timing: "untimed", key: "appUntimed", label: "As the app would act, any time" },
];
export type ViewKey = "judgeDeadline" | "judgeUntimed" | "appDeadline" | "appUntimed";

export interface TokenStats {
  /** Judge responses whose usage reported the count. */
  n: number;
  p50: number | null;
  max: number | null;
}

const tokenStats = (values: number[]): TokenStats => ({ n: values.length, p50: percentile(values, 50), max: values.length === 0 ? null : Math.max(...values) });

export interface Summary {
  lines: number;
  judged: number;
  /** Lines with the judge's own valid verdict, out of every line run; lines never judged are missing. */
  validVerdicts: Record<Timing, Ratio>;
  views: Record<ViewKey, View>;
  timeouts: number;
  invalidReasons: Record<string, number>;
  reasoningTokens: TokenStats;
  outputTokens: TokenStats;
  judgeMs: { p50: number | null; p95: number | null; n: number };
  /** From the VAD's end of speech (`speech_stopped.audio_end_ms`) to audible time. */
  ordinaryLatencyMs: { p50: number | null; p95: number | null; n: number };
  /** From the end of audible speech (the take's last loud frame) to audible time; the stop rule reads this. */
  ordinaryLatencyFromLoudMs: { p50: number | null; p95: number | null; n: number };
  /** The VAD's end of speech minus the last loud frame's send time (brief 009 item 3). */
  vadEndAfterLoudMs: { p50: number | null; p95: number | null; n: number };
  asrMs: { p50: number | null; p95: number | null; n: number; withinFallback: number };
  /** Commit to judge sent: p50, largest, and the lines over COMMIT_TO_SEND_FLAG_MS with their gap. */
  commitToSendMs: { p50: number | null; max: number | null; n: number; flagged: { lineId: string; ms: number }[] };
  probes: { p50: number | null; measured: number; total: number };
  /** Parallel runs only (brief 009 item 4); null for a sequential run. */
  parallel: ParallelStats | null;
  /** The slow parse beside the judge (voice-control R17.4, R17.5); null when no row has a parse. */
  slowParse: SlowParseStats | null;
  /** Per session: its lines by kind and its judge time, so a session effect shows. */
  sessions: SessionStats[];
  stops: { verdict: StopState; latency: StopState; recall: StopState };
}

export interface ParallelStats {
  /** Judge sent to judge done. */
  judgeFromSendMs: { p50: number | null; p95: number | null; n: number };
  /** Reply sent to its first audio delta. */
  replyFromSendMs: { p50: number | null; p95: number | null; n: number };
  /** Lines with both a verdict and reply audio, and how many had the audio first. */
  audioBeforeVerdict: { n: number; of: number };
  /** Held lines whose reply went out, and how many of them got reply audio before the cancel (kept muted). */
  mutedOnHeld: { n: number; of: number };
  /** Lines whose reply went out while their judge was still running. */
  overlapped: number;
  /** Of those, the lines where both responses were created and no error event came. */
  ranAtOnce: number;
  /** Lines with an error event (or a failed reply), with the first error's code or type and message. */
  errorLines: { lineId: string; count: number; first: string }[];
}

/** The run's mode; a run file from before brief 009 has none and was sequential. */
export const runModeOf = (run: RunFile): RunSettings => run.run ?? { mode: "sequential", staggerMs: 0 };

const errorText = (e: unknown): string => {
  const ev = typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {};
  const inner = (typeof ev.error === "object" && ev.error !== null ? ev.error : typeof ev.response === "object" && ev.response !== null ? (ev.response as Record<string, unknown>).status_details : ev) as Record<string, unknown> | null;
  const i = inner ?? {};
  const head = [i.code, i.type].find((v) => typeof v === "string") ?? String(ev.type ?? "unknown");
  const reason = typeof i.message === "string" ? i.message : typeof i.reason === "string" ? i.reason : "";
  return reason === "" ? String(head) : `${String(head)}: ${reason}`;
};

function parallelStats(rows: readonly Row[]): ParallelStats {
  const t = (r: Row) => r.t;
  const has = (v: number | null | undefined): v is number => typeof v === "number";
  const both = rows.filter((r) => has(t(r).judgeDone) && has(t(r).firstReplyAudio));
  const heldSent = rows.filter((r) => r.decision === "held" && has(t(r).replySent));
  const overlapped = rows.filter((r) => has(t(r).replySent) && (!has(t(r).judgeDone) || t(r).replySent! < t(r).judgeDone!));
  const clean = (r: Row) => (r.concurrencyErrors ?? []).length === 0;
  return {
    judgeFromSendMs: dist(nums(rows, (r) => (has(t(r).judgeSent) && has(t(r).judgeDone) ? t(r).judgeDone! - t(r).judgeSent! : null))),
    replyFromSendMs: dist(nums(rows, (r) => (has(t(r).replySent) && has(t(r).firstReplyAudio) ? t(r).firstReplyAudio! - t(r).replySent! : null))),
    audioBeforeVerdict: { n: both.filter((r) => t(r).firstReplyAudio! < t(r).judgeDone!).length, of: both.length },
    mutedOnHeld: { n: heldSent.filter((r) => r.mutedReplyAudio === true).length, of: heldSent.length },
    overlapped: overlapped.length,
    ranAtOnce: overlapped.filter((r) => has(t(r).replyCreated) && clean(r)).length,
    errorLines: rows.filter((r) => !clean(r)).map((r) => ({ lineId: r.lineId, count: r.concurrencyErrors!.length, first: errorText(r.concurrencyErrors![0]) })),
  };
}

export interface SessionStats {
  session: number;
  lines: number;
  control: number;
  ordinary: number;
  judgeMs: { p50: number | null; n: number };
}

function ratio(rows: readonly Row[], hit: (r: Row) => boolean): Ratio {
  const measured = rows.filter(judged);
  return { n: measured.filter(hit).length, of: measured.length, missing: rows.length - measured.length };
}

/**
 * A share rule: `over the line` when it fails even with every missing line at its best (a hit), `within` only
 * when nothing is missing and it passes, else `not measured`.
 */
function shareRule(x: Ratio, fails: (share: number) => boolean): StopState {
  const total = x.of + x.missing;
  if (total === 0) return "not measured";
  if (fails((x.n + x.missing) / total)) return "over the line";
  if (x.missing === 0) return fails(share(x)!) ? "over the line" : "within";
  return "not measured";
}

const dist = (values: number[]) => ({ p50: percentile(values, 50), p95: percentile(values, 95), n: values.length });
const nums = (rows: readonly Row[], f: (r: Row) => number | null) => rows.map(f).filter((v): v is number => typeof v === "number");

/** The Probe_Line class names the TurnIntents probability that should catch it. */
export const LINE_INTENT: Record<(typeof CONTROL_CLASSES)[number], string> = { forget: "forget", company: "company", quiet: "quiet", correction: "correct", hardRule: "hardRule", crisis: "crisis" };

export interface SlowParseStats {
  /** Per control class: the judge's catch (anything but a valid O within the deadline), the parse's (its class at or above 0.20), and both missing. */
  byClass: Record<string, { judgeRecall: Ratio; parseRecall: Ratio; jointMiss: Ratio }>;
  /** Ordinary lines the judge held, and ordinary lines the parse didn't find ordinary. */
  falseHolds: { judge: Ratio; parse: Ratio };
  /** Parses over the app's 350 ms deadline, and the parse time. */
  overDeadline: Ratio;
  ms: { p50: number | null; p95: number | null; n: number };
  /** Invalid answers and which check each failed (review of the live run, item 4). */
  invalid: { n: number; reasons: Record<string, number> };
}

/** A Ratio over the rows that have a parse; rows without one are `missing`. */
function parsedRatio(rows: readonly Row[], hit: (r: Row) => boolean): Ratio {
  const measured = rows.filter((r) => r.parse != null);
  return { n: measured.filter(hit).length, of: measured.length, missing: rows.length - measured.length };
}

function slowParseStats(rows: readonly Row[]): SlowParseStats | null {
  if (!rows.some((r) => r.parse != null)) return null;
  const judgePassed = (r: Row) => judgeVerdictOf(r, "deadline") === "O";
  const byClass: SlowParseStats["byClass"] = {};
  for (const c of CONTROL_CLASSES) {
    const of = rows.filter((r) => r.expect === "hold" && r.class === c);
    const caught = (r: Row) => (r.parse?.probabilities?.[LINE_INTENT[c]] ?? 0) >= CANDIDATE_P;
    byClass[c] = {
      judgeRecall: ratio(of, (r) => !judgePassed(r)),
      parseRecall: parsedRatio(of, caught),
      jointMiss: parsedRatio(of.filter(judged), (r) => judgePassed(r) && !caught(r)),
    };
  }
  const ordinary = rows.filter((r) => r.expect === "ordinary");
  const times = nums(rows, (r) => r.parse?.ms ?? null);
  const reasons: Record<string, number> = {};
  const invalidRows = rows.filter((r) => r.parse?.failure === "invalid");
  for (const r of invalidRows) {
    const k = r.parse?.invalid?.reason ?? "not recorded";
    reasons[k] = (reasons[k] ?? 0) + 1;
  }
  return {
    invalid: { n: invalidRows.length, reasons },
    byClass,
    falseHolds: { judge: ratio(ordinary, (r) => !judgePassed(r)), parse: parsedRatio(ordinary, (r) => r.parse!.ordinary !== true) },
    overDeadline: parsedRatio(rows, (r) => r.parse!.missedDeadline),
    ms: dist(times),
  };
}

export function summarize(run: RunFile): Summary {
  const rows = run.rows;
  const control = rows.filter((r) => r.expect === "hold");
  const ordinary = rows.filter((r) => r.expect === "ordinary");
  const probes = rows.filter((r) => r.probe);
  const invalidReasons: Record<string, number> = {};
  for (const r of rows) if (r.invalidReason !== null) invalidReasons[r.invalidReason] = (invalidReasons[r.invalidReason] ?? 0) + 1;
  const reasoning = nums(rows, (r) => r.reasoningTokens);
  const asr = nums(rows, (r) => r.derived.asrMs);
  const probeLatencies = nums(probes, (r) => r.derived.ordinaryLatencyFromLoudMs ?? null);
  // From the two instants, so run files from before brief 008 (no commitToJudgeSentMs) read the same way.
  const gapOf = (r: Row) => (r.t.commit === null || r.t.judgeSent === null ? null : Math.round((r.t.judgeSent - r.t.commit) * 10) / 10);
  const gaps = nums(rows, gapOf);

  const validOf = (timing: Timing): Ratio => {
    const measured = rows.filter(judged);
    return { n: measured.filter((r) => judgeVerdictOf(r, timing) !== null).length, of: measured.length, missing: rows.length - measured.length };
  };
  const validVerdicts = { deadline: validOf("deadline"), untimed: validOf("untimed") };
  const views = Object.fromEntries(
    VIEWS.map(({ view, timing, key }) => [
      key,
      {
        recall: ratio(control, heldIn(view, timing)),
        recallByClass: Object.fromEntries(CONTROL_CLASSES.map((c) => [c, ratio(control.filter((r) => r.class === c), heldIn(view, timing))])),
        falseHolds: ratio(ordinary, notPassed(timing)),
      },
    ]),
  ) as Record<ViewKey, View>;

  // The stop rules read the judge's own verdicts at the deadline: a defaulted hold is not a verdict.
  // Rule 1 (spec §14, no valid verdict on real audio): over the line when fewer than 90% of the lines have one.
  // Best case counts every line never judged as valid.
  const verdict = shareRule(validVerdicts.deadline, (x) => x < VALID_VERDICT_STOP);

  // Rule 2: p50 over the 15 probes above 850 ms, from the end of audible speech (spec §13), which is the take's
  // last loud frame (brief 009 item 3). A held probe has no reply latency, so it is missing. Runs before brief 009
  // have no last-loud-frame time, so the rule reads not measured on them.
  let latency: StopState = "not measured";
  if (probes.length === PROBE_COUNT && probeLatencies.length === PROBE_COUNT) {
    latency = percentile(probeLatencies, 50)! > LATENCY_STOP_MS ? "over the line" : "within";
  } else if (probeLatencies.length > 0) {
    // Best case: every missing probe as fast as zero. If even that p50 is over, the rule fails.
    const best = [...probeLatencies, ...Array<number>(Math.max(0, PROBE_COUNT - probeLatencies.length)).fill(0)];
    if (percentile(best, 50)! > LATENCY_STOP_MS) latency = "over the line";
  }

  // Rule 3: control recall under 90%, the judge's own H or U within 600 ms. Best case counts every control line
  // never judged as caught.
  const recallState = shareRule(views.judgeDeadline.recall, (x) => x < RECALL_STOP);

  return {
    lines: rows.length,
    judged: rows.filter(judged).length,
    validVerdicts,
    views,
    timeouts: rows.filter((r) => r.timedOut).length,
    invalidReasons,
    reasoningTokens: tokenStats(reasoning),
    outputTokens: tokenStats(nums(rows, (r) => r.outputTokens)),
    judgeMs: dist(nums(rows, (r) => r.derived.judgeMs)),
    ordinaryLatencyMs: dist(nums(rows, (r) => r.derived.ordinaryLatencyMs)),
    ordinaryLatencyFromLoudMs: dist(nums(rows, (r) => r.derived.ordinaryLatencyFromLoudMs ?? null)),
    vadEndAfterLoudMs: dist(nums(rows, (r) => r.derived.vadEndAfterLoudMs ?? null)),
    asrMs: { ...dist(asr), withinFallback: asr.filter((v) => v <= ASR_FALLBACK_MS).length },
    commitToSendMs: {
      p50: percentile(gaps, 50),
      max: gaps.length === 0 ? null : Math.max(...gaps),
      n: gaps.length,
      flagged: rows.flatMap((r) => {
        const ms = gapOf(r);
        return ms !== null && ms > COMMIT_TO_SEND_FLAG_MS ? [{ lineId: r.lineId, ms }] : [];
      }),
    },
    probes: { p50: percentile(probeLatencies, 50), measured: probeLatencies.length, total: probes.length },
    parallel: runModeOf(run).mode === "parallel" ? parallelStats(rows) : null,
    slowParse: slowParseStats(rows),
    sessions: [...new Set(rows.map((r) => r.session))]
      .sort((a, b) => a - b)
      .map((session) => {
        const in_ = rows.filter((r) => r.session === session);
        const judge = nums(in_, (r) => r.derived.judgeMs);
        return {
          session,
          lines: in_.length,
          control: in_.filter((r) => r.expect === "hold").length,
          ordinary: in_.filter((r) => r.expect === "ordinary").length,
          judgeMs: { p50: percentile(judge, 50), n: judge.length },
        };
      }),
    stops: { verdict, latency, recall: recallState },
  };
}

const ms = (v: number | null) => (v === null ? "—" : `${Math.round(v)} ms`);
const pct = (x: Ratio) => (x.of === 0 ? "—" : `${((x.n / x.of) * 100).toFixed(1)}% (${x.n} of ${x.of}${x.missing > 0 ? `, ${x.missing} not measured` : ""})`);
const tokens = (t: TokenStats) => (t.n === 0 ? "not reported in any usage object" : `largest ${t.max}, p50 ${t.p50}, over ${t.n} response(s)`);
const cap = (j: Pick<JudgeSettings, "maxOutputTokens">) => (j.maxOutputTokens === "inf" ? "inf (no cap)" : String(j.maxOutputTokens));

export function summaryMarkdown(run: RunFile, s: Summary = summarize(run)): string {
  const out: string[] = [];
  // Runs before brief 011 ran judge_v1 at the contract's 600 ms.
  const deadline = run.judge.deadlineMs ?? 600;
  const label = (l: string) => l.replace("600 ms", `${deadline} ms`);
  out.push(`# Judge spike run, ${run.date}`);
  out.push("");
  if (run.transport === "fake") out.push("**Fake transport: these numbers come from the scripted fake server, not from OpenAI. They measure nothing.**", "");
  const mode = runModeOf(run);
  out.push(
    `- Mode: ${
      run.run === undefined
        ? "sequential (a run from before brief 009, which added the mode)"
        : mode.mode === "parallel"
          ? `parallel, stagger ${mode.staggerMs} ms (the reply goes out beside the judge, muted until a valid O)`
          : "sequential (the reply goes out after a valid O)"
    }`,
  );
  out.push(`- Judge: ${run.judge.contract ?? "judge_v1"}, deadline ${deadline} ms, max_output_tokens ${cap(run.judge)}, reasoning effort ${run.judge.effort}`);
  out.push(`- Audio: ${run.source}${run.source === "synthetic" ? " (text-to-speech, not a person's voice)" : " (the owner's own takes)"}`);
  out.push(`- Line set: commit ${run.lineSetCommit}, hash ${run.lineSetHash.slice(0, 12)}`);
  out.push(`- Models: voice ${run.models.voice}, transcription ${run.models.transcribe}`);
  out.push(`- Lines: ${s.lines} run, ${s.judged} judged, in ${run.sessions.length} session(s)`);
  out.push("");
  out.push("## Spec §14 stop rules");
  out.push("");
  out.push(`These read the judge's own verdicts within the ${deadline} ms deadline. An invalid answer or a timeout is not a verdict: it is a miss on a control line.`);
  out.push("");
  const vd = s.validVerdicts.deadline;
  out.push(`- No valid verdict on real audio (fewer than 90% of lines with one): **${s.stops.verdict}** (${vd.n} of ${vd.of + vd.missing} lines had a valid verdict within ${deadline} ms${vd.missing > 0 ? `; ${vd.missing} never judged` : ""})`);
  out.push(`- ${mode.mode === "parallel" ? "Parallel" : "Sequential"} p50 over 850 ms on 15 probes: **${s.stops.latency}** (p50 ${ms(s.probes.p50)} over ${s.probes.measured} of ${s.probes.total} probes, from the end of audible speech (the take's last loud frame) to audible time; browser playback adds about ${PLAYBACK_MS} ms)`);
  out.push(`- Control recall under 90%: **${s.stops.recall}** (judge H or U within ${deadline} ms: ${pct(s.views.judgeDeadline.recall)})`);
  out.push("");
  out.push("## Recall and false holds");
  out.push("");
  out.push(`*Judge verdicts*: a control line is caught only on the judge's own H or U; an ordinary line passes only on its O. *As the app would act*: an invalid answer or a timeout holds. *Within ${deadline} ms* is what ships; *any time* counts every valid verdict whatever its time.`);
  out.push("");
  out.push("| View | Control recall | False holds on ordinary lines |");
  out.push("|---|---|---|");
  for (const v of VIEWS) out.push(`| ${label(v.label)} | ${pct(s.views[v.key].recall)} | ${pct(s.views[v.key].falseHolds)} |`);
  out.push("");
  out.push(`| Control class | ${VIEWS.map((v) => label(v.label)).join(" | ")} |`);
  out.push(`|---|${VIEWS.map(() => "---").join("|")}|`);
  for (const c of CONTROL_CLASSES) out.push(`| ${c} | ${VIEWS.map((v) => pct(s.views[v.key].recallByClass[c]!)).join(" | ")} |`);
  out.push("");
  out.push("## Judge");
  out.push("");
  out.push(`- Valid verdicts within ${deadline} ms: ${pct(s.validVerdicts.deadline)}`);
  out.push(`- Valid verdicts at any time: ${pct(s.validVerdicts.untimed)}`);
  out.push(`- Timeouts (no response.done within ${deadline} ms of commit): ${s.timeouts}`);
  const reasons = Object.entries(s.invalidReasons);
  out.push(`- Invalid-verdict reasons: ${reasons.length === 0 ? "none" : reasons.map(([k, v]) => `${k} ${v}`).join(", ")}${s.invalidReasons.extraText ? " (extraText includes any preamble)" : ""}`);
  out.push(`- Output tokens per judge response (reasoning included): ${tokens(s.outputTokens)}`);
  out.push(`- Reasoning tokens per judge response: ${tokens(s.reasoningTokens)}`);
  out.push("");
  out.push("## Times");
  out.push("");
  out.push("| Measure | p50 | p95 | n |");
  out.push("|---|---|---|---|");
  out.push(`| Judge (commit to judge done) | ${ms(s.judgeMs.p50)} | ${ms(s.judgeMs.p95)} | ${s.judgeMs.n} |`);
  out.push(`| Ordinary latency from the last loud frame (end of audible speech to audible time; +${PLAYBACK_MS} ms playback in the browser) | ${ms(s.ordinaryLatencyFromLoudMs.p50)} | ${ms(s.ordinaryLatencyFromLoudMs.p95)} | ${s.ordinaryLatencyFromLoudMs.n} |`);
  out.push(`| Ordinary latency from the VAD's end of speech (\`speech_stopped.audio_end_ms\` to audible time) | ${ms(s.ordinaryLatencyMs.p50)} | ${ms(s.ordinaryLatencyMs.p95)} | ${s.ordinaryLatencyMs.n} |`);
  out.push(`| ASR (commit to transcription done) | ${ms(s.asrMs.p50)} | ${ms(s.asrMs.p95)} | ${s.asrMs.n} |`);
  out.push("");
  const gap = s.vadEndAfterLoudMs;
  out.push(
    gap.n === 0
      ? "VAD end of speech after the last loud frame: not measured (no row has both times)."
      : `VAD end of speech (\`audio_end_ms\`) after the last loud frame: p50 ${ms(gap.p50)}, p95 ${ms(gap.p95)}, over ${gap.n} line(s). Near 300 ms means \`audio_end_ms\` includes the VAD's 300 ms of silence; near 0 means it marks the end of speech.`,
  );
  out.push("");
  out.push(`Transcripts within ${ASR_FALLBACK_MS} ms of commit: ${s.asrMs.n === 0 ? "—" : `${s.asrMs.withinFallback} of ${s.asrMs.n}`}.`);
  out.push("");
  const g = s.commitToSendMs;
  out.push(`Commit to judge sent (the harness's own wait; judge time is fair only when this is near zero): p50 ${ms(g.p50)}, largest ${ms(g.max)}, over ${g.n} line(s).`);
  out.push("");
  if (g.flagged.length === 0) out.push(`No line waited over ${COMMIT_TO_SEND_FLAG_MS} ms from commit to judge sent.`);
  else out.push(`**Over ${COMMIT_TO_SEND_FLAG_MS} ms from commit to judge sent on ${g.flagged.length} line(s); their judge time includes the harness's wait:** ${g.flagged.map((f) => `${f.lineId} (${Math.round(f.ms)} ms)`).join(", ")}`);
  out.push("");
  if (s.parallel !== null) out.push(...parallelMarkdown(s.parallel, mode.staggerMs));
  if (s.slowParse !== null) out.push(...slowParseMarkdown(s.slowParse, run.decisions ?? "fake"));
  out.push("## Sessions");
  out.push("");
  out.push(`Lines ran in a seeded order (seed ${run.seed}), up to 30 per session.`);
  out.push("");
  out.push("| Session | Lines | Control | Ordinary | Judge p50 | n |");
  out.push("|---|---|---|---|---|---|");
  for (const x of s.sessions) out.push(`| ${x.session + 1} | ${x.lines} | ${x.control} | ${x.ordinary} | ${ms(x.judgeMs.p50)} | ${x.judgeMs.n} |`);
  out.push("");
  run.sessions.forEach((ids, i) => out.push(`- Session ${i + 1}: ${ids.join(", ")}`));
  out.push("");
  return out.join("\n");
}

/** The slow parse beside the judge (voice-control R17.4, R17.5). */
function slowParseMarkdown(p: SlowParseStats, decisions: DecisionsKind): string[] {
  const out: string[] = [];
  out.push("## Slow parse");
  out.push("");
  if (decisions === "fake") out.push("**Fake Decisions port: every probability is 0 at 0 ms. These rows measure nothing about the parse.**", "");
  out.push(`The judge catches a control line with anything but a valid O within the deadline; the parse catches it when the line's class is at or above ${CANDIDATE_P}. A joint miss is a line both let through.`);
  out.push("");
  out.push("| Control class | Judge recall | Slow-parse recall | Joint miss |");
  out.push("|---|---|---|---|");
  for (const [c, x] of Object.entries(p.byClass)) out.push(`| ${c} | ${pct(x.judgeRecall)} | ${pct(x.parseRecall)} | ${pct(x.jointMiss)} |`);
  out.push("");
  out.push(`- False holds on ordinary lines: judge ${pct(p.falseHolds.judge)}, slow parse ${pct(p.falseHolds.parse)}`);
  const inv = Object.entries(p.invalid.reasons).map(([k, v]) => `${k} ${v}`).join(", ");
  out.push(`- Invalid answers: ${p.invalid.n}${p.invalid.n > 0 ? ` (${inv})` : ""}`);
  out.push(`- Parses over ${DECISIONS_DEADLINE_MS} ms: ${pct(p.overDeadline)}; parse time p50 ${ms(p.ms.p50)}, p95 ${ms(p.ms.p95)}, over ${p.ms.n} parse(s)`);
  out.push("");
  return out;
}

/** The parallel section (brief 009 item 4). */
function parallelMarkdown(p: ParallelStats, staggerMs: number): string[] {
  const out: string[] = [];
  out.push("## Parallel");
  out.push("");
  out.push(`The judge and the speculative reply went out ${staggerMs === 0 ? "together" : `${staggerMs} ms apart (or at a valid O, if sooner)`}. Audible time is the later of the judge's valid O and the reply's first audio delta, when the browser would unmute.`);
  out.push("");
  out.push("| Measure | p50 | p95 | n |");
  out.push("|---|---|---|---|");
  out.push(`| Judge (judge sent to judge done) | ${ms(p.judgeFromSendMs.p50)} | ${ms(p.judgeFromSendMs.p95)} | ${p.judgeFromSendMs.n} |`);
  out.push(`| Reply (reply sent to first reply audio) | ${ms(p.replyFromSendMs.p50)} | ${ms(p.replyFromSendMs.p95)} | ${p.replyFromSendMs.n} |`);
  out.push("");
  out.push(`- Reply audio before the verdict: ${p.audioBeforeVerdict.of === 0 ? "—" : `${p.audioBeforeVerdict.n} of ${p.audioBeforeVerdict.of} lines with both`} (on those, audible time is the verdict)`);
  out.push(`- Reply audio received on held lines, kept muted: ${p.mutedOnHeld.of === 0 ? "— (no held line sent a reply)" : `${p.mutedOnHeld.n} of ${p.mutedOnHeld.of} held lines whose reply went out`}`);
  out.push(`- Lines with an error event: ${p.errorLines.length === 0 ? "none" : `${p.errorLines.length}, all held (the full events are in the run file)`}`);
  for (const e of p.errorLines) out.push(`  - ${e.lineId}: ${e.first}${e.count > 1 ? ` (and ${e.count - 1} more)` : ""}`);
  out.push("");
  if (p.overlapped === 0) out.push("**Whether two out-of-band responses can run at once: not measured.** No reply went out while its judge was still running.");
  else if (p.ranAtOnce === p.overlapped) out.push(`**Two out-of-band responses ran at once: yes.** On all ${p.overlapped} lines where the reply went out while the judge was still running, the server created both and sent no error event.`);
  else if (p.ranAtOnce === 0) out.push(`**Two out-of-band responses ran at once: no.** On none of the ${p.overlapped} lines where the reply went out while the judge was still running did the server create both without an error event.`);
  else out.push(`**Two out-of-band responses ran at once: not always.** The server created both with no error event on ${p.ranAtOnce} of the ${p.overlapped} lines where the reply went out while the judge was still running.`);
  out.push("");
  return out;
}
