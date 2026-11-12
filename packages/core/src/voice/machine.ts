/**
 * @machine voice.call
 * The only code that decides what the call does next. State: VoiceState; events: VoiceEvent; deciding function:
 * step. Exits: closedFields (hangUp, openFailed), connectionRecovery, onOpen, startOpen; their reset table is above
 * closedFields. Every timed wait that fires is a TimerName; its meaning table is on that type. Three more deadlines
 * are kept in state with no timer and read only when a later event looks at them: outstanding[].deadline,
 * missing[].until, and stateSentAt + STATE_STALE_MS.
 * Always: an armed wait has its deadline in state until it is disarmed; a timer whose deadline is absent does
 * nothing, and one that arrives before its deadline only re-arms the same deadline (an `armTimer` command can
 * outlive its deadline when the same step disarms it); and the rules listed below.
 * Never: read a clock, a random source or the network. Never throws on a well-typed VoiceEvent. Six listed Realtime
 * types throw today when they arrive without their fields: conversation.item.added, response.created,
 * response.done, response.output_audio_transcript.done, error, and
 * conversation.item.input_audio_transcription.completed with no transcript for an item of the current unposted
 * Turn. That last one stores the missing transcript; maybeAdmit throws on it, then or on a later event, once every
 * item is recorded and has a transcript and no earlier item has text. The six are what a scratch run found, not a
 * proof that no other type throws. An event type, timer name or Realtime type with no case changes
 * nothing at run time; a member of a listed union with no case fails the typecheck.
 *
 * Browser call-state reducer (design "Browser state machine"; R13, R15, R16.3, R17.2, R17.3; KV02, KV04, KV05,
 * KV06, KV13). Pure: `step(state, event, now)` returns the next state and the commands the Voice_Client runs, in
 * order. `now` is the browser opsClock in integer milliseconds. Nothing here reads a clock, a random source or the
 * network; IDs a new Turn needs arrive on the event (`freshId`), and hashing is a command (`verifyPermit`) whose
 * answer comes back as the `permitChecked` event.
 *
 * Timers are commands too (`armTimer`). The deadline is also kept in state. A `timer` event whose deadline is
 * absent is ignored, and one whose deadline is not yet reached re-arms it, so a stale timer can never move the machine.
 *
 * Rules that hold in every state:
 *   - output audio is muted unless the phase is SPEAKING under a Permit that passed its checks (KV02);
 *   - Realtime events of another generation are dropped (R15.7);
 *   - a higher stamp cancels and clears every in-flight reply (KV05);
 *   - the mute control only touches the microphone track (R15.6).
 */
import { RECOVERY_LINE, type PayloadInput } from "../admission";
import { SEMANTIC_VAD } from "./vad";
import { APP_JUDGE_SETTINGS, type JudgeVerdict, judgeCreate, parseJudgeDone } from "./judge";
import { type FastORefusal, LATE_TURN_MS, type LatencyRow, type LatencyTimes, emptyTimes, finishRow, pushRow } from "./latency";
import { fastOProblem, issueFastO } from "./fast-o";
import { sayExactly } from "./lines";
import { type Infer } from "../schema/v";
import { type SS, type StateAck, msFromTs, tsFromMs } from "../schema/primitives";
import type { PermitKind } from "../schema/records";
import {
  type CloseRequest,
  type Deck,
  type OpenResponse,
  type Permit,
  PHONE_TOOL,
  RECALL_TOOL,
  type ReceiptRequest,
  type SafeTurn,
  type Stamp,
  type StateRequest,
  type StateResponse,
  type ToolRequest,
  type ToolResponse,
  type ToolResult,
  type TurnRequest,
  type TurnResponse,
  type W,
} from "../schema/wire";

// ---------------------------------------------------------------------------------------------
// Limits (contracts §6 States, Ack timing; R13, R15, R16)

export const OPEN_LIMIT_MS = 5_000;
export const CONNECT_LIMIT_MS = 5_000;
export const ACK_LIMIT_MS = 1_500;
export const ITEM_WAIT_MS = 600;
export const TRANSCRIPT_WAIT_MS = 1_500;
export const HOLD_LIMIT_MS = 2_500;
export const REFRESH_MS = 45_000;
/**
 * How long TOOL_WAIT waits for /api/tool. The route answers within 4.5 s (server TOOL_RESULT_LIMIT_MS), and live
 * recalls took 3.9 and 4.2 s on Nov 6. At 3 s the machine went back to LISTENING first and dropped the answer, so
 * Franki said "let me check" and then nothing.
 */
export const TOOL_LIMIT_MS = 6_000;
export const FAST_ACK_AGE_MS = 2_500;
export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000] as const;
export const RETRY_UI_MS = 30_000;
/** How long RECOVERY shows when there is no neutral line to play. */
export const LINE_FALLBACK_MS = 1_500;
export const MAX_TURN_ITEMS = 8;
/** How many responses `recent` keeps. */
export const MAX_RECENT_RESPONSES = 4;

// Wait limits of voice-control (R7.9; design "Wait limits"). All count on the browser opsClock.
/** No verdict by t0 + this: cancel the judge and the speculative reply, and take the slow path. */
export const JUDGE_LIMIT_MS = APP_JUDGE_SETTINGS.deadlineMs;
/** No transcript by t0 + this on a held Turn: post `missing`; the server answers `recoveryOnly`. */
export const HELD_TRANSCRIPT_LIMIT_MS = 2_500;
/** No transcript by t0 + this on a Turn already admitted under `fastO`: post `missing`; the reply plays on. */
export const ADMITTED_TRANSCRIPT_LIMIT_MS = 5_000;
/** No `/api/turn` answer by the post + this: RECOVERY, as a failed request does today. */
export const TURN_RESPONSE_LIMIT_MS = 5_000;
/** A Turn posted `missing` waits this long from the post for a late transcript (the Superseding_Post). */
export const MISSING_WINDOW_MS = 10_000;
/** `/api/session/state` while a call is live, never two in flight (R4.5; the poll row on TimerName says when two can be). */
export const POLL_MS = 1_000;
/** A state request with no answer after this is treated as lost, so polling can go on (the client's limit is 1.5 s). */
export const STATE_STALE_MS = 5_000;
/** Contracts §6 States SPEAKING "45scap": an admitted reply that hasn't ended by then is cancelled. */
export const SPEAK_CAP_MS = 45_000;
export { LATE_TURN_MS };

// ---------------------------------------------------------------------------------------------
// State

export type VoicePhase =
  | "CLOSED"
  | "CONNECTING"
  | "CONFIGURING"
  | "LISTENING"
  | "WAIT_ITEM"
  | "JUDGING"
  | "SPECULATING"
  | "HELD"
  | "SPEAKING"
  | "TOOL_WAIT"
  | "SWAPPING"
  | "RECOVERY";

/**
 * Every timed wait of the call. A wait is an `armTimer` command plus its deadline in `deadlines`; a `timer` event
 * acts only when that deadline is present and reached (onTimer). One that arrives before its deadline re-arms the
 * same deadline and changes nothing else. Each handler re-checks the phase or the field it acts on (awaitingOpen,
 * the Turn, the reply, heldBack, stateFailures), because leaving a phase does not always disarm. What each name
 * means, by the phase it is armed in (and the function that arms it); a live phase is one of IN_CALL:
 *
 *   openWait      CONNECTING (startOpen): /api/session/open has OPEN_LIMIT_MS to answer. Fires while awaitingOpen:
 *                 openFailed, which closes with error "open", or inside connection recovery goes back to RECOVERY
 *                 and schedules the next reconnect if an attempt remains.
 *   connect       CONNECTING (onOpen): CONNECT_LIMIT_MS from the open answer to channelOpen. R15.8 means SDP and the
 *                 data channel only, but the Voice_Client's `connect` asks for the microphone first, so the
 *                 browser's permission prompt runs inside this limit today. Fires in CONNECTING: connection recovery.
 *   ack           CONFIGURING (channelOpen): a StateAck matching the Deck within ACK_LIMIT_MS of `session.update`
 *                 (R13.9). Fires in CONFIGURING: connection recovery.
 *   item          WAIT_ITEM (onCommitted): every commit's `conversation.item.added` within ITEM_WAIT_MS (R15.10).
 *                 Fires in WAIT_ITEM: HELD, the slow path, with no judge.
 *   transcript    WAIT_ITEM onward (onCommitted): the last commit + HELD_TRANSCRIPT_LIMIT_MS (R7.4). Re-armed at
 *                 admission (admit) to t0 + ADMITTED_TRANSCRIPT_LIMIT_MS (R7.6). Fires: the unposted ASR Turn is
 *                 posted `missing`.
 *   permit        Two meanings under one name; whichever arm came last sets the deadline.
 *                 (1) The answer wait. HELD, JUDGING or SPECULATING (postTurn "final", for a Turn not admitted): the
 *                 post + TURN_RESPONSE_LIMIT_MS (R7.5). Also RECOVERY (line), when the transcript arrives after the
 *                 admitted reply's `response.create` was refused; it does nothing there, and lineDone ends the
 *                 Turn. Any phase but RECOVERY (requestVerify, only when none is armed): the hash check of a pending
 *                 Permit has TURN_RESPONSE_LIMIT_MS (KV06).
 *                 (2) The hold. HELD, entered from SPEAKING, TOOL_WAIT, HELD, JUDGING or SPECULATING when a higher
 *                 Stamp cancels the reply (cancelAll): now + HOLD_LIMIT_MS for a Permit under the new Deck.
 *                 Fires in HELD, JUDGING or SPECULATING with no active reply: RECOVERY with nothing to play, then
 *                 `lineDone`.
 *   turnRetry     Whichever phase the posted Turn waits in (onTurn): a `hold` answer with `retryAfterMs`. Fires with
 *                 no Permit pending or active: the same post is sent again.
 *   refresh       Any phase with a Session (onState): the next state request REFRESH_MS after an answer. Fires in a
 *                 live phase or RECOVERY.
 *   stateRetry    Any phase with a Session after CONFIGURING (onStateFailed): a failed state request is retried after
 *                 1, 2 and 5 s. Fires in a live phase or RECOVERY.
 *   stateRetryUi  As stateRetry, armed at the first failure: show the state retry button RETRY_UI_MS after it.
 *   reconnect     RECOVERY, connection (connectionRecovery, openFailed): the next open after 1, 2 and 5 s, while an
 *                 attempt remains; after the third, none is armed.
 *   retryUi       RECOVERY, connection (connectionRecovery, unless "Try again" already shows): show "Try again"
 *                 RETRY_UI_MS after recovery began.
 *   tool          TOOL_WAIT, or SPEAKING while the lead-in plays (dispatchTool): /api/tool has TOOL_LIMIT_MS.
 *                 Fires: LISTENING.
 *   lineDone      RECOVERY, line (postTurn `missing` or `failed` for a Turn not admitted, onTurn `recoveryOnly`
 *                 when not already in RECOVERY, the permit wait, a refused
 *                 `response.create`): the fallback end of a recovery with no neutral line playing. Disarmed when
 *                 audio starts. Fires with no audio started: cancel what is in flight, LISTENING.
 *   judge         JUDGING or SPECULATING (startJudge): a verdict by t0 + JUDGE_LIMIT_MS (R3.5). Fires: the slow path.
 *   poll          LISTENING onward and RECOVERY (onState on reaching LISTENING, then itself): one state request per
 *                 POLL_MS (R4.5). Never two in flight for one Session as long as every state answer is that
 *                 Session's own: stateOk and stateFailed do not name their request, and onState and onStateFailed
 *                 clear stateSentAt before they look at whose answer it is, so a late answer from an earlier Session
 *                 ends the wait early (and a bare stateFailed also counts a failure against this Session).
 *   swap          Never armed yet (wave B). Its handler does nothing.
 *   speakCap      HELD, RECOVERY or TOOL_WAIT at admission (admit; TOOL_WAIT when the adopted speculative reply
 *                 already holds a recall call), re-armed in SPEAKING when audio starts: SPEAK_CAP_MS. Fires with an
 *                 active reply: cancel all, LISTENING.
 *   heldBack      LISTENING (toListening): an admitted Turn whose reply ended before its transcript, until
 *                 t0 + ADMITTED_TRANSCRIPT_LIMIT_MS. Fires: posted `missing`.
 */
export type TimerName =
  | "openWait"
  | "connect"
  | "ack"
  | "item"
  | "transcript"
  | "permit"
  | "turnRetry"
  | "refresh"
  | "stateRetry"
  | "stateRetryUi"
  | "reconnect"
  | "retryUi"
  | "tool"
  | "lineDone"
  | "judge"
  | "poll"
  | "swap"
  /** Contracts §6 States SPEAKING "45scap": an active reply that never starts or never stops ends here. */
  | "speakCap"
  /** R7.6: the t0 + ADMITTED_TRANSCRIPT_LIMIT_MS wait of a Turn whose admitted reply ended before its transcript. */
  | "heldBack";

export interface VoiceItem {
  itemId: string;
  /** Set when the matching `conversation.item.added` arrives (R15.2). */
  commitSeq: number | null;
  committedAt: number;
  transcript: string | null;
  durationMs: number;
}

export type TurnBody = Omit<Infer<typeof TurnRequest>, "requestId">;

