/**
 * The judge spike harness (brief 006 item 4). Runs probe lines one at a time, in a seeded order, through a
 * Realtime session and records, on one monotonic clock, every instant the spec's sequential floor depends on (spec
 * §3, §13, §14 item 1; contracts §5 judge_v1, §6 Realtime):
 *
 *   trim the take's trailing silence (brief 008), so the commit lands about 300 ms after the last speech;
 *   stream it in 20 ms chunks at real time, then silence until the VAD commits;
 *   wait for `conversation.item.added`, then by mode (brief 009):
 *   - sequential: send judge_v1 and parse its verdict with the core parser; on a completed `O` within 600 ms of
 *     commit, send the reply and cancel it at its first audio delta; on `H`, `U` or a timeout, send no reply;
 *   - parallel: send judge_v1, and the speculative reply `staggerMs` later (or at a valid `O`, if sooner; spec
 *     §3's stagger), both out of band on the same audio items. The reply is never played: audible time is the
 *     later of the `O` and its first audio delta. On anything but a valid `O` the reply is cancelled at once;
 *     on `O`, once both are in. Every server event is matched to its response by response ID;
 *   wait for the transcription, then go to the next line.
 *
 * The transport and the clock are injected. The CLI passes the live WebSocket only with `--live`; otherwise it
 * passes the fake transport on a virtual clock.
 */
import {
  JUDGE_DEADLINE_MS,
  type JudgeInvalidReason,
  type JudgeSettings,
  type JudgeVerdict,
  judgeCreate,
  parseJudgeDone,
} from "@franki/core";
import type { HarnessClock } from "./clock";
import type { ProbeLine } from "./lines";
import { type Connect, EVENT, type ServerEvent, type Transport, base64, spikeReplyCreate, spikeSessionUpdate } from "./realtime";
import { SPEECH_RMS_THRESHOLD, type TrimmedTake, trimTail } from "./trim";

export const NO_SPEECH = `no 20 ms frame above RMS ${SPEECH_RMS_THRESHOLD}: no speech to stream`;

/** The lines whose take has no speech above the trim threshold (brief 008); they are refused before connecting. */
export function silentTakes(lines: readonly ProbeLine[], audio: ReadonlyMap<string, Uint8Array>): string[] {
  return lines.filter((l) => {
    const pcm = audio.get(l.id);
    return pcm !== undefined && trimTail(pcm) === null;
  }).map((l) => l.id);
}

export const CHUNK_MS = 20;
export const CHUNK_BYTES = 960; // 20 ms of 24 kHz 16-bit mono
/** A judge with no response.done by commit + this is still waited for, so its real time is known. */
export const JUDGE_WAIT_MS = 3_000;
export const MAX_SILENCE_MS = 3_000;
export const ITEM_WAIT_MS = 3_000;
export const REPLY_AUDIO_WAIT_MS = 5_000;
export const TRANSCRIPT_WAIT_MS = 10_000;
export const SESSION_WAIT_MS = 5_000;
/** One session per run of up to this many lines, then a fresh session. */
export const SESSION_LINES = 30;
/** The cost guard: never more lines than this in one run. */
export const MAX_RUN_LINES = 70;
/**
 * The spike's judge settings unless the CLI says otherwise (brief 007 item 2): no output cap, by the owner's
 * ruling, because reasoning tokens count against contracts §5's 16 and the first live run never got a letter.
 */
export const SPIKE_JUDGE_SETTINGS: JudgeSettings = { contract: "judge_v1", maxOutputTokens: "inf", effort: "minimal", deadlineMs: JUDGE_DEADLINE_MS };

/** Brief 009: `sequential` sends the reply after a valid `O`; `parallel` sends it beside the judge, muted. */
export type RunMode = "sequential" | "parallel";
export const RUN_MODES: readonly RunMode[] = ["sequential", "parallel"];
export interface RunSettings {
  mode: RunMode;
  /** Parallel only: the reply goes out this long after the judge, or at a valid `O` if that is sooner. */
  staggerMs: number;
}
/** The harness default from brief 009: parallel, no stagger. */
export const DEFAULT_RUN: RunSettings = { mode: "parallel", staggerMs: 0 };
/** The stagger flag's ceiling: past the judge deadline the reply would wait for the verdict anyway. */
export const MAX_STAGGER_MS = JUDGE_DEADLINE_MS;