export interface VoiceTurn {
  turnId: string;
  source: "asr" | "typed";
  /** Typed text; null for ASR turns. */
  text: string | null;
  items: VoiceItem[];
  /** End of speech: opsClock at the last `input_audio_buffer.committed` (C§6 t0=committed). */
  tEnd: number;
  /** The TurnRequest sent for this Turn, or null while it still waits for items or transcripts. */
  posted: TurnBody | null;
  staleRetried: boolean;
  /** The judge's verdict for this Turn (invalid counts as U), sent as the TurnRequest's `judge` (R3.9). */
  verdict?: JudgeVerdict | null;
  /** Held by H, U, a judge timeout or a fastO refusal: a reply held never resumes, so the Turn doesn't speculate again. */
  held?: boolean;
}

export type ReplyPurpose = "speech" | "recovery" | "tool";

export interface ToolCallItem {
  callId: string;
  name: "recall" | "make_phone_call";
  arguments: string;
}

export interface PendingReply {
  permit: Permit;
  purpose: ReplyPurpose;
  notes: W[];
  toolCall: ToolCallItem | null;
  toolOutput: Infer<typeof ToolResult> | null;
}

export interface ActiveReply extends PendingReply {
  responseId: string | null;
  audioStarted: boolean;
  /** The function call this reply made, while TOOL_WAIT waits on `/api/tool`. */
  pendingTool: ToolCallItem | null;
  /** The client `event_id` of the `response.create` this reply waits on; matched against `metadata.eventId`. */
  eventId?: string | null;
}

export interface VoiceConfig {
  /** FRANKI_TRANSCRIBE_MODEL from Model_Config; never a literal in code. */
  transcribeModel: string;
}

/** The current Turn's judge (design "New state"). */
export interface JudgeState {
  turnId: string;
  responseId: string | null;
  eventId: string;
  sentAt: number;
  /** t0 + JUDGE_LIMIT_MS. */
  deadline: number;
  verdict: JudgeVerdict | null;
  valid: boolean;
  verdictAt: number | null;
  /** The freshId of the verdict's event, used as a fastO permitId. */
  fastOId?: string | null;
}

/** The speculative reply, and the payload it was created from. */
export interface SpecState {
  turnId: string;
  responseId: string | null;
  eventId: string;
  payload: PayloadInput;
  hash: string | null;
  mutedStarted: boolean;
  heldCall: ToolCallItem | null;
  /** Its `response.done` arrived before it was admitted. */
  done: boolean;
  /** An `error` event refused it: a valid O creates the reply fresh instead (question 85). */
  failed?: boolean;
}

/** A Turn posted `missing` whose transcript may still arrive (R7.8). */
export interface MissingTurn {
  turnId: string;
  clientSeq: number;
  body: TurnBody;
  items: VoiceItem[];
  /** The post + MISSING_WINDOW_MS. */
  until: number;
}

export interface VoiceState {
  phase: VoicePhase;
  config: VoiceConfig;
  zone: string;
  session: { sessionId: string; generation: number } | null;
  /** The most recent Session, sent as `previousSessionId` on the next open (R11.1). */
  lastSessionId: string | null;
  deck: Deck | null;
  ack: StateAck | null;
  /** The `instructions` last sent in a `session.update`. */
  instructions: string | null;
  nextClientSeq: number;
  lastCommitSeq: number;
  turn: VoiceTurn | null;
  /** speech_started / speech_stopped audio offsets by item, for `audioDurationMs`. */
  speech: { itemId: string; startMs: number | null; endMs: number | null }[];
  pending: PendingReply | null;
  active: ActiveReply | null;
  /** Response IDs created for this Session and not yet done. */
  inFlight: string[];
  /**
   * Recent responses, for transcript receipts that arrive after playback: each one's Stamp and the transcript of
   * every message it has spoken so far. A response can speak more than one message (a short preamble, then the
   * answer); they go to the server in order as one transcript receipt at `response.done`. If that never comes,
   * they go when the entry is pushed out of this list, at hang-up, or when the connection is lost.
   */
  recent: { responseId: string; stamp: Stamp; parts: string[]; done: boolean }[];
  deadlines: Partial<Record<TimerName, number>>;
  micMuted: boolean;
  outputMuted: boolean;
  recovery: { kind: "connection" | "line"; since: number; attempts: number } | null;
  retryVisible: boolean;
  stateFailures: { since: number; attempts: number } | null;
  stateRetryVisible: boolean;
  awaitingOpen: boolean;
  hangingUp: boolean;
  error: "open" | "close" | null;
  // voice-control (design "New state")
  judge: JudgeState | null;
  spec: SpecState | null;
  /** Unadmitted_Fragments of this generation, in commit order (KV01). */
  unadmitted: { itemId: string; commitSeq: number }[];
  /**
   * Outstanding_Turns: posted, no answer yet, until the 5 s wait ends. A reconnect keeps them: the server may still
   * commit a post sent before it, so it refuses fastO on the new connection too (Property 7; R4; KV13).
   */
  outstanding: { turnId: string; sessionId: string; deadline: number }[];
  missing: MissingTurn[];
  /** An admitted Turn whose reply ended before its transcript came; posted `final` or `missing` (review item 7). */
  heldBack: VoiceTurn | null;
  lastTurnResponseAt: number | null;
  /** When the in-flight `/api/session/state` went out, or null when none is in flight. */
  stateSentAt: number | null;
  /** The last ack seen was dropped because its request went out before the last `/api/turn` answer. */
  ackDroppedStale: boolean;
  /** The Turn whose reply is admitted (R3.8). */
  admittedTurnId: string | null;
  /** Wave B: swap once the admitted care reply ends (R14.7). */
  afterReply: "swap" | null;
  /** The last loud input frame the Voice_Client reported (Latency_Clock). */
  lastLoudAt: number | null;
  latency: { current: LatencyTimes | null; rows: LatencyRow[] };
  /** Counter for client `event_id`s. */
  eventSeq: number;
  /** Audio of a response this call doesn't own started since the last clear; the next reply clears first (R3.2). */
  strayAudio?: boolean;
  /** Realtime `error` events this visit, by the client event they name (review of wave A, item 15). */
  realtimeErrors?: { n: number; judge: number; spec: number; speech: number; other: number; lastCode: string | null };
}

export function initialVoiceState(config: VoiceConfig, zone = "UTC"): VoiceState {
  return {
    phase: "CLOSED",
    config,
    zone,
    session: null,
    lastSessionId: null,
    deck: null,
    ack: null,
    instructions: null,
    nextClientSeq: 1,
    lastCommitSeq: 0,
    turn: null,
    speech: [],
    pending: null,
    active: null,
    inFlight: [],
    recent: [],
    deadlines: {},
    micMuted: false,
    outputMuted: true,
    recovery: null,
    retryVisible: false,
    stateFailures: null,
    stateRetryVisible: false,
    awaitingOpen: false,
    hangingUp: false,
    error: null,
    judge: null,
    spec: null,
    unadmitted: [],
    outstanding: [],
    missing: [],
    heldBack: null,
    lastTurnResponseAt: null,
    stateSentAt: null,
    ackDroppedStale: false,
    admittedTurnId: null,
    afterReply: null,
    lastLoudAt: null,
    latency: { current: null, rows: [] },
    eventSeq: 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Events

/** The Realtime server events the machine reads (oai-events data channel). */
export type RealtimeServerEvent =
  | { type: "input_audio_buffer.speech_started"; item_id?: string; audio_start_ms?: number }
  | { type: "input_audio_buffer.speech_stopped"; item_id?: string; audio_end_ms?: number }
  | { type: "input_audio_buffer.committed"; item_id: string }
  | { type: "conversation.item.added"; item: { id: string } }
  | { type: "conversation.item.input_audio_transcription.completed"; item_id: string; transcript: string }
  | { type: "conversation.item.input_audio_transcription.failed"; item_id: string }
  | { type: "response.created"; response: { id: string; metadata?: Record<string, string> | null } }
  | { type: "response.done"; response: { id: string; metadata?: Record<string, string> | null } }
  | { type: "output_audio_buffer.started"; response_id: string }
  | { type: "output_audio_buffer.stopped"; response_id: string }
  | { type: "response.output_audio_transcript.done"; response_id: string; transcript: string }
  | { type: "response.function_call_arguments.done"; response_id: string; call_id: string; name: string; arguments: string }
  /** A client event failed; `event_id` names the client event that caused it (question 85). */
  | { type: "error"; error: { type?: string; code?: string | null; message?: string; event_id?: string | null } };

export type VoiceEvent =
  | { type: "callPressed"; zone: string }
  | { type: "hangupPressed" }
  | { type: "mutePressed" }
  | { type: "retryPressed" }
  | { type: "openOk"; response: Infer<typeof OpenResponse> }
  | { type: "openFailed" }
  | { type: "sdpFailed" }
  | { type: "channelOpen" }
  /** The peer connection reached `failed`, or the data channel closed without an Owner hang-up (R15.8). */
  | { type: "connectionLost" }
  | { type: "stateOk"; response: Infer<typeof StateResponse>; sentAt?: number }
  | { type: "stateFailed" }
  | { type: "turnOk"; turnId: string; response: Infer<typeof TurnResponse> }
  | { type: "turnFailed"; turnId: string }
  | { type: "toolOk"; callId: string; response: Infer<typeof ToolResponse> }
  | { type: "toolFailed"; callId: string }
  | { type: "closeDone" }
  | { type: "closeFailed" }
  /** The Voice_Client's SHA-256 of the canonical payload a `verifyPermit` command named. */
  | { type: "permitChecked"; permitId: string; hash: string }
  /** The Voice_Client's SHA-256 of the payload a `hashPayload` command named. */
  | { type: "specHashed"; eventId: string; hash: string }
  /** A typed line sent while a call is live (design "One typed turn" step 4). */
  | { type: "typedSubmitted"; turnId: string; text: string }
  /** `freshId` is a new random ID, used as the turnId if this event starts a Turn. `lastLoudAt` is the Voice_Client's
   * last loud input frame on the opsClock, sent with commits for the Latency_Clock. */
  | { type: "realtime"; event: RealtimeServerEvent; freshId: string; lastLoudAt?: number | null }
  | { type: "timer"; name: TimerName };

// ---------------------------------------------------------------------------------------------
// Commands

export type RealtimeClientEvent = Record<string, unknown> & { type: string };

export type VoiceCommand =
  | { kind: "muteOutput" }
  | { kind: "unmuteOutput" }
  | { kind: "setMic"; enabled: boolean }
  /** Create the peer connection and data channel and exchange SDP through `/api/session/sdp`. */
  | { kind: "connect"; sessionId: string; generation: number }
  /** Stop the microphone track, close the data channel, close the peer connection, in that order (R14.1). */
  | { kind: "teardown" }
  | { kind: "send"; event: RealtimeClientEvent }
  | { kind: "open"; body: { initiator: "user"; previousSessionId: string | null; clientZone: string; visitId: null } }
  | { kind: "state"; body: Infer<typeof StateRequest> }
  /** `supersedesTurnId` names a Turn posted `missing`; the Voice_Client fills `supersedesRequestId` with that request's ID (R7.8). */
  | { kind: "turn"; body: TurnBody; supersedesTurnId?: string }
  | { kind: "tool"; body: Omit<Infer<typeof ToolRequest>, "requestId"> }
  | { kind: "close"; body: Omit<Infer<typeof CloseRequest>, "requestId"> }
  | { kind: "receipt"; body: Omit<Infer<typeof ReceiptRequest>, "requestId"> }
  | { kind: "verifyPermit"; permitId: string; payload: PayloadInput }
  /** Hash a payload; the answer comes back as `specHashed`. */
  | { kind: "hashPayload"; eventId: string; payload: PayloadInput }
  | { kind: "armTimer"; name: TimerName; at: number };

export interface StepResult {
  state: VoiceState;
  commands: VoiceCommand[];
}

// ---------------------------------------------------------------------------------------------
// Realtime client event builders (contracts §6 Realtime, Tools)

/**
 * Transcription hint. The transcript is what memory is extracted from, so names matter most: without a language
 * the Nov 6 live check heard "哈喽" and "Hej." for English greetings, and "Pip" as "Tip" or "Hip".
 */
export const TRANSCRIBE_LANGUAGE = "en";
export const TRANSCRIBE_PROMPT = "A friendly conversation in English with Franki, a personal assistant. The speaker often mentions names of people, pets and places; spell names as said.";

export function sessionUpdate(instructions: string, transcribeModel: string): RealtimeClientEvent {
  // No `model` and no `voice`: those are fixed when the SDP proxy creates the call (R13.1, R13.5).
  return {
    type: "session.update",
    session: {
      type: "realtime",
      tracing: null,
      instructions,
      tools: [RECALL_TOOL, PHONE_TOOL],
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription: { model: transcribeModel, language: TRANSCRIBE_LANGUAGE, prompt: TRANSCRIBE_PROMPT },
          // Semantic end-of-turn (voice/vad.ts): a 300 ms silence cut the Owner off mid-sentence in the Nov 6 live
          // check ("I only heard 'By the way…'"). Responses stay app-created after admission, and barge-in app-handled.
          turn_detection: { ...SEMANTIC_VAD },
        },
      },
    },
  };
}

function safeTurnInput(t: SafeTurn): Record<string, unknown> {
  return t.role === "user"
    ? { type: "message", role: "user", content: [{ type: "input_text", text: t.text }] }
    : { type: "message", role: "assistant", content: [{ type: "output_text", text: t.text }] };
}