export interface Times {
  streamStart: number | null;
  /**
   * The send time of the chunk holding the sample at `speech_stopped.audio_end_ms`: the VAD's end of speech. The
   * Nov 9 run suggests `audio_end_ms` already includes the VAD's 300 ms of silence (brief 009 item 3).
   */
  speechEnd: number | null;
  /**
   * The send time of the chunk holding the take's last frame above the trim threshold (`trimTail`): the end of
   * audible speech, which spec §13 measures latency from. Absent in runs before brief 009.
   */
  lastLoudSent?: number | null;
  commit: number | null;
  itemAdded: number | null;
  judgeSent: number | null;
  judgeFirstDelta: number | null;
  judgeDone: number | null;
  replySent: number | null;
  /** Parallel: the reply's `response.created`. */
  replyCreated?: number | null;
  firstReplyAudio: number | null;
  /** Parallel: when the harness cancelled the reply. */
  replyCancelSent?: number | null;
  /**
   * When the browser would unmute: in parallel mode the later of the judge's valid `O` and the reply's first
   * audio delta; in sequential mode the first audio delta. Null on a held line. Absent in runs before brief 009.
   */
  audible?: number | null;
  transcriptionDone: number | null;
}

export interface Row {
  lineId: string;
  class: string;
  expect: "hold" | "ordinary";
  probe: boolean;
  session: number;
  voice: string | null;
  /** The streamed audio, after the tail trim (brief 008). */
  audioMs: number;
  /** The take's length before the trim. */
  takeMs: number;
  /** Milliseconds of trailing silence trimmed from the take. */
  trimmedMs: number;
  /** Committed audio items for this line, in commit order. More than one means the VAD split the line. */
  fragments: number;
  t: Times;
  verdict: JudgeVerdict | null;
  valid: boolean | null;
  invalidReason: JudgeInvalidReason | null;
  judgeStatus: string | null;
  judgeStatusDetails: unknown;
  judgeText: string | null;
  judgeUsage: unknown;
  /** `usage.output_tokens` of the judge response, reasoning included; null when absent. */
  outputTokens: number | null;
  reasoningTokens: number | null;
  judgeOtherItems: string[];
  /** No response.done within 600 ms of commit. */
  timedOut: boolean;
  /** `reply` only for a valid `O` within the deadline (and, in parallel mode, no error event). */
  decision: "reply" | "held" | null;
  /**
   * Parallel, on a held line whose reply was sent: whether any reply audio arrived before the cancel. That audio
   * would have stayed muted. Null otherwise. Absent in runs before brief 009.
   */
  mutedReplyAudio?: boolean | null;
  /**
   * Parallel: every `error` event, in full, from the judge's send to the end of both responses, and a reply
   * `response.done` with status `failed`. Any entry holds the line. Absent in runs before brief 009.
   */
  concurrencyErrors?: unknown[];
  transcript: string | null;
  /**
   * `commitToJudgeSentMs` is the harness's own wait; judge time is fair only when it is near zero.
   * `ordinaryLatencyMs` runs from the VAD's end of speech (`speechEnd`) to audible time;
   * `ordinaryLatencyFromLoudMs` from the last loud frame (`lastLoudSent`), which the stop rule reads; and
   * `vadEndAfterLoudMs` is the gap between the two ends of speech. The last two are absent before brief 009.
   */
  derived: {
    judgeMs: number | null;
    ordinaryLatencyMs: number | null;
    ordinaryLatencyFromLoudMs?: number | null;
    vadEndAfterLoudMs?: number | null;
    asrMs: number | null;
    commitToJudgeSentMs: number | null;
  };
  errors: string[];
}

interface Received {
  event: ServerEvent;
  at: number;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});
const responseOf = (e: ServerEvent) => rec(e.response);
const isType = (names: readonly string[]) => (e: ServerEvent) => names.includes(e.type);

/** The first numeric value under a key that names reasoning, anywhere in a usage object; null when absent. */
export function reasoningTokensOf(usage: unknown): number | null {
  if (typeof usage !== "object" || usage === null) return null;
  for (const [k, v] of Object.entries(usage)) {
    if (/reasoning/i.test(k) && typeof v === "number") return v;
    const inner = reasoningTokensOf(v);
    if (inner !== null) return inner;
  }
  return null;
}

/** `output_tokens` at the top of a usage object; null when absent. */
export function outputTokensOf(usage: unknown): number | null {
  const v = rec(usage).output_tokens;
  return typeof v === "number" ? v : null;
}

/** One Realtime session: every server event with its receipt time, and the audio sent so far. */
export class SpikeSession {
  readonly events: Received[] = [];
  readonly names = new Set<string>();
  private waiters: { from: number; pred: (e: ServerEvent) => boolean; resolve: (r: Received | null) => void; timer: unknown }[] = [];
  /** Audio milliseconds appended in this session; `audio_end_ms` counts on this timeline. */
  audioMs = 0;
  readonly chunks: { startMs: number; sentAt: number }[] = [];
  closed: string | null = null;

  constructor(
    readonly transport: Transport,
    readonly clock: HarnessClock,
    readonly index: number,
  ) {
    transport.onEvent((event) => {
      const r = { event, at: clock.now() };
      this.events.push(r);
      this.names.add(event.type);
      const i = this.events.length - 1;
      for (const w of [...this.waiters]) {
        if (i >= w.from && w.pred(event)) this.finish(w, r);
      }
    });
    transport.onClose((reason) => {
      this.closed = reason;
      for (const w of [...this.waiters]) this.finish(w, null);
    });
  }

  private finish(w: (typeof this.waiters)[number], r: Received | null) {
    this.waiters = this.waiters.filter((x) => x !== w);
    this.clock.clearTimer(w.timer);
    w.resolve(r);
  }

  /** The first event at index >= `from` matching `pred`, already received or arriving within `ms`. */
  waitFor(from: number, pred: (e: ServerEvent) => boolean, ms: number): Promise<Received | null> {
    for (let i = from; i < this.events.length; i++) if (pred(this.events[i]!.event)) return Promise.resolve(this.events[i]!);
    if (this.closed !== null) return Promise.resolve(null);
    return new Promise((resolve) => {
      const w = { from, pred, resolve, timer: null as unknown };
      w.timer = this.clock.setTimer(Math.max(0, ms), () => this.finish(w, null));
      this.waiters.push(w);
    });
  }

  since(from: number, pred: (e: ServerEvent) => boolean): Received[] {
    return this.events.slice(from).filter((r) => pred(r.event));
  }

  sleepUntil(at: number): Promise<void> {
    return new Promise((resolve) => this.clock.setTimer(at - this.clock.now(), resolve));
  }

  append(bytes: Uint8Array) {
    this.chunks.push({ startMs: this.audioMs, sentAt: this.clock.now() });
    this.transport.send({ type: "input_audio_buffer.append", audio: base64(bytes) });
    this.audioMs += bytes.byteLength / 48;
  }

  /** The send time of the chunk holding the sample at `audioMs` on this session's audio timeline. */
  sentAtAudioMs(audioMs: number): number | null {
    let found: number | null = null;
    for (const c of this.chunks) if (c.startMs <= audioMs) found = c.sentAt;
    return found;
  }
}

export async function openSession(connect: Connect, opts: { voiceModel: string; transcribeModel: string; apiKey: string }, clock: HarnessClock, index: number): Promise<SpikeSession> {
  const transport = await connect({ model: opts.voiceModel, apiKey: opts.apiKey });
  const s = new SpikeSession(transport, clock, index);
  const created = await s.waitFor(0, (e) => e.type === "session.created", SESSION_WAIT_MS);
  if (created === null) throw new Error("no session.created");
  const from = s.events.length;
  transport.send(spikeSessionUpdate(opts.transcribeModel));
  const updated = await s.waitFor(from, (e) => e.type === "session.updated" || e.type === "error", SESSION_WAIT_MS);
  if (updated === null || updated.event.type === "error") throw new Error(`session.update failed: ${JSON.stringify(updated?.event ?? "no answer")}`);
  return s;
}