/** The reply's input: the Deck's safe turns, then this Turn's audio (or typed text), then any tool exchange. */
function replyInput(st: VoiceState, reply: Pick<PendingReply, "toolCall" | "toolOutput">): Record<string, unknown>[] {
  const deck = st.deck!;
  const turn = st.turn!;
  const input: Record<string, unknown>[] = deck.turns.map(safeTurnInput);
  if (turn.source === "asr") for (const id of audioIds(turn)) input.push({ type: "item_reference", id });
  else input.push({ type: "message", role: "user", content: [{ type: "input_text", text: turn.text ?? "" }] });
  if (reply.toolCall !== null && reply.toolOutput !== null) {
    input.push({ type: "function_call", call_id: reply.toolCall.callId, name: reply.toolCall.name, arguments: reply.toolCall.arguments });
    input.push({ type: "function_call_output", call_id: reply.toolCall.callId, output: JSON.stringify(reply.toolOutput) });
  }
  return input;
}

/** Adds a client `event_id` and the same ID as `metadata.eventId`, so `error` and `response.created` match it. */
export function withEventId(e: RealtimeClientEvent, eventId: string): RealtimeClientEvent {
  const response = (e.response ?? {}) as Record<string, unknown>;
  const metadata = (response.metadata ?? {}) as Record<string, string>;
  return { ...e, event_id: eventId, response: { ...response, metadata: { ...metadata, eventId } } };
}

/** The one `response.create` a verified Permit allows (R15.3; contracts §6 Tools). */
export function replyCreate(st: VoiceState, reply: PendingReply, eventId: string | null = null): RealtimeClientEvent {
  const deck = st.deck!;
  const metadata = {
    purpose: "speech",
    turnId: reply.permit.stamp.turnId,
    generation: String(st.session!.generation),
    noteIds: reply.permit.noteIds.join(","),
  };
  const tag = (e: RealtimeClientEvent) => (eventId === null ? e : withEventId(e, eventId));
  if (reply.purpose === "recovery") {
    // recoveryOnly: the fixed neutral line, no facts and no tools (contracts §6 Admission).
    return tag({
      type: "response.create",
      response: { conversation: "none", instructions: sayExactly(RECOVERY_LINE), input: [], tools: [], metadata },
    });
  }
  const ack = reply.notes.find((n) => n.kind === "ack");
  if (ack !== undefined) {
    // A Fixed_Line: spoken verbatim, no tools (R12.4; question 59).
    return tag({ type: "response.create", response: { conversation: "none", instructions: sayExactly(ack.text), input: [], tools: [], metadata } });
  }
  const notes = reply.notes.length === 0 ? "" : `\n\nNotes:\n${reply.notes.map((n) => `- ${n.text}`).join("\n")}`;
  const input = replyInput(st, reply);
  // Scope `ack` (the crisis care reply) has no tools (R12.6; question 88).
  const tools = reply.permit.scope === "ack" || reply.toolOutput?.name === "make_phone_call"
    ? { tools: [] } : { tools: [RECALL_TOOL, PHONE_TOOL], tool_choice: "auto" };
  return tag({
    type: "response.create",
    response: { conversation: "none", instructions: deck.head.text + notes, input, ...tools, metadata },
  });
}

/** The speculative reply (R2.3): the Deck's Head, no notes, this Turn's audio, muted until admitted. */
export function specCreate(st: VoiceState, eventId: string): RealtimeClientEvent {
  const metadata = { purpose: "speculative", turnId: st.turn!.turnId, generation: String(st.session!.generation), noteIds: "" };
  return withEventId(
    {
      type: "response.create",
      response: { conversation: "none", instructions: st.deck!.head.text, input: replyInput(st, { toolCall: null, toolOutput: null }), tools: [RECALL_TOOL, PHONE_TOOL], tool_choice: "auto", metadata },
    },
    eventId,
  );
}

// ---------------------------------------------------------------------------------------------
// Pure helpers

const IN_CALL: readonly VoicePhase[] = ["LISTENING", "WAIT_ITEM", "JUDGING", "SPECULATING", "HELD", "SPEAKING", "TOOL_WAIT"];
const JUDGE_PHASES: readonly VoicePhase[] = ["JUDGING", "SPECULATING"];

/** The current Stamp: the Session, the held Deck's four revisions, the generation and the current Turn. */
export function localStamp(st: VoiceState): Stamp | null {
  if (st.session === null || st.deck === null || st.turn === null) return null;
  return {
    sessionId: st.session.sessionId,
    epoch: st.deck.epoch,
    policyRev: st.deck.policyRev,
    bundleRev: st.deck.bundleRev,
    rulesRev: st.deck.rulesRev,
    generation: st.session.generation,
    turnId: st.turn.turnId,
  };
}

export function sameStamp(a: Stamp, b: Stamp): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.epoch === b.epoch &&
    a.policyRev === b.policyRev &&
    a.bundleRev === b.bundleRev &&
    a.rulesRev === b.rulesRev &&
    a.generation === b.generation &&
    a.turnId === b.turnId
  );
}

type Revs = { epoch: number; policyRev: number; bundleRev: number; rulesRev: number; generation: number };
const REV_KEYS = ["epoch", "policyRev", "bundleRev", "rulesRev", "generation"] as const;
/** KV05: any revision or the generation is greater than the held one. */
export const isHigher = (next: Revs, held: Revs): boolean => REV_KEYS.some((k) => next[k] > held[k]);
const isLower = (next: Revs, held: Revs): boolean => REV_KEYS.some((k) => next[k] < held[k]);
const sameRevs = (a: SS, d: Deck): boolean =>
  a.epoch === d.epoch && a.policyRev === d.policyRev && a.bundleRev === d.bundleRev && a.rulesRev === d.rulesRev && a.generation === d.generation;

function audioIds(turn: VoiceTurn): string[] {
  return [...turn.items].sort((a, b) => (a.commitSeq ?? 0) - (b.commitSeq ?? 0)).map((i) => i.itemId);
}

/** The payload whose hash the Permit must carry (contracts §6 Hash), as this client will send it. */
export function replyPayload(st: VoiceState, reply: Omit<PendingReply, "permit">): PayloadInput | null {
  const stamp = localStamp(st);
  if (stamp === null || st.deck === null || st.turn === null) return null;
  return {
    stamp,
    head: st.deck.head,
    notes: reply.notes,
    turns: st.deck.turns,
    audioIds: st.turn.source === "asr" ? audioIds(st.turn) : [],
    toolOutput: reply.toolOutput,
  };
}

const KINDS_FOR: Record<ReplyPurpose, readonly PermitKind[]> = {
  speech: ["fastO", "slowOrdinary", "postCommitControl"],
  tool: ["fastO", "slowOrdinary"],
  recovery: ["recoveryOnly"],
};

export type PermitProblem = "hash" | "stamp" | "expired" | "deckExpired" | "kind" | "ack";

/**
 * R17.2, R13.7, KV13: why a Permit may not play, or null. `hash` is the client's own payload hash. The `fastO`
 * StateAck binds when the Permit is issued (KV13); later re-checks (the hash answer, unmute, a function call) pass
 * `checkAck: false`, since the browser drops its ack when it posts the Turn (R4.3).
 */
export function permitProblem(st: VoiceState, reply: PendingReply, hash: string | null, now: number, checkAck = true): PermitProblem | null {
  const stamp = localStamp(st);
  const { permit } = reply;
  if (stamp === null || !sameStamp(permit.stamp, stamp)) return "stamp";
  if (msFromTs(permit.expiresAt) <= now) return "expired";
  if (st.deck === null || msFromTs(st.deck.expiresAt) <= now) return "deckExpired";
  if (!KINDS_FOR[reply.purpose].includes(permit.kind)) return "kind";
  if (permit.kind === "fastO" && checkAck) {
    // KV13 applies to fastO only: a StateAck matching all four revisions, younger than 2.5 s.
    const ack = st.ack;
    if (ack === null || !sameRevs(ack.stamp, st.deck) || now - msFromTs(ack.issuedOpsAt) >= FAST_ACK_AGE_MS) return "ack";
  }
  // An empty hash (a failed hash command) never matches, even an empty approved hash (review of wave A, item 13).
  if (hash !== null && (hash === "" || hash !== permit.approvedPayloadHash)) return "hash";
  return null;
}

export type AvatarState = "closed" | "connecting" | "listening" | "thinking" | "speaking" | "recovery";

/** R16.3: the Stand_In_Avatar state for a machine state. */
export function avatarState(st: VoiceState): AvatarState {
  if (st.recovery?.kind === "connection" && st.phase !== "CLOSED") return "recovery";
  switch (st.phase) {
    case "CLOSED":
      return "closed";
    case "CONNECTING":
    case "CONFIGURING":
      return "connecting";
    case "LISTENING":
      return "listening";
    case "WAIT_ITEM":
    case "JUDGING":
    case "SPECULATING":
    case "HELD":
    case "TOOL_WAIT":
    case "SWAPPING":
      return "thinking";
    case "SPEAKING":
      // R6.4: never "speaking" while output is muted.
      return st.outputMuted ? "thinking" : "speaking";
    case "RECOVERY":
      return "recovery";
  }
}

/** R16.4, R16.5, R11.1: the call button's form and whether a press does anything. */
export function callButton(st: VoiceState): { form: "start" | "hangup"; disabled: boolean } {
  if (st.phase === "CLOSED") return { form: "start", disabled: st.hangingUp || st.awaitingOpen };
  return { form: "hangup", disabled: false };
}

export const muteVisible = (st: VoiceState): boolean => ["listening", "thinking", "speaking"].includes(avatarState(st));

// ---------------------------------------------------------------------------------------------
// The reducer

class Step {
  readonly cmds: VoiceCommand[] = [];
  constructor(
    public st: VoiceState,
    readonly now: number,
  ) {}

  set(patch: Partial<VoiceState>): void {
    this.st = { ...this.st, ...patch };
  }
  push(...c: VoiceCommand[]): void {
    this.cmds.push(...c);
  }
  send(event: RealtimeClientEvent): void {
    if (event.type === "output_audio_buffer.clear" && this.st.strayAudio) this.set({ strayAudio: false });
    this.push({ kind: "send", event });
  }
  arm(name: TimerName, at: number): void {
    this.set({ deadlines: { ...this.st.deadlines, [name]: at } });
    this.push({ kind: "armTimer", name, at });
  }
  disarm(...names: TimerName[]): void {
    const d = { ...this.st.deadlines };
    for (const n of names) delete d[n];
    this.set({ deadlines: d });
  }
  mute(): void {
    this.push({ kind: "muteOutput" });
    this.set({ outputMuted: true });
  }
  result(): StepResult {
    return { state: this.st, commands: this.cmds };
  }
}

/** The transcript receipt for a response (R21.1): what Franki said, as one text, under the response's own Stamp. */
function transcriptReceipt(s: Step, r: { responseId: string; stamp: Stamp }, text: string): void {
  s.push({
    kind: "receipt",
    body: { stamp: r.stamp, responseId: r.responseId, kind: "transcript", momentIds: [], noteIds: [], pendingId: null, permitKind: null, text: text.slice(0, 4096) },
  });
}

type SpokenResponse = VoiceState["recent"][number];

/** One transcript receipt for each response still waiting for `response.done`, with every message it held. */
function sendHeld(s: Step, responses: readonly SpokenResponse[]): void {
  for (const r of responses) if (!r.done && r.parts.length > 0) transcriptReceipt(s, r, r.parts.join(" "));
}

/**
 * Hang-up or a lost connection: no `response.done` can come now, so every response still waiting sends what it
 * held and is marked done, so nothing is sent twice. A receipt needs only the entry's own Stamp, so this does not
 * depend on the Session still being held; the server refuses a Stamp that is no longer current (R21.5).
 */
function flushRecent(s: Step): void {
  if (s.st.recent.every((r) => r.done)) return;
  sendHeld(s, s.st.recent);
  s.set({ recent: s.st.recent.map((r) => (r.done ? r : { ...r, parts: [], done: true })) });
}