function emptyRow(line: ProbeLine, session: number, voice: string | null, take: TrimmedTake | null, pcmMs: number): Row {
  return {
    lineId: line.id,
    class: line.class,
    expect: line.expect,
    probe: line.probe,
    session,
    voice,
    audioMs: take === null ? 0 : (take.pcm.byteLength / 48) | 0,
    takeMs: take === null ? pcmMs : take.takeMs,
    trimmedMs: take === null ? 0 : take.trimmedMs,
    fragments: 0,
    t: {
      streamStart: null,
      speechEnd: null,
      lastLoudSent: null,
      commit: null,
      itemAdded: null,
      judgeSent: null,
      judgeFirstDelta: null,
      judgeDone: null,
      replySent: null,
      replyCreated: null,
      firstReplyAudio: null,
      replyCancelSent: null,
      audible: null,
      transcriptionDone: null,
    },
    verdict: null,
    valid: null,
    invalidReason: null,
    judgeStatus: null,
    judgeStatusDetails: null,
    judgeText: null,
    judgeUsage: null,
    outputTokens: null,
    reasoningTokens: null,
    judgeOtherItems: [],
    timedOut: false,
    decision: null,
    mutedReplyAudio: null,
    concurrencyErrors: [],
    transcript: null,
    derived: { judgeMs: null, ordinaryLatencyMs: null, ordinaryLatencyFromLoudMs: null, vadEndAfterLoudMs: null, asrMs: null, commitToJudgeSentMs: null },
    errors: [],
  };
}

const diff = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : Math.round((b - a) * 10) / 10);

/**
 * Runs one line through the session. Never throws for a line-level failure; it is recorded in `errors`. The take's
 * trailing silence is trimmed first (`trimTail`); a take with no speech is not streamed.
 */