export function step(state: VoiceState, event: VoiceEvent, now: number): StepResult {
  const s = new Step(state, now);
  switch (event.type) {
    case "callPressed":
      if (state.phase === "CLOSED" && !state.hangingUp && !state.awaitingOpen) startOpen(s, event.zone, false);
      break;
    case "retryPressed":
      if (state.phase === "RECOVERY" && state.recovery?.kind === "connection" && state.retryVisible) reconnect(s);
      else if (state.stateRetryVisible && state.session !== null) postState(s);
      break;
    case "hangupPressed":
      hangUp(s);
      break;
    case "mutePressed":
      if (IN_CALL.includes(state.phase)) {
        s.push({ kind: "setMic", enabled: state.micMuted });
        s.set({ micMuted: !state.micMuted });
      }
      break;
    case "openOk":
      onOpen(s, event.response);
      break;
    case "openFailed":
      if (state.awaitingOpen) openFailed(s);
      break;
    case "sdpFailed":
    case "connectionLost":
      if (state.phase !== "CLOSED" && state.session !== null && !(state.phase === "RECOVERY" && state.recovery?.kind === "connection")) {
        connectionRecovery(s, true);
      }
      break;
    case "channelOpen":
      if (state.phase === "CONNECTING" && state.session !== null && state.deck !== null) {
        const instructions = state.deck.head.text;
        s.send(sessionUpdate(instructions, state.config.transcribeModel));
        s.set({ phase: "CONFIGURING", instructions });
        s.disarm("connect");
        postState(s);
        s.arm("ack", now + ACK_LIMIT_MS);
      }
      break;
    case "stateOk":
      onState(s, event.response, event.sentAt);
      break;
    case "stateFailed":
      onStateFailed(s);
      break;
    case "turnOk":
      onTurn(s, event.turnId, event.response);
      break;
    case "turnFailed": {
      // The client already retried the same requestId; the Session's clientSeq is unknown now, so reconnect,
      // which opens a fresh Session (design "Session timing"). That holds for any post of this Session, current
      // or not, and whether or not the permit wait fired first (review of wave A, item 6).
      const ours = state.outstanding.some((o) => o.turnId === event.turnId && o.sessionId === state.session?.sessionId) || (state.turn?.turnId === event.turnId && state.turn.posted !== null);
      s.set({ outstanding: state.outstanding.filter((o) => o.turnId !== event.turnId), lastTurnResponseAt: now });
      if (s.st.ack !== null) s.set({ ack: null, ackDroppedStale: true });
      if (ours && state.session !== null) connectionRecovery(s, true);
      break;
    }
    case "toolOk":
      onTool(s, event.callId, event.response);
      break;
    case "toolFailed":
      if ((state.phase === "TOOL_WAIT" || state.phase === "SPEAKING") && state.active?.pendingTool?.callId === event.callId) toListening(s);
      break;
    case "closeDone":
      s.set({ hangingUp: false });
      break;
    case "closeFailed":
      // R14.8, R16.6: the call is already torn down locally; expiry closes the server Session.
      s.set({ hangingUp: false, error: state.hangingUp ? "close" : state.error });
      break;
    case "permitChecked":
      onPermitChecked(s, event.permitId, event.hash);
      break;
    case "specHashed":
      onSpecHashed(s, event.eventId, event.hash);
      break;
    case "typedSubmitted":
      if (state.phase === "LISTENING" && state.session !== null && state.deck !== null && event.text.trim() !== "") {
        s.set({ turn: { turnId: event.turnId, source: "typed", text: event.text, items: [], tEnd: now, posted: null, staleRetried: false } });
        postTurn(s, "final");
      }
      break;
    case "realtime":
      onRealtime(s, event.event, event.freshId, event.lastLoudAt ?? null);
      break;
    case "timer":
      onTimer(s, event.name);
      break;
    default:
      // Compile-time only: a VoiceEvent member with no case fails the typecheck. At run time nothing happens.
      event satisfies never;
  }
  return s.result();
}

// ---------------------------------------------------------------------------------------------
// Open, connect, recovery and close

function startOpen(s: Step, zone: string, retrying: boolean): void {
  s.set({
    phase: "CONNECTING",
    zone,
    awaitingOpen: true,
    error: null,
    // A reconnect keeps the Owner's mute: only mutePressed or the end of the call changes it (R15.6, V1 step 3).
    micMuted: retrying ? s.st.micMuted : false,
    recovery: retrying ? s.st.recovery : null,
    retryVisible: retrying ? s.st.retryVisible : false,
  });
  s.push({ kind: "open", body: { initiator: "user", previousSessionId: s.st.lastSessionId, clientZone: zone, visitId: null } });
  s.arm("openWait", s.now + OPEN_LIMIT_MS);
}

function onOpen(s: Step, res: Infer<typeof OpenResponse>): void {
  const st = s.st;
  if (!st.awaitingOpen) {
    // The Owner hung up before the open answered: close the Session it created.
    if (res.state === "connecting") s.push({ kind: "close", body: { sessionId: res.sessionId, generation: res.generation, reason: "user" } });
    return;
  }
  s.disarm("openWait");
  s.set({ awaitingOpen: false });
  if (res.state === "blocked" || res.deck === null || res.ack === null) {
    openFailed(s);
    return;
  }
  s.set({
    session: { sessionId: res.sessionId, generation: res.generation },
    lastSessionId: res.sessionId,
    deck: res.deck,
    ack: res.ack,
    instructions: null,
    nextClientSeq: 1,
    lastCommitSeq: 0,
    turn: null,
    speech: [],
    pending: null,
    active: null,
    inFlight: [],
    judge: null, spec: null, unadmitted: [], outstanding: st.outstanding, missing: [], heldBack: null, admittedTurnId: null, stateSentAt: null, afterReply: null, 
    stateFailures: null,
    stateRetryVisible: false,
  });
  s.push({ kind: "connect", sessionId: res.sessionId, generation: res.generation });
  // The 5 s setup limit counts from the open response, not the press (R15.8; design fix 2).
  s.arm("connect", s.now + CONNECT_LIMIT_MS);
}

function openFailed(s: Step): void {
  s.disarm("openWait");
  s.set({ awaitingOpen: false });
  if (s.st.recovery?.kind === "connection") {
    s.set({ phase: "RECOVERY" });
    scheduleReconnect(s);
    return;
  }
  // R16.6: release everything and show which step failed, with the button in its start form.
  s.mute();
  s.push({ kind: "teardown" });
  s.set({ ...closedFields(s.st), error: "open" });
}

/**
 * The reset table: what each exit does to each field. A new VoiceState field gets a cell in every column here.
 *   closed    closedFields, as hangUp and openFailed (outside connection recovery) apply it; phase CLOSED.
 *   recovery  connectionRecovery; phase RECOVERY, kind "connection". (openFailed inside connection recovery resets
 *             no call field: awaitingOpen false, openWait disarmed, phase back to RECOVERY, and the next reconnect
 *             if an attempt remains.)
 *   open      onOpen with a usable answer: the start of every Session, first call or reconnect.
 *   press     startOpen: Call pressed, or a reconnect from RECOVERY; phase CONNECTING.
 * "keep" and "-" both leave the field as it was: "keep" where a reset might be expected, "-" where the exit has
 * nothing to do with the field.
 *
 *   field                     closed                    recovery                       open            press
 *   session, deck, ack        null                      null                           the answer's    -
 *   lastSessionId             the Session's, or keep    the Session's, or keep         the answer's    -
 *   turn, pending, active     null                      null                           null            -
 *   inFlight, unadmitted      []                        []                             []              -
 *   judge, spec, heldBack     null                      null                           null            -
 *   missing                   []                        []                             []              -
 *   admittedTurnId            null                      null                           null            -
 *   stateSentAt, afterReply   null                      null                           null            -
 *   outstanding               keep                      keep                           keep            -
 *   speech                    []                        keep                           []              -
 *   instructions              null                      keep                           null            -
 *   nextClientSeq             keep                      keep                           1               -
 *   lastCommitSeq             keep                      keep                           0               -
 *   deadlines                 {}                        {}, then retryUi unless        -openWait,      +openWait
 *                                                       Try again shows, and           +connect
 *                                                       reconnect while attempts < 3
 *   recovery                  null                      connection; since and          -               retrying: kept,
 *                                                       attempts kept if already in                    after reconnect()
 *                                                       one, else now and 0                            added 1 to attempts
 *                                                                                                      and disarmed
 *                                                                                                      reconnect; else null
 *   retryVisible              false                     keep                           -               retrying: keep;
 *                                                                                                      else false
 *   stateFailures             null                      null                           null            -
 *   stateRetryVisible         false                     false                          false           -
 *   micMuted                  false                     keep                           -               retrying: keep;
 *                                                                                                      else false
 *   outputMuted               true                      true (mute)                    -               -
 *   awaitingOpen              false (set by caller)     keep                           false           true
 *   hangingUp                 hangUp: a Session was     keep                           -               -
 *                             held; openFailed: keep
 *   error                     hangUp: null;             keep                           -               null
 *                             openFailed: "open"
 *   recent                    hangUp: flushed, marked   flushed, marked done           -               -
 *                             done; openFailed: keep
 *   zone                      -                         -                              -               the press's
 * Never reset by any exit: config, lastTurnResponseAt, ackDroppedStale, lastLoudAt, latency, eventSeq, strayAudio,
 * realtimeErrors.
 * Not an exit, but a reset: when CONFIGURING reaches LISTENING, onState sets recovery to null and retryVisible to
 * false, and disarms ack, connect, retryUi and reconnect.
 */
function closedFields(st: VoiceState): Partial<VoiceState> {
  return {
    phase: "CLOSED",
    session: null,
    deck: null,
    ack: null,
    instructions: null,
    turn: null,
    speech: [],
    pending: null,
    active: null,
    inFlight: [],
    judge: null, spec: null, unadmitted: [], outstanding: st.outstanding, missing: [], heldBack: null, admittedTurnId: null, stateSentAt: null, afterReply: null, 
    deadlines: {},
    recovery: null,
    retryVisible: false,
    stateFailures: null,
    stateRetryVisible: false,
    micMuted: false,
    outputMuted: true,
    lastSessionId: st.session?.sessionId ?? st.lastSessionId,
  };
}

function hangUp(s: Step): void {
  const st = s.st;
  if (st.phase === "CLOSED") return;
  // R14.1: stop the mic, close the channel and the peer connection, then post close; held transcripts go just
  // before close (R21.1).
  s.mute();
  s.push({ kind: "teardown" });
  flushRecent(s);
  if (st.session !== null) s.push({ kind: "close", body: { sessionId: st.session.sessionId, generation: st.session.generation, reason: "user" } });
  s.set({ ...closedFields(st), hangingUp: st.session !== null, awaitingOpen: false, error: null });
}

/** R15.8: mute, stop dispatch, tear down, and reconnect after 1, 2 and 5 s; retry button at 30 s. */
function connectionRecovery(s: Step, closeSession: boolean): void {
  const st = s.st;
  s.mute();
  s.push({ kind: "teardown" });
  flushRecent(s);
  if (closeSession && st.session !== null) s.push({ kind: "close", body: { sessionId: st.session.sessionId, generation: st.session.generation, reason: "error" } });
  const since = st.recovery?.kind === "connection" ? st.recovery.since : s.now;
  s.set({
    phase: "RECOVERY",
    lastSessionId: st.session?.sessionId ?? st.lastSessionId,
    session: null,
    deck: null,
    ack: null,
    turn: null,
    pending: null,
    active: null,
    inFlight: [],
    judge: null, spec: null, unadmitted: [], outstanding: st.outstanding, missing: [], heldBack: null, admittedTurnId: null, stateSentAt: null, afterReply: null, 
    deadlines: {},
    recovery: { kind: "connection", since, attempts: st.recovery?.kind === "connection" ? st.recovery.attempts : 0 },
    // With no Session there is no state to ask for, so the state-retry control goes: no "Try again" shows that a
    // press can't act on (V1 step 4). The connection's own "Try again" comes at retryUi.
    stateFailures: null,
    stateRetryVisible: false,
  });
  if (!s.st.retryVisible) s.arm("retryUi", since + RETRY_UI_MS);
  scheduleReconnect(s);
}

function scheduleReconnect(s: Step): void {
  const r = s.st.recovery;
  if (r === null) return;
  const delay = RETRY_DELAYS_MS[r.attempts];
  if (delay !== undefined) s.arm("reconnect", s.now + delay);
}

function reconnect(s: Step): void {
  const r = s.st.recovery!;
  s.disarm("reconnect");
  s.set({ recovery: { ...r, attempts: r.attempts + 1 } });
  startOpen(s, s.st.zone, true);
}

// ---------------------------------------------------------------------------------------------
// State refresh and decks

function postState(s: Step): void {
  const { session, deck, ack } = s.st;
  if (session === null || deck === null) return;
  // R4.5: never two state requests in flight, whichever of poll, refresh, stateRetry or the retry button asks
  // (review of wave A, item 10). An answer, a failure or STATE_STALE_MS ends the one in flight; the answer or
  // failure need not be this Session's (the poll row on TimerName).
  if (s.st.stateSentAt !== null && s.now - s.st.stateSentAt < STATE_STALE_MS) return;
  s.set({ stateSentAt: s.now });
  s.push({
    kind: "state",
    body: {
      sessionId: session.sessionId,
      generation: session.generation,
      seen: { epoch: deck.epoch, policyRev: deck.policyRev, bundleRev: deck.bundleRev, rulesRev: deck.rulesRev },
      ackStamp: ack?.stamp ?? null,
      speechStartedOpsAt: null,
    },
  });
}

/** KV05 and R13.5: take a Deck from any response; a higher one cancels everything built on the old one. */
function adoptDeck(s: Step, next: Deck | null): void {
  const held = s.st.deck;
  if (next === null || s.st.session === null || next.generation !== s.st.session.generation) return;
  if (held !== null && isLower(next, held) && !isHigher(next, held)) return;
  if (held !== null && isHigher(next, held)) cancelAll(s, true);
  s.set({ deck: next });
  const live = s.st.phase !== "CONNECTING" && s.st.phase !== "CLOSED" && s.st.instructions !== null;
  if (live && next.head.text !== s.st.instructions) {
    s.send(sessionUpdate(next.head.text, s.st.config.transcribeModel));
    s.set({ instructions: next.head.text });
  }
}

/** Mute, cancel every recorded response by ID, then clear output audio (KV04, KV05). */
function cancelAll(s: Step, higherStamp: boolean): void {
  const st = s.st;
  s.mute();
  // Every response this call made, including a speculative reply that already finished generating (KV04).
  const ids = [...new Set([...st.inFlight, st.spec?.responseId, st.judge?.responseId].filter((x): x is string => x != null))];
  for (const id of ids) s.send({ type: "response.cancel", response_id: id });
  s.send({ type: "output_audio_buffer.clear" });
  const a = st.active;
  if (a !== null && a.responseId !== null) receipt(s, a, a.audioStarted ? "playbackEnded" : "cancelled");
  s.set({ inFlight: [], pending: null, active: null, judge: null, spec: null });
  s.disarm("tool", "permit", "turnRetry", "judge", "speakCap");
  if (higherStamp && (st.phase === "SPEAKING" || st.phase === "TOOL_WAIT" || st.phase === "HELD" || JUDGE_PHASES.includes(st.phase))) {
    // Design table: SPEAKING goes to HELD on a higher revision; no Permit can follow for the old reply.
    s.set({ phase: "HELD" });
    s.arm("permit", s.now + HOLD_LIMIT_MS);
  }
}

function onState(s: Step, res: Infer<typeof StateResponse>, sentAt?: number): void {
  const st = s.st;
  const sent = sentAt ?? st.stateSentAt ?? s.now;
  s.set({ stateSentAt: null });
  if (st.session === null || res.stamp.sessionId !== st.session.sessionId) return;
  // A poll sent before the last turn answer carries an older Deck's safe turns: only a higher Deck is taken from it
  // (review of wave A, item 2).
  const asked = sentAt ?? st.stateSentAt;
  const staleRequest = asked !== null && st.lastTurnResponseAt !== null && asked <= st.lastTurnResponseAt;
  if (!staleRequest || st.deck === null || res.deck === null || isHigher(res.deck, st.deck)) adoptDeck(s, res.deck);
  // R4.2: `ack:null` refuses fastO. R4.4: an ack requested before the last /api/turn answer can't grant it.
  if (res.ack === null) s.set({ ack: null, ackDroppedStale: false });
  else if (res.ack.stamp.sessionId === st.session.sessionId) {
    const stale = s.st.lastTurnResponseAt !== null && sent <= s.st.lastTurnResponseAt;
    s.set(stale ? { ack: null, ackDroppedStale: true } : { ack: res.ack, ackDroppedStale: false });
  }
  s.set({ stateFailures: null, stateRetryVisible: false });
  s.disarm("stateRetry", "stateRetryUi");
  s.arm("refresh", s.now + REFRESH_MS);
  if (s.st.phase === "CONFIGURING" && s.st.ack !== null && s.st.deck !== null && sameRevs(s.st.ack.stamp, s.st.deck)) {
    s.disarm("ack", "connect", "retryUi", "reconnect");
    s.set({ phase: "LISTENING", recovery: null, retryVisible: false });
    s.arm("poll", s.now + POLL_MS);
  }
}

function onStateFailed(s: Step): void {
  const st = s.st;
  s.set({ stateSentAt: null });
  // In CONFIGURING the 1.5 s ack limit decides (R13.9). Otherwise keep the ack and Deck unextended (R13.8).
  if (st.session === null || st.phase === "CONFIGURING" || st.phase === "CONNECTING") return;
  const f = st.stateFailures ?? { since: s.now, attempts: 0 };
  const delay = RETRY_DELAYS_MS[f.attempts];
  s.set({ stateFailures: { since: f.since, attempts: f.attempts + 1 } });
  if (delay !== undefined) s.arm("stateRetry", s.now + delay);
  if (st.stateFailures === null) s.arm("stateRetryUi", f.since + RETRY_UI_MS);
}

// ---------------------------------------------------------------------------------------------
// Turns

/** The TurnRequest body for `turn` at the next clientSeq, with commitSeqs filled in (design "Turn grouping"). */
function buildTurnBody(st: VoiceState, turn: VoiceTurn, transcriptState: "final" | "missing" | "failed") {
  const deck = st.deck!;
  const session = st.session!;
  let lastCommitSeq = st.lastCommitSeq;
  // An item whose item.added never came still needs a commitSeq on the wire; it takes the next ones in commit order.
  const items = [...turn.items]
    .sort((a, b) => (a.commitSeq ?? Number.MAX_SAFE_INTEGER) - (b.commitSeq ?? Number.MAX_SAFE_INTEGER) || a.committedAt - b.committedAt)
    .map((i) => (i.commitSeq !== null ? i : { ...i, commitSeq: ++lastCommitSeq }));
  const transcript =
    transcriptState !== "final" ? "" : turn.source === "typed" ? (turn.text ?? "") : items.map((i) => i.transcript ?? "").join(" ").slice(0, 8192);
  const body: TurnBody = {
    sessionId: session.sessionId,
    epoch: deck.epoch,
    policyRev: deck.policyRev,
    bundleRev: deck.bundleRev,
    rulesRev: deck.rulesRev,
    generation: session.generation,
    turnId: turn.turnId,
    clientSeq: st.nextClientSeq,
    source: turn.source,
    items:
      turn.source === "typed"
        ? []
        : items.map((i) => ({
            itemId: i.itemId,
            commitSeq: i.commitSeq!,
            final: transcriptState === "final" && i.transcript !== null,
            audioEndOpsAt: tsFromMs(i.committedAt),
            audioDurationMs: Math.min(60_000, Math.max(0, Math.round(i.durationMs))),
          })),
    utteredWorldAt: tsFromMs(turn.tEnd),
    transcript,
    transcriptState,
    judge: turn.source === "typed" ? "typed" : (turn.verdict ?? "timeout"),
    pendingId: null,
    choiceId: null,
    supersedesRequestId: null,
    uiControl: null,
  };
  return { body, items, lastCommitSeq };
}

/**
 * A Turn whose reply was admitted and ended before its transcript came is kept here until it is posted `final` or
 * `missing` at t0 + ADMITTED_TRANSCRIPT_LIMIT_MS (R7.6; review of wave A, item 7). Posting it changes no phase.
 */
function postHeldBack(s: Step, transcriptState: "final" | "missing" | "failed"): void {
  const st = s.st;
  const turn = st.heldBack;
  if (turn === null || st.session === null || st.deck === null) return;
  const { body, items, lastCommitSeq } = buildTurnBody(st, turn, transcriptState);
  s.set({ heldBack: null, nextClientSeq: st.nextClientSeq + 1, lastCommitSeq });
  s.disarm("heldBack");
  pushTurn(s, body);
  if (transcriptState === "missing")
    s.set({ missing: [...s.st.missing.filter((m) => m.until > s.now), { turnId: turn.turnId, clientSeq: body.clientSeq, body, items, until: s.now + MISSING_WINDOW_MS }].slice(-2) });
}

function postTurn(s: Step, transcriptState: "final" | "missing" | "failed"): void {
  // An earlier admitted Turn still waiting for its transcript goes first, so clientSeq keeps commit order (item 7).
  if (s.st.heldBack !== null) postHeldBack(s, "missing");
  const st = s.st;
  const turn = st.turn!;
  const { body, items, lastCommitSeq } = buildTurnBody(st, turn, transcriptState);
  s.set({ turn: { ...turn, items, posted: body }, nextClientSeq: st.nextClientSeq + 1, lastCommitSeq });
  s.disarm("item", "transcript");
  pushTurn(s, body);
  const admitted = st.admittedTurnId === turn.turnId;
  if (transcriptState === "final") {
    // Posting keeps a running judge, speculative reply or admitted reply where it is (design rows "all transcripts in").
    // A final post from LISTENING (a typed line) waits in HELD for its Permit (review of wave A, item 3).
    if (s.st.phase === "WAIT_ITEM" || s.st.phase === "LISTENING") s.set({ phase: "HELD" });
    // R7.5: the answer has TURN_RESPONSE_LIMIT_MS; a Permit inside it plays, however late after the commit.
    if (!admitted) s.arm("permit", s.now + TURN_RESPONSE_LIMIT_MS);
  } else {
    // R7.8: a transcript may still come; it is sent then as a superseding post.
    if (transcriptState === "missing" && turn.source === "asr")
      s.set({ missing: [...s.st.missing.filter((m) => m.until > s.now), { turnId: turn.turnId, clientSeq: body.clientSeq, body, items, until: s.now + MISSING_WINDOW_MS }].slice(-2) });
  }
  if (transcriptState === "final" || admitted) {
    // R7.6: the transcript went missing after the reply was admitted: it plays on.
  } else {
    dropSpeculation(s);
    // R15.11: RECOVERY plays only the neutral line under a recoveryOnly Permit, then listens again.
    s.set({ phase: "RECOVERY", recovery: { kind: "line", since: s.now, attempts: 0 } });
    s.arm("lineDone", s.now + LINE_FALLBACK_MS * 2);
  }
}

/** Sends a TurnRequest: the request is outstanding. The held StateAck stays: it vouches for every earlier Turn (R4.3; review of wave A, item 1). */
function pushTurn(s: Step, body: TurnBody, supersedesTurnId: string | null = null): void {
  s.push(supersedesTurnId === null ? { kind: "turn", body } : { kind: "turn", body, supersedesTurnId });
  s.set({
    outstanding: [...s.st.outstanding.filter((o) => o.turnId !== body.turnId && o.deadline > s.now), { turnId: body.turnId, sessionId: body.sessionId, deadline: s.now + TURN_RESPONSE_LIMIT_MS }],
  });
}

function onTurn(s: Step, turnId: string, res: Infer<typeof TurnResponse>): void {
  // Every answer ends its request's wait and dates the next StateAck: an ack requested before it can't grant fastO.
  const wasOutstanding = s.st.outstanding.some((o) => o.turnId === turnId);
  s.set({ outstanding: s.st.outstanding.filter((o) => o.turnId !== turnId), lastTurnResponseAt: s.now });
  if (s.st.ack !== null) s.set({ ack: null, ackDroppedStale: true });
  const st = s.st;
  const turn = st.turn;
  if (st.session === null || res.stamp.sessionId !== st.session.sessionId || res.stamp.generation !== st.session.generation) return;
  const current = turn !== null && turn.turnId === turnId && turn.posted !== null && res.stamp.turnId === turnId;
  if (!current) {
    // An answer for a turn that is no longer current still carries a Deck (design rows), and if nothing was
    // recorded the Session's clientSeq is behind ours: reconnect (review of wave A, item 6).
    adoptDeck(s, res.deck);
    const unrecorded = res.error !== null || res.status === "stale" || (res.status === "hold" && res.permit === null && res.retryAfterMs > 0);
    if (unrecorded && wasOutstanding && s.st.session !== null) connectionRecovery(s, true);
    return;
  }
  adoptDeck(s, res.deck);
  if (s.st.turn?.turnId !== turnId || turn === null || turn.posted === null) return;
  // Nothing recorded: the Session's clientSeq is behind ours. Resend a stale Turn once with the current revisions;
  // after that, or on an error, reconnect (review of wave A, item 6). A playing reply is left alone by the resend.
  if (res.error !== null) return connectionRecovery(s, true);
  if (res.status === "stale") {
    if (turn.staleRetried) return connectionRecovery(s, true);
    const body: TurnBody = { ...turn.posted, epoch: res.stamp.epoch, policyRev: res.stamp.policyRev, bundleRev: res.stamp.bundleRev, rulesRev: res.stamp.rulesRev };
    s.set({ turn: { ...turn, posted: body, staleRetried: true } });
    pushTurn(s, body);
    return;
  }
  if (s.st.admittedTurnId === turnId) {
    // A reply of this Turn is already admitted. Only a route that changes what is said cuts it (R11.6; question 92).
    const cut = res.permit !== null && res.error === null && (res.status === "ready" || res.status === "clarify");
    if (!cut) return;
    cancelAll(s, false);
    s.set({ admittedTurnId: null, phase: "HELD" });
  }
  if (res.status === "hold" && res.permit === null) {
    if (res.retryAfterMs > 0) s.arm("turnRetry", s.now + res.retryAfterMs);
    return;
  }
  // Wave B gives `blocked` its swap; until then nothing plays and the permit wait ends the turn.
  if (res.status === "blocked") return;
  if (res.permit === null) return noReply(s);
  const permit = res.permit;
  setLatency(s, (t) => ({ ...t, permitAt: s.now }));
  if (permit.kind === "recoveryOnly") {
    // A missing transcript, a failed parse, or a failed parse with a regex match (R7.4, R10.2): the neutral line.
    dropSpeculation(s);
    if (s.st.phase !== "RECOVERY") {
      s.set({ phase: "RECOVERY", recovery: { kind: "line", since: s.now, attempts: 0 } });
      s.arm("lineDone", s.now + LINE_FALLBACK_MS * 2);
    }
    return requestVerify(s, { permit, purpose: "recovery", notes: [], toolCall: null, toolOutput: null });
  }
  const spec = s.st.spec;
  const coversSpec = spec !== null && spec.turnId === turnId && !spec.failed && spec.hash !== null && permit.kind === "slowOrdinary" && res.notes.length === 0 && permit.approvedPayloadHash === spec.hash;
  if (coversSpec) cancelJudge(s);
  else {
    dropSpeculation(s);
    if (JUDGE_PHASES.includes(s.st.phase)) s.set({ phase: "HELD" });
  }
  requestVerify(s, { permit, purpose: "speech", notes: res.notes, toolCall: null, toolOutput: null });
}

/** No reply will come for this Turn: listen again (after the recovery screen, if one shows). */
function noReply(s: Step): void {
  s.set({ pending: null });
  if (s.st.phase === "RECOVERY") return; // lineDone returns to LISTENING
  toListening(s);
}