export async function runLine(
  s: SpikeSession,
  line: ProbeLine,
  take: Uint8Array,
  voice: string | null,
  judge: JudgeSettings = SPIKE_JUDGE_SETTINGS,
  run: RunSettings = DEFAULT_RUN,
): Promise<Row> {
  const trimmed = trimTail(take);
  const row = emptyRow(line, s.index, voice, trimmed, (take.byteLength / 48) | 0);
  if (trimmed === null) {
    row.errors.push(NO_SPEECH);
    return row;
  }
  const pcm = trimmed.pcm;
  const from = s.events.length;
  const t = row.t;
  const clock = s.clock;

  // 1. Stream the trimmed line at real time, then silence until the VAD has committed everything it heard.
  const lineAudioStart = s.audioMs;
  const start = clock.now();
  t.streamStart = start;
  let k = 0;
  for (let at = 0; at < pcm.byteLength; at += CHUNK_BYTES, k++) {
    await s.sleepUntil(start + k * CHUNK_MS);
    s.append(pcm.subarray(at, Math.min(at + CHUNK_BYTES, pcm.byteLength)));
  }
  t.lastLoudSent = s.sentAtAudioMs(lineAudioStart + trimmed.lastLoudStartMs);
  const silence = new Uint8Array(CHUNK_BYTES);
  const settled = () => {
    const evs = s.events.slice(from);
    const lastStart = evs.map((r) => r.event.type).lastIndexOf("input_audio_buffer.speech_started");
    const lastCommit = evs.map((r) => r.event.type).lastIndexOf("input_audio_buffer.committed");
    return lastCommit >= 0 && lastCommit > lastStart;
  };
  const silenceStart = k;
  while (!settled() && (k - silenceStart) * CHUNK_MS < MAX_SILENCE_MS && s.closed === null) {
    await s.sleepUntil(start + k * CHUNK_MS);
    if (settled()) break;
    s.append(silence);
    k++;
  }
  row.errors.push(...s.since(from, (e) => e.type === "error").map((r) => JSON.stringify(rec(r.event.error).message ?? r.event.error ?? r.event)));
  if (!settled()) {
    row.errors.push("no commit after the line");
    return row;
  }
  const commits = s.since(from, (e) => e.type === "input_audio_buffer.committed");
  const ids = commits.map((r) => str(r.event.item_id)).filter((id): id is string => id !== null);
  row.fragments = ids.length;
  t.commit = commits[commits.length - 1]!.at;
  const stops = s.since(from, (e) => e.type === "input_audio_buffer.speech_stopped");
  const endMs = stops.length > 0 ? stops[stops.length - 1]!.event.audio_end_ms : undefined;
  t.speechEnd = typeof endMs === "number" ? s.sentAtAudioMs(endMs) : null;

  // 2. Wait for every committed item to be added (contracts §6: await item.added for committed.item_id).
  for (const id of ids) {
    const added = await s.waitFor(from, (e) => isType(EVENT.itemAdded)(e) && rec(e.item).id === id, t.commit + ITEM_WAIT_MS - clock.now());
    if (added === null) {
      row.errors.push(`no item.added for ${id}`);
      return finishTranscript(s, row, from, ids);
    }
    t.itemAdded = Math.max(t.itemAdded ?? 0, added.at);
  }

  if (run.mode === "parallel") {
    await respondParallel(s, line, ids, row, judge, run.staggerMs);
    return finishTranscript(s, row, from, ids);
  }

  // 3. The judge.
  const judgeFrom = s.events.length;
  s.transport.send(judgeCreate(judgeRequest(line, ids), judge));
  t.judgeSent = clock.now();
  const isJudge = (e: ServerEvent) => rec(responseOf(e).metadata).purpose === "judge" && rec(responseOf(e).metadata).turnId === line.id;
  const created = await s.waitFor(judgeFrom, (e) => e.type === "response.created" && isJudge(e), t.commit + JUDGE_WAIT_MS - clock.now());
  const judgeId = created === null ? null : str(responseOf(created.event).id);
  const isJudgeDone = (e: ServerEvent) => e.type === "response.done" && (judgeId !== null ? responseOf(e).id === judgeId : isJudge(e));
  const done = await s.waitFor(judgeFrom, isJudgeDone, t.commit + JUDGE_WAIT_MS - clock.now());
  if (judgeId !== null) {
    const delta = s.since(judgeFrom, (e) => isType(EVENT.textDelta)(e) && e.response_id === judgeId)[0];
    t.judgeFirstDelta = delta?.at ?? null;
  }
  if (done === null) {
    row.timedOut = true;
    if (judgeId !== null) s.transport.send({ type: "response.cancel", response_id: judgeId });
  } else recordJudgeDone(row, done);
  const admitted = !row.timedOut && row.valid === true && row.verdict === "O";
  row.decision = admitted ? "reply" : "held";

  // 4. On O only: the reply, cancelled at its first audio delta.
  if (admitted) {
    const replyFrom = s.events.length;
    s.transport.send(spikeReplyCreate(line.id, ids));
    t.replySent = clock.now();
    const isReply = (e: ServerEvent) => rec(responseOf(e).metadata).purpose === "speech" && rec(responseOf(e).metadata).turnId === line.id;
    const rc = await s.waitFor(replyFrom, (e) => e.type === "response.created" && isReply(e), REPLY_AUDIO_WAIT_MS);
    const replyId = rc === null ? null : str(responseOf(rc.event).id);
    if (replyId === null) row.errors.push("no response.created for the reply");
    else {
      const audio = await s.waitFor(replyFrom, (e) => isType(EVENT.audioDelta)(e) && e.response_id === replyId, t.replySent + REPLY_AUDIO_WAIT_MS - clock.now());
      if (audio === null) row.errors.push("no reply audio");
      else t.firstReplyAudio = audio.at;
      s.transport.send({ type: "response.cancel", response_id: replyId });
      await s.waitFor(replyFrom, (e) => e.type === "response.done" && responseOf(e).id === replyId, REPLY_AUDIO_WAIT_MS);
    }
  }
  // In sequential mode the reply is sent only after O, so it is audible at its first audio.
  t.audible = t.firstReplyAudio;
  return finishTranscript(s, row, from, ids);
}

function judgeRequest(line: ProbeLine, ids: readonly string[]) {
  return { turnId: line.id, generation: 0, safeTurns: [], pendingQuestion: null, fragments: ids.map((itemId, i) => ({ itemId, commitSeq: i + 1 })) };
}

/** Fills the row's judge fields from its `response.done`. */
function recordJudgeDone(row: Row, done: Received) {
  row.t.judgeDone = done.at;
  const parsed = parseJudgeDone(done.event);
  row.verdict = parsed.verdict;
  row.valid = parsed.valid;
  row.invalidReason = parsed.reason;
  row.judgeStatus = parsed.status;
  row.judgeStatusDetails = responseOf(done.event).status_details ?? null;
  row.judgeText = parsed.rawText;
  row.judgeOtherItems = parsed.otherItems;
  row.judgeUsage = responseOf(done.event).usage ?? null;
  row.outputTokens = outputTokensOf(row.judgeUsage);
  row.reasoningTokens = reasoningTokensOf(row.judgeUsage);
  row.timedOut = done.at - row.t.commit! > JUDGE_DEADLINE_MS;
}

/**
 * Parallel mode (brief 009): the judge and the speculative reply run side by side. Events are read one at a
 * time in arrival order, and each is matched to its response by response ID; the response IDs come from the
 * `response.created` events, by their metadata. Never throws; a line-level failure goes into `errors`.
 */