function toListening(s: Step): void {
  s.mute();
  dropSpeculation(s);
  finishLatency(s);
  const st = s.st;
  const turn = st.turn;
  // R7.6: an admitted reply ended before its transcript came. The Turn is kept until it is posted `final` (its
  // transcript), or `missing` at t0 + 5 s, so its Evidence and slow parse still happen (review of wave A, item 7).
  const keep = turn !== null && turn.posted === null && turn.source === "asr" && st.admittedTurnId === turn.turnId;
  s.disarm("permit", "turnRetry", "tool", "lineDone", "item", "transcript", "judge", "speakCap");
  if (keep) {
    if (st.heldBack !== null) postHeldBack(s, "missing");
    s.set({ heldBack: turn });
    s.arm("heldBack", turn.tEnd + ADMITTED_TRANSCRIPT_LIMIT_MS);
  }
  s.set({ phase: "LISTENING", turn: null, pending: null, active: null, admittedTurnId: null, recovery: s.st.recovery?.kind === "line" ? null : s.st.recovery });
}

/** A transcript for the held-back Turn: posted `final` once every item has one. Returns true when it was one. */
function onHeldBackTranscript(s: Step, itemId: string, transcript: string | null): boolean {
  const hb = s.st.heldBack;
  if (hb === null || !hb.items.some((i) => i.itemId === itemId)) return false;
  if (transcript === null) {
    postHeldBack(s, "failed");
    return true;
  }
  const items = hb.items.map((i) => (i.itemId === itemId ? { ...i, transcript } : i));
  s.set({ heldBack: { ...hb, items } });
  if (items.every((i) => i.transcript !== null)) postHeldBack(s, "final");
  return true;
}

function requestVerify(s: Step, reply: PendingReply): void {
  const payload = replyPayload(s.st, reply);
  // A Permit that already fails a check needs no hash: it never plays (R17.3).
  if (payload === null || permitProblem(s.st, reply, null, s.now) !== null) return rejectReply(s);
  s.set({ pending: reply });
  // Every check waits with a deadline (KV06): no answer to the hash, and the Turn ends (R7.5).
  if (s.st.phase !== "RECOVERY" && s.st.deadlines.permit === undefined) s.arm("permit", s.now + TURN_RESPONSE_LIMIT_MS);
  s.push({ kind: "verifyPermit", permitId: reply.permit.permitId, payload });
}

function rejectReply(s: Step): void {
  // R17.3: play nothing and cancel any pending response of this reply.
  for (const id of s.st.inFlight) s.send({ type: "response.cancel", response_id: id });
  // Whatever a cancelled response left in the output buffer is cleared (review of wave A, item 12).
  if (s.st.strayAudio === true || s.st.inFlight.length > 0) s.send({ type: "output_audio_buffer.clear" });
  s.set({ inFlight: [], pending: null, active: null, judge: null, spec: null });
  noReply(s);
}

/** Cancels the judge by ID; its verdict no longer matters. */
function cancelJudge(s: Step): void {
  const j = s.st.judge;
  if (j === null) return;
  if (j.responseId !== null && s.st.inFlight.includes(j.responseId)) {
    s.send({ type: "response.cancel", response_id: j.responseId });
    s.set({ inFlight: s.st.inFlight.filter((id) => id !== j.responseId) });
  }
  s.set({ judge: null });
  s.disarm("judge");
}

/** A held Turn takes the slow path, recording why fastO was refused. It never speculates again (R3.3, R3.4). */
function holdForSlowPath(s: Step, refused: FastORefusal | null): void {
  dropSpeculation(s);
  if (refused !== null) setLatency(s, (t) => ({ ...t, refused }));
  const turn = s.st.turn;
  s.set({ phase: "HELD", turn: turn === null ? turn : { ...turn, held: true } });
}

function onJudgeDone(s: Step, ev: Extract<RealtimeServerEvent, { type: "response.done" }>, freshId: string): void {
  const j = s.st.judge!;
  const v = parseJudgeDone(ev);
  setLatency(s, (t) => ({ ...t, verdict: v.verdict, verdictAt: s.now }));
  const turn = s.st.turn;
  s.set({ judge: { ...j, verdict: v.verdict, valid: v.valid, verdictAt: s.now, fastOId: freshId }, turn: turn !== null && turn.turnId === j.turnId ? { ...turn, verdict: v.verdict } : turn });
  // R3.4: once held, a later verdict changes nothing.
  if (!JUDGE_PHASES.includes(s.st.phase) || turn?.turnId !== j.turnId) return;
  s.disarm("judge");
  // R3.3: H, U or no valid letter: the speculative reply is cancelled and never resumes.
  if (!(v.valid && v.verdict === "O")) return holdForSlowPath(s, null);
  // R5.1: with noteWaiting, the server's Permit and its note decide.
  if (s.st.phase === "JUDGING") return holdForSlowPath(s, "noteWaiting");
  tryFastO(s);
}

/** R3.1, R4: a valid O and every fastO condition: the browser issues the Permit and checks it like any other. */
function tryFastO(s: Step): void {
  const st = s.st;
  const j = st.judge;
  const spec = st.spec;
  const turn = st.turn;
  if (j === null || j.verdict === null || turn === null || st.session === null || st.deck === null || st.pending !== null) return;
  const problem = fastOProblem({
    now: s.now,
    t0: turn.tEnd,
    judgeDeadlineMs: JUDGE_LIMIT_MS,
    turnId: turn.turnId,
    generation: st.session.generation,
    judge: { turnId: j.turnId, generation: st.session.generation, valid: j.valid, verdict: j.verdict },
    ack: st.ack,
    ackDroppedStale: st.ackDroppedStale,
    deck: st.deck,
    // Only another Turn's post refuses: this Turn's own post doesn't (review of wave A, item 1).
    outstanding: st.outstanding.filter((o) => o.deadline > s.now && o.turnId !== turn.turnId).length,
  });
  if (problem !== null || spec === null) return holdForSlowPath(s, problem ?? "hash");
  // A speculative payload whose hash failed can't back a fastO Permit: the slow path decides (item 13).
  if (spec.failed === true && spec.hash === null) return holdForSlowPath(s, "hash");
  // The hash of the speculative payload is not back yet: issue when it is (specHashed).
  if (spec.hash === null) return;
  const stamp = localStamp(st)!;
  const permit = issueFastO({ permitId: j.fastOId ?? spec.eventId, stamp, hash: spec.hash, now: s.now });
  setLatency(s, (t) => ({ ...t, permitAt: s.now }));
  requestVerify(s, { permit, purpose: "speech", notes: [], toolCall: null, toolOutput: null });
}

function onSpecHashed(s: Step, eventId: string, hash: string): void {
  const spec = s.st.spec;
  if (spec === null || spec.eventId !== eventId) return;
  // A hash that failed to compute is "", and "" never matches anything: the speculative reply can't be admitted
  // as is, and a valid O creates the reply fresh (review of wave A, item 13).
  if (hash === "") {
    s.set({ spec: { ...spec, hash: null, failed: true } });
    const jj = s.st.judge;
    if (s.st.phase === "SPECULATING" && jj !== null && jj.valid && jj.verdict === "O") tryFastO(s);
    return;
  }
  s.set({ spec: { ...spec, hash } });
  const j = s.st.judge;
  if (s.st.phase === "SPECULATING" && j !== null && j.valid && j.verdict === "O") tryFastO(s);
}

function onPermitChecked(s: Step, permitId: string, hash: string): void {
  const reply = s.st.pending;
  if (reply === null || reply.permit.permitId !== permitId) return;
  const phaseOk = reply.purpose === "recovery" ? s.st.phase === "RECOVERY" : (["HELD", "SPECULATING", "JUDGING"] as VoicePhase[]).includes(s.st.phase);
  const problem = phaseOk ? permitProblem(s.st, reply, hash, s.now, false) : "stamp";
  if (problem !== null) {
    if (reply.permit.kind === "fastO") {
      s.set({ pending: null });
      return holdForSlowPath(s, problem === "hash" ? "hash" : "ack");
    }
    return rejectReply(s);
  }
  admit(s, reply);
}

/** A checked Permit admits its reply. The speculative reply plays itself if it has made no sound yet (R3.1, R3.2). */
function admit(s: Step, reply: PendingReply): void {
  const st = s.st;
  const turnId = reply.permit.stamp.turnId;
  s.disarm("permit", "turnRetry");
  cancelJudge(s);
  const maxSeq = Math.max(0, ...(st.turn?.items.map((i) => i.commitSeq ?? 0) ?? []));
  s.set({ pending: null, admittedTurnId: turnId, unadmitted: s.st.unadmitted.filter((f) => f.commitSeq > maxSeq) });
  const spec = s.st.spec;
  const fastO = reply.permit.kind === "fastO";
  const fits = spec !== null && spec.turnId === turnId && !spec.failed && reply.purpose === "speech" && reply.permit.scope === "reply" && reply.notes.length === 0 && reply.toolOutput === null && spec.hash === reply.permit.approvedPayloadHash;
  const phase: VoicePhase = s.st.phase === "RECOVERY" ? "RECOVERY" : "HELD";
  // Stray audio since the last clear rules out the "fits" branch: clear and regenerate instead (review item 12).
  if (fits && !spec.mutedStarted && (!spec.done || spec.heldCall !== null) && s.st.strayAudio !== true) {
    const active: ActiveReply = { ...reply, responseId: spec.responseId, audioStarted: false, pendingTool: null, eventId: spec.eventId };
    s.set({ spec: null, phase, active });
    setLatency(s, (t) => ({ ...t, path: fastO ? "fastO" : "slow" }));
    if (spec.responseId !== null) {
      replyKnown(s, active);
      if (spec.heldCall !== null) dispatchTool(s, s.st.active!, spec.heldCall);
    }
  } else {
    if (spec !== null) {
      // The muted reply already made sound: cancel, clear and regenerate; no suffix is heard (R3.2).
      if (spec.responseId !== null) s.send({ type: "response.cancel", response_id: spec.responseId });
      s.send({ type: "output_audio_buffer.clear" });
      s.set({ spec: null, inFlight: s.st.inFlight.filter((id) => id !== spec.responseId) });
    }
    // Stray audio since the last clear is cleared before the reply is created: no suffix of it is heard (R3.2).
    if (s.st.strayAudio === true) s.send({ type: "output_audio_buffer.clear" });
    const eventId = nextEventId(s, "speech", turnId);
    s.send(replyCreate(s.st, reply, eventId));
    s.set({ phase, active: { ...reply, responseId: null, audioStarted: false, pendingTool: null, eventId } });
    setLatency(s, (t) => ({ ...t, path: reply.purpose === "recovery" ? "recovery" : fastO ? "regenerated" : "slow" }));
  }
  s.arm("speakCap", s.now + SPEAK_CAP_MS);
  // R7.6: a Turn admitted before its transcript waits ADMITTED_TRANSCRIPT_LIMIT_MS for it.
  const turn = s.st.turn;
  if (turn !== null && turn.posted === null && turn.source === "asr" && turn.turnId === turnId) s.arm("transcript", turn.tEnd + ADMITTED_TRANSCRIPT_LIMIT_MS);
}

/** The active reply's response ID is known: it is tracked for receipts, and a fastO admission is reported (R3.7). */
function replyKnown(s: Step, a: ActiveReply): void {
  const id = a.responseId!;
  const recent: VoiceState["recent"] = [...s.st.recent, { responseId: id, stamp: a.permit.stamp, parts: [], done: false }];
  sendHeld(s, recent.slice(0, -MAX_RECENT_RESPONSES));
  s.set({ recent: recent.slice(-MAX_RECENT_RESPONSES), inFlight: s.st.inFlight.includes(id) ? s.st.inFlight : [...s.st.inFlight, id] });
  if (a.permit.kind === "fastO") receipt(s, a, "admitted");
}

/** KV02: a function call of an admitted reply goes to `/api/tool`. */
function dispatchTool(s: Step, a: ActiveReply, call: ToolCallItem): void {
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return;
  }
  // While its lead-in audio plays the reply stays SPEAKING; TOOL_WAIT starts when the audio stops (R6.1).
  s.set({ phase: a.audioStarted ? "SPEAKING" : "TOOL_WAIT", active: { ...a, pendingTool: call } });
  s.push({ kind: "tool", body: { stamp: a.permit.stamp, callId: call.callId, tool: { name: call.name, args } as Infer<typeof ToolRequest>["tool"] } });
  s.arm("tool", s.now + TOOL_LIMIT_MS);
}

function onTool(s: Step, callId: string, res: Infer<typeof ToolResponse>): void {
  const st = s.st;
  const call = st.active?.pendingTool;
  const waiting = st.phase === "TOOL_WAIT" || st.phase === "SPEAKING";
  if (!waiting || call === null || call === undefined || call.callId !== callId || res.callId !== callId) return;
  s.disarm("tool");
  adoptDeck(s, res.deck);
  if (s.st.phase !== "TOOL_WAIT" && s.st.phase !== "SPEAKING") return;
  // R27.10: a stale result asks for no reply. Anything but a ready result with a Permit ends the turn.
  if (res.status !== "ready" || res.result === null || res.permit === null) return toListening(s);
  // A lead-in still playing stops for the answer (R6.1: nothing is heard outside SPEAKING).
  const a = s.st.active!;
  s.mute();
  if (a.audioStarted) {
    s.send({ type: "output_audio_buffer.clear" });
    receipt(s, a, "playbackEnded");
  }
  s.set({ phase: "HELD", active: null });
  requestVerify(s, { permit: res.permit, purpose: "tool", notes: [], toolCall: call, toolOutput: res.result });
}