async function respondParallel(s: SpikeSession, line: ProbeLine, ids: string[], row: Row, judge: JudgeSettings, staggerMs: number): Promise<void> {
  const t = row.t;
  const clock = s.clock;
  const commit = t.commit!;
  const errors = row.concurrencyErrors!;
  let cursor = s.events.length;
  s.transport.send(judgeCreate(judgeRequest(line, ids), judge));
  t.judgeSent = clock.now();
  const staggerAt = t.judgeSent + staggerMs;
  const ours = (purpose: string) => (e: ServerEvent) => rec(responseOf(e).metadata).purpose === purpose && rec(responseOf(e).metadata).turnId === line.id;

  // State the closures below change; the `as` keeps TypeScript from narrowing it to the initial values.
  let judgeId = null as string | null;
  let judgeDone = null as Received | null;
  let judgeResolved = false as boolean;
  let replyId = null as string | null;
  // unsent: waiting for the stagger; never: held before it went out; sent: in flight; resolved: done or given up.
  let reply = "unsent" as "unsent" | "never" | "sent" | "resolved";
  let replyDeadline = Number.POSITIVE_INFINITY;
  // admit only on a valid O within the deadline with no error event; anything else holds.
  let verdict = "pending" as "pending" | "admit" | "hold";

  const cancelReply = () => {
    s.transport.send({ type: "response.cancel", response_id: replyId! });
    t.replyCancelSent = clock.now();
    replyDeadline = t.replyCancelSent + REPLY_AUDIO_WAIT_MS;
    if (verdict === "hold") row.mutedReplyAudio = t.firstReplyAudio !== null;
  };

  // Acts on the state after every event and every timer.
  const react = () => {
    const now = clock.now();
    if (verdict === "pending" && now >= commit + JUDGE_DEADLINE_MS) verdict = "hold";
    if (reply === "unsent") {
      if (verdict === "hold") reply = "never";
      else if (verdict === "admit" || now >= staggerAt) {
        s.transport.send(spikeReplyCreate(line.id, ids, "speculative"));
        t.replySent = clock.now();
        reply = "sent";
        replyDeadline = t.replySent + REPLY_AUDIO_WAIT_MS;
      }
    }
    if (reply === "sent" && replyId !== null && t.replyCancelSent === null) {
      if (verdict === "hold" || (verdict === "admit" && t.firstReplyAudio !== null)) cancelReply();
    }
    if (!judgeResolved && now >= commit + JUDGE_WAIT_MS) {
      judgeResolved = true;
      if (judgeId !== null) s.transport.send({ type: "response.cancel", response_id: judgeId });
    }
    if (reply === "sent" && now >= replyDeadline) {
      if (replyId === null) {
        row.errors.push("no response.created for the reply");
        reply = "resolved";
      } else if (t.replyCancelSent === null) {
        row.errors.push("no reply audio");
        cancelReply();
      } else {
        row.errors.push("no response.done for the cancelled reply");
        reply = "resolved";
      }
    }
  };

  const onEvent = (r: Received) => {
    const e = r.event;
    if (e.type === "error") {
      errors.push(e);
      verdict = "hold";
      return;
    }
    const id = str(responseOf(e).id);
    if (e.type === "response.created") {
      if (judgeId === null && ours("judge")(e)) judgeId = id;
      else if (replyId === null && ours("speculative")(e)) {
        replyId = id;
        t.replyCreated = r.at;
      }
      return;
    }
    if (isType(EVENT.textDelta)(e) && judgeId !== null && e.response_id === judgeId) t.judgeFirstDelta ??= r.at;
    if (isType(EVENT.audioDelta)(e) && replyId !== null && e.response_id === replyId) t.firstReplyAudio ??= r.at;
    if (e.type !== "response.done") return;
    if (!judgeResolved && (judgeId !== null ? id === judgeId : ours("judge")(e))) {
      judgeDone = r;
      judgeResolved = true;
      recordJudgeDone(row, r);
      if (verdict === "pending") verdict = !row.timedOut && row.valid === true && row.verdict === "O" ? "admit" : "hold";
    } else if (replyId !== null && id === replyId && reply === "sent") {
      if (responseOf(e).status === "failed") {
        errors.push(e);
        verdict = "hold";
      }
      reply = "resolved";
    }
  };

  react();
  while (!(judgeResolved && (reply === "never" || reply === "resolved"))) {
    const now = clock.now();
    const timers: number[] = [];
    if (verdict === "pending") timers.push(commit + JUDGE_DEADLINE_MS);
    if (!judgeResolved) timers.push(commit + JUDGE_WAIT_MS);
    if (reply === "unsent") timers.push(staggerAt);
    if (reply === "sent") timers.push(replyDeadline);
    const future = timers.filter((x) => x > now);
    if (future.length === 0) break;
    const r = await s.waitFor(cursor, () => true, Math.min(...future) - now);
    if (r !== null) {
      cursor = s.events.indexOf(r, cursor) + 1;
      onEvent(r);
    } else if (s.closed !== null) {
      row.errors.push(`session closed during the line: ${s.closed}`);
      break;
    }
    react();
  }

  if (judgeDone === null) row.timedOut = true;
  row.decision = verdict === "admit" ? "reply" : "held";
  if (row.decision === "held" && t.replySent !== null && row.mutedReplyAudio === null) row.mutedReplyAudio = t.firstReplyAudio !== null;
  if (row.decision === "reply" && t.firstReplyAudio !== null) t.audible = Math.max(t.judgeDone!, t.firstReplyAudio);
}

async function finishTranscript(s: SpikeSession, row: Row, from: number, ids: string[]): Promise<Row> {
  const t = row.t;
  const parts: string[] = [];
  for (const id of ids) {
    const r = await s.waitFor(
      from,
      (e) => (e.type === "conversation.item.input_audio_transcription.completed" || e.type === "conversation.item.input_audio_transcription.failed") && e.item_id === id,
      (t.commit ?? s.clock.now()) + TRANSCRIPT_WAIT_MS - s.clock.now(),
    );
    if (r === null) {
      row.errors.push(`no transcription for ${id}`);
      continue;
    }
    if (r.event.type.endsWith(".failed")) row.errors.push(`transcription failed for ${id}`);
    else parts.push(str(r.event.transcript) ?? "");
    t.transcriptionDone = Math.max(t.transcriptionDone ?? 0, r.at);
  }
  row.transcript = parts.length > 0 ? parts.join(" ") : null;
  row.errors.push(...s.since(from, (e) => e.type === "error").map((r) => `error event: ${JSON.stringify(rec(r.event.error).message ?? r.event)}`).filter((m) => !row.errors.includes(m)));
  row.derived = {
    judgeMs: diff(t.commit, t.judgeDone),
    ordinaryLatencyMs: diff(t.speechEnd, t.audible ?? null),
    ordinaryLatencyFromLoudMs: diff(t.lastLoudSent ?? null, t.audible ?? null),
    vadEndAfterLoudMs: diff(t.lastLoudSent ?? null, t.speechEnd),
    asrMs: diff(t.commit, t.transcriptionDone),
    commitToJudgeSentMs: diff(t.commit, t.judgeSent),
  };
  return row;
}

export interface HarnessInput {
  lines: readonly ProbeLine[];
  /** Mono 16-bit 24 kHz PCM by line ID. */
  audio: ReadonlyMap<string, Uint8Array>;
  voices: ReadonlyMap<string, string>;
  models: { voice: string; transcribe: string };
  /** The judge's output cap and effort for every line of the run. */
  judge: JudgeSettings;
  /** Sequential or parallel, and the parallel stagger (brief 009). */
  run: RunSettings;
  /** The seed for the line order (`shuffleLines`). */
  seed: number;
  apiKey: string;
  connect: Connect;
  clock: HarnessClock;
  log: (line: string) => void;
}

export interface HarnessOutput {
  rows: Row[];
  /** The shuffle seed, and the line IDs in the order they ran. */
  seed: number;
  order: string[];
  /** Which lines shared each session, in order. */
  sessions: string[][];
  eventNames: string[];
}

/** The default `--seed`: fixed, so two runs on the same lines run them in the same order. */
export const DEFAULT_SEED = 7;

/** mulberry32: a small seeded generator, so the order depends only on the seed. Values in [0, 1). */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The lines in a fixed seeded order (Fisher-Yates), so control and ordinary lines share sessions and a session
 * effect can be told apart from a class effect (brief 007 item 4).
 */
export function shuffleLines<T>(lines: readonly T[], seed: number): T[] {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("seed must be an integer from 0 to 4294967295");
  const out = [...lines];
  const random = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Runs every line in the seeded order, a fresh session every SESSION_LINES lines. */
export async function runHarness(input: HarnessInput): Promise<HarnessOutput> {
  if (input.lines.length > MAX_RUN_LINES) throw new Error(`refusing ${input.lines.length} lines: at most ${MAX_RUN_LINES} in one run`);
  const silent = silentTakes(input.lines, input.audio);
  if (silent.length > 0) throw new Error(`refusing takes with no speech (${NO_SPEECH}): ${silent.join(", ")}`);
  const ordered = shuffleLines(input.lines, input.seed);
  const rows: Row[] = [];
  const sessions: string[][] = [];
  const names = new Set<string>();
  for (let i = 0; i < ordered.length; i += SESSION_LINES) {
    const group = ordered.slice(i, i + SESSION_LINES);
    const s = await openSession(input.connect, { voiceModel: input.models.voice, transcribeModel: input.models.transcribe, apiKey: input.apiKey }, input.clock, sessions.length);
    sessions.push(group.map((l) => l.id));
    try {
      for (const line of group) {
        const pcm = input.audio.get(line.id);
        if (pcm === undefined) throw new Error(`no audio for ${line.id}`);
        const row = await runLine(s, line, pcm, input.voices.get(line.id) ?? null, input.judge, input.run);
        rows.push(row);
        input.log(`${row.lineId}: ${row.verdict ?? "-"}${row.invalidReason ? ` (${row.invalidReason})` : ""}${row.timedOut ? " timeout" : ""} judge ${row.derived.judgeMs ?? "-"} ms, commit to send ${row.derived.commitToJudgeSentMs ?? "-"} ms, latency ${row.derived.ordinaryLatencyFromLoudMs ?? "-"} ms from the last loud frame (${row.derived.ordinaryLatencyMs ?? "-"} ms from audio_end_ms)${row.concurrencyErrors!.length > 0 ? `, ${row.concurrencyErrors!.length} error event(s)` : ""}`);
        if (s.closed !== null) throw new Error(`session closed: ${s.closed}`);
      }
    } finally {
      for (const n of s.names) names.add(n);
      s.transport.close();
    }
  }
  return { rows, seed: input.seed, order: ordered.map((l) => l.id), sessions, eventNames: [...names].sort() };
}