// ---------------------------------------------------------------------------------------------
// Realtime events

function receipt(s: Step, a: ActiveReply, kind: "admitted" | "playbackStarted" | "playbackEnded" | "cancelled"): void {
  s.push({
    kind: "receipt",
    body: {
      stamp: a.permit.stamp,
      responseId: a.responseId!,
      kind,
      momentIds: a.permit.momentIds,
      noteIds: a.permit.noteIds,
      pendingId: null,
      permitKind: a.permit.kind,
      text: null,
    },
  });
}

const metaGeneration = (meta: Record<string, string> | null | undefined): string | null => meta?.generation ?? null;

function onRealtime(s: Step, ev: RealtimeServerEvent, freshId: string, lastLoudAt: number | null = null): void {
  const st = s.st;
  if (st.session === null || st.phase === "CLOSED" || st.phase === "CONNECTING" || st.phase === "CONFIGURING") return;
  if (st.recovery?.kind === "connection") return;
  const gen = String(st.session.generation);
  switch (ev.type) {
    case "input_audio_buffer.speech_started": {
      // KV04: speech start also drops a posted turn's wait for its Permit, in HELD or waiting for the Neutral_Line
      // in RECOVERY, so a late Permit can't play over the owner (review of wave A, item 4).
      const waiting = st.pending !== null || st.phase === "HELD" || (st.phase === "RECOVERY" && st.recovery?.kind === "line");
      const busy = st.phase === "SPEAKING" || st.phase === "TOOL_WAIT" || st.inFlight.length > 0 || st.active !== null || st.judge !== null || st.spec !== null || waiting;
      if (busy) bargeIn(s);
      if (ev.item_id !== undefined) recordSpeech(s, ev.item_id, { startMs: ev.audio_start_ms ?? null });
      return;
    }
    case "input_audio_buffer.speech_stopped":
      if (ev.item_id !== undefined) recordSpeech(s, ev.item_id, { endMs: ev.audio_end_ms ?? null });
      return;
    case "input_audio_buffer.committed":
      return onCommitted(s, ev.item_id, freshId, lastLoudAt);
    case "conversation.item.added":
      return onItemAdded(s, ev.item.id);
    case "conversation.item.input_audio_transcription.completed": {
      if (onLateTranscript(s, ev.item_id, ev.transcript)) return;
      if (onHeldBackTranscript(s, ev.item_id, ev.transcript)) return;
      const turn = st.turn;
      // A transcript for a Turn already posted `final` is dropped (R15.11).
      if (turn === null || turn.posted !== null || !turn.items.some((i) => i.itemId === ev.item_id)) return;
      s.set({ turn: { ...turn, items: turn.items.map((i) => (i.itemId === ev.item_id ? { ...i, transcript: ev.transcript } : i)) } });
      return maybeAdmit(s);
    }
    case "conversation.item.input_audio_transcription.failed": {
      if (onHeldBackTranscript(s, ev.item_id, null)) return;
      const turn = st.turn;
      if (turn === null || turn.posted !== null || !turn.items.some((i) => i.itemId === ev.item_id)) return;
      return postTurn(s, "failed");
    }
    case "response.created": {
      const meta = ev.response.metadata;
      const eventId = meta?.eventId;
      if (metaGeneration(meta) === gen && eventId !== undefined) {
        // The judge and the speculative reply are matched by the event_id they carry in metadata (question 85).
        const j = st.judge;
        if (j !== null && j.responseId === null && eventId === j.eventId) {
          s.set({ judge: { ...j, responseId: ev.response.id }, inFlight: [...st.inFlight, ev.response.id] });
          return;
        }
        const sp = st.spec;
        if (sp !== null && sp.responseId === null && eventId === sp.eventId) {
          s.set({ spec: { ...sp, responseId: ev.response.id }, inFlight: [...st.inFlight, ev.response.id] });
          return;
        }
      }
      const a = st.active;
      const matches = a !== null && (eventId !== undefined && a.eventId != null ? eventId === a.eventId : meta?.turnId === a.permit.stamp.turnId && meta?.purpose !== "judge" && meta?.purpose !== "speculative");
      const ours = a !== null && a.responseId === null && metaGeneration(meta) === gen && matches;
      if (!ours) {
        // R15.5, R15.7: a response of another Turn or generation is cancelled and changes nothing else.
        s.send({ type: "response.cancel", response_id: ev.response.id });
        return;
      }
      const active = { ...a, responseId: ev.response.id };
      s.set({ active });
      replyKnown(s, active);
      return;
    }
    case "response.done": {
      // One transcript receipt per response, every spoken message in order. The server keeps the first transcript
      // it gets for a response, so sending one per message kept only a preamble ("Okay, let me note that.") and
      // dropped the answer after it (Nov 6 live test).
      const said = st.recent.find((r) => r.responseId === ev.response.id);
      if (said !== undefined && !said.done) {
        s.set({ recent: st.recent.map((r) => (r === said ? { ...r, parts: [], done: true } : r)) });
        sendHeld(s, [said]);
      }
      if (!st.inFlight.includes(ev.response.id) || metaGeneration(ev.response.metadata) !== gen) return;
      s.set({ inFlight: st.inFlight.filter((id) => id !== ev.response.id) });
      if (st.judge !== null && st.judge.responseId === ev.response.id) return onJudgeDone(s, ev, freshId);
      if (st.spec !== null && st.spec.responseId === ev.response.id) {
        s.set({ spec: { ...st.spec, done: true } });
        return;
      }
      const a = s.st.active;
      // A reply that ended with no audio and no tool call: nothing will play.
      if (a !== null && a.responseId === ev.response.id && !a.audioStarted && a.pendingTool === null) {
        if (s.st.phase === "RECOVERY") toListening(s);
        else if (s.st.phase === "HELD") toListening(s);
      }
      return;
    }
    case "output_audio_buffer.started": {
      const sp = st.spec;
      if (sp !== null && sp.responseId === ev.response_id) {
        // The speculative reply's audio, still unadmitted: it stays muted (R2.4).
        if (!sp.mutedStarted) {
          s.set({ spec: { ...sp, mutedStarted: true } });
          setLatency(s, (t) => (t.firstMuted === null ? { ...t, firstMuted: s.now } : t));
        }
        return;
      }
      const a = st.active;
      if (a === null || a.responseId !== ev.response_id) {
        // Audio of a response this call doesn't own (ended, superseded or unknown): cancelled, and it stays muted.
        if (a?.responseId !== ev.response_id) {
          s.send({ type: "response.cancel", response_id: ev.response_id });
          s.set({ strayAudio: true });
        }
        return;
      }
      if (a.audioStarted) return;
      // Re-check at unmute (R15.3, R17.2): Stamp, generation and expiry still hold.
      if (permitProblem(st, a, null, s.now, false) !== null) {
        s.mute();
        s.send({ type: "response.cancel", response_id: ev.response_id });
        s.send({ type: "output_audio_buffer.clear" });
        s.set({ inFlight: st.inFlight.filter((id) => id !== ev.response_id), active: null });
        toListening(s);
        return;
      }
      s.disarm("lineDone");
      s.push({ kind: "unmuteOutput" });
      const active = { ...a, audioStarted: true };
      s.set({ phase: "SPEAKING", outputMuted: false, active });
      s.arm("speakCap", s.now + SPEAK_CAP_MS);
      setLatency(s, (t) => (t.audible === null ? { ...t, audible: s.now } : t));
      receipt(s, active, "playbackStarted");
      return;
    }
    case "output_audio_buffer.stopped": {
      const a = st.active;
      if (a === null || a.responseId !== ev.response_id || !a.audioStarted) return;
      s.mute();
      receipt(s, a, "playbackEnded");
      if (a.pendingTool !== null) {
        // The spoken lead-in before a recall has ended; the answer is still on its way.
        s.set({ phase: "TOOL_WAIT", active: { ...a, audioStarted: false } });
        return;
      }
      toListening(s);
      return;
    }
    case "response.output_audio_transcript.done": {
      const known = st.recent.find((r) => r.responseId === ev.response_id);
      const text = ev.transcript.trim();
      if (known === undefined || text === "") return;
      // Held until response.done (see `recent`); one that comes after it is sent on its own.
      if (known.done) transcriptReceipt(s, known, text);
      else s.set({ recent: st.recent.map((r) => (r === known ? { ...r, parts: [...r.parts, text].slice(-8) } : r)) });
      return;
    }
    case "response.function_call_arguments.done": {
      if (ev.name !== "recall" && ev.name !== "make_phone_call") return;
      const sp = st.spec;
      if (sp !== null && sp.responseId === ev.response_id) {
        // KV02, R6.3: a call inside an unadmitted speculative reply is held, never dispatched yet.
        s.set({ spec: { ...sp, heldCall: { callId: ev.call_id, name: ev.name, arguments: ev.arguments } } });
        return;
      }
      const a = st.active;
      if (a === null || a.responseId !== ev.response_id || a.purpose === "recovery" || a.permit.scope !== "reply") return;
      // KV02: no tool dispatch without a Permit that still holds.
      if (permitProblem(st, a, null, s.now, false) !== null) return;
      dispatchTool(s, a, { callId: ev.call_id, name: ev.name, arguments: ev.arguments });
      return;
    }
    case "error": {
      // Every error is counted, by the client event it names, for the Debug_Panel: the live check reads the
      // data-channel stop condition from it (R23.1; review of wave A, item 15).
      const named = ev.error.event_id ?? null;
      const kind = named?.startsWith("judge:") ? "judge" : named?.startsWith("spec:") ? "spec" : named?.startsWith("speech:") ? "speech" : "other";
      const c = st.realtimeErrors ?? { n: 0, judge: 0, spec: 0, speech: 0, other: 0, lastCode: null };
      s.set({ realtimeErrors: { ...c, n: c.n + 1, [kind]: c[kind] + 1, lastCode: ev.error.code ?? null } });
      // Question 85: an error names the client event that caused it.
      const eventId = ev.error.event_id ?? null;
      if (eventId === null) return;
      const j = st.judge;
      if (j !== null && j.eventId === eventId) {
        // A refused judge counts as U (contracts §5).
        const turn = st.turn;
        s.set({ judge: { ...j, verdict: "U", valid: false, verdictAt: s.now }, turn: turn !== null && turn.turnId === j.turnId ? { ...turn, verdict: "U" } : turn });
        setLatency(s, (t) => ({ ...t, verdict: "U", verdictAt: s.now }));
        if (JUDGE_PHASES.includes(st.phase)) holdForSlowPath(s, null);
        return;
      }
      const sp = st.spec;
      if (sp !== null && sp.eventId === eventId) s.set({ spec: { ...sp, failed: true } });
      // The admitted reply's own response.create was refused: nothing will play. End it as a failed reply does,
      // in RECOVERY with nothing to play, then listen again (review of wave A, item 14).
      const a = st.active;
      if (a !== null && a.eventId != null && a.eventId === eventId) {
        cancelAll(s, false);
        s.set({ admittedTurnId: null, phase: "RECOVERY", recovery: { kind: "line", since: s.now, attempts: 0 } });
        s.arm("lineDone", s.now + LINE_FALLBACK_MS);
      }
      return;
    }
    default:
      // The wire is open: the Voice_Client hands over any data-channel JSON with a string `type`, so types this union
      // does not list do arrive here. They change nothing, as before. The check is compile-time only: a listed type
      // with no case fails the typecheck. Never throw here.
      ev satisfies never;
      return;
  }
}

/**
 * R7.8: a transcript for a Turn posted `missing`. Once every item of it has a transcript, the Turn is sent again,
 * final, as a superseding post; no reply is spoken for it. Returns true when the transcript was one of these.
 */
function onLateTranscript(s: Step, itemId: string, transcript: string): boolean {
  const live = s.st.missing.filter((m) => m.until > s.now);
  const m = live.find((x) => x.items.some((i) => i.itemId === itemId));
  if (m === undefined) {
    if (live.length !== s.st.missing.length) s.set({ missing: live });
    return false;
  }
  const items = m.items.map((i) => (i.itemId === itemId ? { ...i, transcript } : i));
  if (!items.every((i) => i.transcript !== null)) {
    s.set({ missing: live.map((x) => (x === m ? { ...m, items } : x)) });
    return true;
  }
  s.set({ missing: live.filter((x) => x !== m) });
  const text = items.map((i) => i.transcript ?? "").join(" ").slice(0, 8192);
  const deck = s.st.deck;
  if (text.trim() === "" || deck === null || s.st.session === null) return true;
  const body: TurnBody = {
    ...m.body,
    epoch: deck.epoch,
    policyRev: deck.policyRev,
    bundleRev: deck.bundleRev,
    rulesRev: deck.rulesRev,
    transcript: text,
    transcriptState: "final",
    items: m.body.items.map((i) => ({ ...i, final: true })),
  };
  pushTurn(s, body, m.turnId);
  return true;
}

/** Barge-in (R15.4, KV04): mute before anything else, cancel by ID, clear, listen. */
function bargeIn(s: Step): void {
  cancelAll(s, false);
  const turn = s.st.turn;
  s.disarm("permit", "turnRetry", "tool", "lineDone");
  // An unposted Turn is kept, so the next commit judges all of its fragments (R2.6). Its transcript and item waits
  // end here: it isn't posted from LISTENING, so no Neutral_Line plays mid-sentence (review of wave A, item 8).
  const kept = turn !== null && turn.posted === null ? turn : null;
  if (kept !== null) s.disarm("item", "transcript");
  s.set({ phase: "LISTENING", turn: kept, recovery: null, admittedTurnId: null });
}

function recordSpeech(s: Step, itemId: string, patch: { startMs?: number | null; endMs?: number | null }): void {
  const prior = s.st.speech.find((x) => x.itemId === itemId) ?? { itemId, startMs: null, endMs: null };
  const next = { ...prior, ...patch };
  s.set({ speech: [...s.st.speech.filter((x) => x.itemId !== itemId), next].slice(-MAX_TURN_ITEMS) });
  const turn = s.st.turn;
  if (turn !== null && turn.posted === null && next.startMs !== null && next.endMs !== null) {
    const ms = next.endMs - next.startMs;
    s.set({ turn: { ...turn, items: turn.items.map((i) => (i.itemId === itemId ? { ...i, durationMs: ms } : i)) } });
  }
}

function onCommitted(s: Step, itemId: string, freshId: string, lastLoudAt: number | null): void {
  const st = s.st;
  const phases: VoicePhase[] = ["LISTENING", "WAIT_ITEM", "HELD", "JUDGING", "SPECULATING"];
  if (!phases.includes(st.phase) && !(st.phase === "RECOVERY" && st.recovery?.kind === "line")) return;
  if (st.phase === "RECOVERY") toListening(s);
  // A commit after a reply of this Turn was admitted or sent for checking is new speech: as a barge-in (KV04).
  if (s.st.active !== null || s.st.pending !== null) bargeIn(s);
  // A commit while the judge and speculative reply run grows the Turn: both start again over every fragment (R2.6).
  if (JUDGE_PHASES.includes(s.st.phase)) dropSpeculation(s);
  let turn = s.st.turn;
  // A new Turn starts unless the current one is still collecting items (design "Turn grouping").
  if (turn === null || turn.posted !== null || turn.source !== "asr") {
    turn = { turnId: freshId, source: "asr", text: null, items: [], tEnd: s.now, posted: null, staleRetried: false, verdict: null };
    // The old Turn's waits don't carry over: their handlers don't know which Turn they belong to (review item 5).
    s.disarm("permit", "turnRetry");
  }
  if (turn.items.length >= MAX_TURN_ITEMS || turn.items.some((i) => i.itemId === itemId)) return;
  const sp = s.st.speech.find((x) => x.itemId === itemId);
  const durationMs = sp?.startMs != null && sp.endMs != null ? sp.endMs - sp.startMs : 0;
  turn = { ...turn, tEnd: s.now, verdict: null, items: [...turn.items, { itemId, commitSeq: null, committedAt: s.now, transcript: null, durationMs }] };
  const loud = lastLoudAt ?? s.st.lastLoudAt;
  const cur = s.st.latency.current;
  if (cur !== null && cur.turnId !== turn.turnId) finishLatency(s);
  const base = s.st.latency.current ?? emptyTimes(turn.turnId);
  s.set({ turn, phase: "WAIT_ITEM", pending: null, lastLoudAt: loud, latency: { ...s.st.latency, current: { ...base, commit: s.now, lastLoud: loud } } });
  s.arm("item", s.now + ITEM_WAIT_MS);
  // The transcript wait counts from the last commit: t_end resets when the Turn grows (R7.4).
  s.arm("transcript", s.now + HELD_TRANSCRIPT_LIMIT_MS);
}

function onItemAdded(s: Step, itemId: string): void {
  const turn = s.st.turn;
  if (turn === null || turn.posted !== null) return;
  const item = turn.items.find((i) => i.itemId === itemId);
  if (item === undefined || item.commitSeq !== null) return;
  const commitSeq = s.st.lastCommitSeq + 1;
  const items = turn.items.map((i) => (i.itemId === itemId ? { ...i, commitSeq } : i));
  s.set({ lastCommitSeq: commitSeq, turn: { ...turn, items }, unadmitted: [...s.st.unadmitted, { itemId, commitSeq }] });
  if (s.st.phase === "WAIT_ITEM" && items.every((i) => i.commitSeq !== null)) {
    s.disarm("item");
    startJudge(s);
  }
  maybeAdmit(s);
}

/** KV01, R2.1: at the commit, the judge over every Unadmitted_Fragment and, beside it, the muted speculative reply. */
function startJudge(s: Step): void {
  const st = s.st;
  const turn = st.turn!;
  if (st.deck === null || st.session === null || turn.held === true) {
    s.set({ phase: "HELD" });
    return;
  }
  const fragments = [...st.unadmitted].sort((a, b) => a.commitSeq - b.commitSeq);
  let judge: RealtimeClientEvent;
  try {
    judge = judgeCreate(
      { turnId: turn.turnId, generation: st.session.generation, safeTurns: st.deck.turns.map((t) => ({ role: t.role, text: t.text })), pendingQuestion: null, fragments },
      APP_JUDGE_SETTINGS,
    );
  } catch {
    // More than 8 fragments or 4 safe turns: no fragment is dropped to fit; the slow path decides (R2.7).
    s.set({ phase: "HELD" });
    return;
  }
  const judgeEventId = nextEventId(s, "judge", turn.turnId);
  const deadline = turn.tEnd + JUDGE_LIMIT_MS;
  s.mute();
  s.send(withEventId(judge, judgeEventId));
  s.set({ judge: { turnId: turn.turnId, responseId: null, eventId: judgeEventId, sentAt: s.now, deadline, verdict: null, valid: false, verdictAt: null } });
  s.arm("judge", deadline);
  setLatency(s, (t) => ({ ...t, judgeSent: s.now }));
  if (st.deck.noteWaiting) {
    // Contracts §6 "noteWaiting+O=>HELD/nospeculation" (R2.9, R5.1).
    s.set({ phase: "JUDGING", spec: null });
    return;
  }
  const payload = replyPayload(s.st, { purpose: "speech", notes: [], toolCall: null, toolOutput: null })!;
  const specEventId = nextEventId(s, "spec", turn.turnId);
  s.send(specCreate(s.st, specEventId));
  s.set({ phase: "SPECULATING", spec: { turnId: turn.turnId, responseId: null, eventId: specEventId, payload, hash: null, mutedStarted: false, heldCall: null, done: false, failed: false } });
  s.push({ kind: "hashPayload", eventId: specEventId, payload });
}

function nextEventId(s: Step, kind: "judge" | "spec" | "speech", turnId: string): string {
  const n = s.st.eventSeq + 1;
  s.set({ eventSeq: n });
  return `${kind}:${turnId}:${n}`;
}

/** Cancels the judge and the speculative reply by ID (a later `response.created` for either is cancelled too). */
function dropSpeculation(s: Step): void {
  const { judge, spec } = s.st;
  if (judge === null && spec === null) return;
  s.mute();
  const ids = [judge?.responseId, spec?.responseId].filter((x): x is string => x != null);
  for (const id of ids) s.send({ type: "response.cancel", response_id: id });
  if (spec !== null) s.send({ type: "output_audio_buffer.clear" });
  s.set({ judge: null, spec: null, inFlight: s.st.inFlight.filter((id) => !ids.includes(id)) });
  s.disarm("judge");
}

/** Updates the current Turn's latency times, if any. */
function setLatency(s: Step, f: (t: LatencyTimes) => LatencyTimes): void {
  const cur = s.st.latency.current;
  if (cur !== null) s.set({ latency: { ...s.st.latency, current: f(cur) } });
}

/** Closes the current Turn's latency row (R18.1). */
function finishLatency(s: Step): void {
  const cur = s.st.latency.current;
  if (cur === null) return;
  s.set({ latency: { current: null, rows: cur.commit === null ? s.st.latency.rows : pushRow(s.st.latency.rows, finishRow(cur)) } });
}

/** R15.2: admit only when every item is recorded and has its final transcript. */
function maybeAdmit(s: Step): void {
  const turn = s.st.turn;
  if (turn === null || turn.posted !== null || turn.items.length === 0) return;
  // A voice Turn kept after a barge-in waits in LISTENING for the next commit (review of wave A, item 8).
  if (s.st.phase === "LISTENING" && turn.source === "asr") return;
  if (!turn.items.every((i) => i.commitSeq !== null && i.transcript !== null)) return;
  if (turn.items.every((i) => i.transcript!.trim() === "")) {
    // Nothing was said (noise the VAD committed): no Turn, no clientSeq, keep listening. A reply already playing
    // for it ends properly: cancelled by ID, cleared, its receipt sent (review of wave A, item 9).
    if (s.st.active !== null || s.st.pending !== null || s.st.admittedTurnId === turn.turnId) {
      cancelAll(s, false);
      s.set({ admittedTurnId: null });
    }
    toListening(s);
    return;
  }
  postTurn(s, "final");
}

// ---------------------------------------------------------------------------------------------
// Timers


function onTimer(s: Step, name: TimerName): void {
  const at = s.st.deadlines[name];
  if (at === undefined) return;
  // A tick that arrives early (the browser timer ran ahead of the opsClock) re-arms the same deadline, so it is
  // never lost (review of wave A, item 11).
  if (s.now < at) return s.arm(name, at);
  s.disarm(name);
  const st = s.st;
  switch (name) {
    case "openWait":
      if (st.awaitingOpen) openFailed(s);
      return;
    case "connect":
      if (st.phase === "CONNECTING" && st.session !== null) connectionRecovery(s, true);
      return;
    case "ack":
      // R13.9: no matching StateAck within 1.5 s of session.update: close with error, then RECOVERY.
      if (st.phase === "CONFIGURING") connectionRecovery(s, true);
      return;
    case "item":
      // R15.10, R2.5: committed with no matching item.added within 600 ms: no judge, the slow path.
      if (st.phase === "WAIT_ITEM" && st.turn?.items.some((i) => i.commitSeq === null && i.committedAt + ITEM_WAIT_MS <= s.now)) s.set({ phase: "HELD" });
      return;
    case "transcript": {
      const turn = st.turn;
      // R7.4, R7.6: no transcript by t0 + 2.5 s on a held Turn, or t0 + 5 s on a Turn already admitted.
      const limit = st.admittedTurnId === turn?.turnId ? ADMITTED_TRANSCRIPT_LIMIT_MS : HELD_TRANSCRIPT_LIMIT_MS;
      if (turn !== null && turn.posted === null && turn.source === "asr" && s.now >= turn.tEnd + limit) postTurn(s, "missing");
      return;
    }
    case "heldBack":
      // R7.6: no transcript by t0 + 5 s for a Turn whose admitted reply already ended.
      if (st.heldBack !== null) postHeldBack(s, "missing");
      return;
    case "turnRetry":
      if (st.turn?.posted != null && st.pending === null && st.active === null) pushTurn(s, st.turn.posted);
      return;
    case "permit":
      // R7.5: no answer to the post within 5 s: RECOVERY with nothing to play, then listen again.
      if ((["HELD", "SPECULATING", "JUDGING"] as VoicePhase[]).includes(st.phase) && st.active === null) {
        dropSpeculation(s);
        s.disarm("turnRetry");
        s.set({ phase: "RECOVERY", recovery: { kind: "line", since: s.now, attempts: 0 }, turn: null, pending: null });
        s.arm("lineDone", s.now + LINE_FALLBACK_MS);
      }
      return;
    case "judge":
      // R3.5: no verdict by t0 + 1.2 s: cancel the judge and the speculative reply; the slow path decides.
      if (JUDGE_PHASES.includes(st.phase) && st.judge !== null && st.judge.verdict === null) holdForSlowPath(s, "verdict");
      return;
    case "speakCap":
      // Contracts §6 SPEAKING "45scap": an admitted reply that never started or never ended.
      if (st.active !== null) {
        cancelAll(s, false);
        toListening(s);
      }
      return;
    case "lineDone":
      if (st.phase === "RECOVERY" && st.recovery?.kind === "line" && !(st.active?.audioStarted ?? false)) {
        for (const id of st.inFlight) s.send({ type: "response.cancel", response_id: id });
        s.set({ inFlight: [] });
        toListening(s);
      }
      return;
    case "poll":
      // R4.5: one state request a second while the call is live, never two in flight.
      if (IN_CALL.includes(st.phase) || st.phase === "RECOVERY") {
        if (st.stateSentAt === null || s.now - st.stateSentAt >= STATE_STALE_MS) postState(s);
        s.arm("poll", s.now + POLL_MS);
      }
      return;
    case "refresh":
    case "stateRetry":
      if (IN_CALL.includes(st.phase) || st.phase === "RECOVERY") postState(s);
      return;
    case "stateRetryUi":
      if (st.stateFailures !== null) s.set({ stateRetryVisible: true });
      return;
    case "reconnect":
      if (st.phase === "RECOVERY" && st.recovery?.kind === "connection") reconnect(s);
      return;
    case "retryUi":
      if (st.recovery?.kind === "connection" && st.phase !== "LISTENING") s.set({ retryVisible: true });
      return;
    case "tool":
      // TOOL_WAIT: LISTENING after TOOL_LIMIT_MS (6 s) with no result.
      if (st.phase === "TOOL_WAIT" || (st.phase === "SPEAKING" && st.active?.pendingTool != null)) toListening(s);
      return;
    case "swap":
      // Wave B.
      return;
    default:
      // Compile-time only: a TimerName with no case fails the typecheck. At run time nothing happens.
      name satisfies never;
      return;
  }
}
