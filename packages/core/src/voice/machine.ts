/**
 * Browser call-state reducer (design "Browser state machine"; R13, R15, R16.3, R17.2, R17.3; KV02, KV04, KV05,
 * KV06, KV13). Pure: `step(state, event, now)` returns the next state and the commands the Voice_Client runs, in
 * order. `now` is the browser opsClock in integer milliseconds. Nothing here reads a clock, a random source or the
 * network; IDs a new Turn needs arrive on the event (`freshId`), and hashing is a command (`verifyPermit`) whose
 * answer comes back as the `permitChecked` event.
 *
 * Timers are commands too (`armTimer`). The deadline is also kept in state, and a `timer` event whose deadline is
 * absent or not yet reached is ignored, so a stale timer can never move the machine.
 *
 * Rules that hold in every state:
 *   - output audio is muted unless the phase is SPEAKING under a Permit that passed its checks (KV02);
 *   - Realtime events of another generation are dropped (R15.7);
 *   - a higher stamp cancels and clears every in-flight reply (KV05);
 *   - the mute control only touches the microphone track (R15.6).
 */
import { RECOVERY_LINE, type PayloadInput } from "../admission";
import { type Infer } from "../schema/v";
import { type SS, type StateAck, msFromTs, tsFromMs } from "../schema/primitives";
import type { PermitKind } from "../schema/records";
import {
  type CloseRequest,
  type Deck,
  type OpenResponse,
  type Permit,
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

// ---------------------------------------------------------------------------------------------
// State

export type VoicePhase = "CLOSED" | "CONNECTING" | "CONFIGURING" | "LISTENING" | "WAIT_ITEM" | "HELD" | "SPEAKING" | "TOOL_WAIT" | "RECOVERY";

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
  | "lineDone";

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
}

export type ReplyPurpose = "speech" | "recovery" | "tool";

export interface ToolCallItem {
  callId: string;
  name: "recall";
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
  /** The recall call this reply made, while TOOL_WAIT waits on `/api/tool`. */
  pendingTool: ToolCallItem | null;
}

export interface VoiceConfig {
  /** FRANKI_TRANSCRIBE_MODEL from Model_Config; never a literal in code. */
  transcribeModel: string;
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
  | { type: "response.function_call_arguments.done"; response_id: string; call_id: string; name: string; arguments: string };

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
  | { type: "stateOk"; response: Infer<typeof StateResponse> }
  | { type: "stateFailed" }
  | { type: "turnOk"; turnId: string; response: Infer<typeof TurnResponse> }
  | { type: "turnFailed"; turnId: string }
  | { type: "toolOk"; callId: string; response: Infer<typeof ToolResponse> }
  | { type: "toolFailed"; callId: string }
  | { type: "closeDone" }
  | { type: "closeFailed" }
  /** The Voice_Client's SHA-256 of the canonical payload a `verifyPermit` command named. */
  | { type: "permitChecked"; permitId: string; hash: string }
  /** A typed line sent while a call is live (design "One typed turn" step 4). */
  | { type: "typedSubmitted"; turnId: string; text: string }
  /** `freshId` is a new random ID, used as the turnId if this event starts a Turn. */
  | { type: "realtime"; event: RealtimeServerEvent; freshId: string }
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
  | { kind: "turn"; body: TurnBody }
  | { kind: "tool"; body: Omit<Infer<typeof ToolRequest>, "requestId"> }
  | { kind: "close"; body: Omit<Infer<typeof CloseRequest>, "requestId"> }
  | { kind: "receipt"; body: Omit<Infer<typeof ReceiptRequest>, "requestId"> }
  | { kind: "verifyPermit"; permitId: string; payload: PayloadInput }
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
      tools: [RECALL_TOOL],
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription: { model: transcribeModel, language: TRANSCRIBE_LANGUAGE, prompt: TRANSCRIBE_PROMPT },
          // Semantic end-of-turn: a 300 ms silence cut the Owner off mid-sentence in the Nov 6 live check
          // ("I only heard 'By the way…'"). Responses stay app-created after admission, and barge-in app-handled.
          turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: false, interrupt_response: false },
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

/** The one `response.create` a verified Permit allows (R15.3; contracts §6 Tools). */
export function replyCreate(st: VoiceState, reply: PendingReply): RealtimeClientEvent {
  const deck = st.deck!;
  const turn = st.turn!;
  const metadata = {
    purpose: "speech",
    turnId: reply.permit.stamp.turnId,
    generation: String(st.session!.generation),
    noteIds: reply.permit.noteIds.join(","),
  };
  if (reply.purpose === "recovery") {
    // recoveryOnly: the fixed neutral line, no facts and no tools (contracts §6 Admission).
    return {
      type: "response.create",
      response: { conversation: "none", instructions: `Say exactly this and nothing else: "${RECOVERY_LINE}"`, input: [], tools: [], metadata },
    };
  }
  const notes = reply.notes.length === 0 ? "" : `\n\nNotes:\n${reply.notes.map((n) => `- ${n.text}`).join("\n")}`;
  const input: Record<string, unknown>[] = deck.turns.map(safeTurnInput);
  if (turn.source === "asr") for (const id of audioIds(turn)) input.push({ type: "item_reference", id });
  else input.push({ type: "message", role: "user", content: [{ type: "input_text", text: turn.text ?? "" }] });
  if (reply.toolCall !== null && reply.toolOutput !== null) {
    input.push({ type: "function_call", call_id: reply.toolCall.callId, name: reply.toolCall.name, arguments: reply.toolCall.arguments });
    input.push({ type: "function_call_output", call_id: reply.toolCall.callId, output: JSON.stringify(reply.toolOutput) });
  }
  return {
    type: "response.create",
    response: { conversation: "none", instructions: deck.head.text + notes, input, tools: [RECALL_TOOL], tool_choice: "auto", metadata },
  };
}

// ---------------------------------------------------------------------------------------------
// Pure helpers

const IN_CALL: readonly VoicePhase[] = ["LISTENING", "WAIT_ITEM", "HELD", "SPEAKING", "TOOL_WAIT"];

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

/** R17.2, R13.7, KV13: why a Permit may not play, or null. `hash` is the client's own payload hash. */
export function permitProblem(st: VoiceState, reply: PendingReply, hash: string | null, now: number): PermitProblem | null {
  const stamp = localStamp(st);
  const { permit } = reply;
  if (stamp === null || !sameStamp(permit.stamp, stamp)) return "stamp";
  if (msFromTs(permit.expiresAt) <= now) return "expired";
  if (st.deck === null || msFromTs(st.deck.expiresAt) <= now) return "deckExpired";
  if (!KINDS_FOR[reply.purpose].includes(permit.kind)) return "kind";
  if (permit.kind === "fastO") {
    // KV13 applies to fastO only: a StateAck matching all four revisions, younger than 2.5 s.
    const ack = st.ack;
    if (ack === null || !sameRevs(ack.stamp, st.deck) || now - msFromTs(ack.issuedOpsAt) >= FAST_ACK_AGE_MS) return "ack";
  }
  if (hash !== null && hash !== permit.approvedPayloadHash) return "hash";
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
    case "HELD":
    case "TOOL_WAIT":
      return "thinking";
    case "SPEAKING":
      return "speaking";
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
      onState(s, event.response);
      break;
    case "stateFailed":
      onStateFailed(s);
      break;
    case "turnOk":
      onTurn(s, event.turnId, event.response);
      break;
    case "turnFailed":
      // The client already retried the same requestId; the Session's clientSeq is unknown now, so reconnect,
      // which opens a fresh Session (design "Session timing").
      if (state.turn?.turnId === event.turnId && state.turn.posted !== null && state.session !== null) connectionRecovery(s, true);
      break;
    case "toolOk":
      onTool(s, event.callId, event.response);
      break;
    case "toolFailed":
      if (state.phase === "TOOL_WAIT" && state.active?.pendingTool?.callId === event.callId) toListening(s);
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
    case "typedSubmitted":
      if (state.phase === "LISTENING" && state.session !== null && state.deck !== null && event.text.trim() !== "") {
        s.set({ turn: { turnId: event.turnId, source: "typed", text: event.text, items: [], tEnd: now, posted: null, staleRetried: false } });
        postTurn(s, "final");
      }
      break;
    case "realtime":
      onRealtime(s, event.event, event.freshId);
      break;
    case "timer":
      onTimer(s, event.name);
      break;
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
    micMuted: false,
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
    deadlines: {},
    recovery: { kind: "connection", since, attempts: st.recovery?.kind === "connection" ? st.recovery.attempts : 0 },
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
  for (const id of st.inFlight) s.send({ type: "response.cancel", response_id: id });
  s.send({ type: "output_audio_buffer.clear" });
  const a = st.active;
  if (a !== null && a.responseId !== null) receipt(s, a, a.audioStarted ? "playbackEnded" : "cancelled");
  s.set({ inFlight: [], pending: null, active: null });
  s.disarm("tool", "permit", "turnRetry");
  if (higherStamp && (st.phase === "SPEAKING" || st.phase === "TOOL_WAIT")) {
    // Design table: SPEAKING goes to HELD on a higher revision; no Permit can follow for the old reply.
    s.set({ phase: "HELD" });
    s.arm("permit", s.now + HOLD_LIMIT_MS);
  }
}

function onState(s: Step, res: Infer<typeof StateResponse>): void {
  const st = s.st;
  if (st.session === null || res.stamp.sessionId !== st.session.sessionId) return;
  adoptDeck(s, res.deck);
  if (res.ack !== null && res.ack.stamp.sessionId === st.session.sessionId) s.set({ ack: res.ack });
  s.set({ stateFailures: null, stateRetryVisible: false });
  s.disarm("stateRetry", "stateRetryUi");
  s.arm("refresh", s.now + REFRESH_MS);
  if (s.st.phase === "CONFIGURING" && s.st.ack !== null && s.st.deck !== null && sameRevs(s.st.ack.stamp, s.st.deck)) {
    s.disarm("ack", "connect", "retryUi", "reconnect");
    s.set({ phase: "LISTENING", recovery: null, retryVisible: false });
  }
}

function onStateFailed(s: Step): void {
  const st = s.st;
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

function postTurn(s: Step, transcriptState: "final" | "missing" | "failed"): void {
  const st = s.st;
  const turn = st.turn!;
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
    judge: turn.source === "typed" ? "typed" : "timeout",
    pendingId: null,
    choiceId: null,
    supersedesRequestId: null,
    uiControl: null,
  };
  s.set({ turn: { ...turn, items, posted: body }, nextClientSeq: st.nextClientSeq + 1, lastCommitSeq });
  s.disarm("item", "transcript");
  s.push({ kind: "turn", body });
  if (transcriptState === "final") {
    s.set({ phase: "HELD" });
  } else {
    // R15.11: RECOVERY plays only the neutral line under a recoveryOnly Permit, then listens again.
    s.set({ phase: "RECOVERY", recovery: { kind: "line", since: s.now, attempts: 0 } });
    s.arm("lineDone", s.now + LINE_FALLBACK_MS * 2);
  }
}

function onTurn(s: Step, turnId: string, res: Infer<typeof TurnResponse>): void {
  const st = s.st;
  const turn = st.turn;
  if (turn === null || turn.turnId !== turnId || turn.posted === null || st.session === null) return;
  if (res.stamp.turnId !== turnId || res.stamp.sessionId !== st.session.sessionId || res.stamp.generation !== st.session.generation) return;
  adoptDeck(s, res.deck);
  if (s.st.turn?.turnId !== turnId) return;
  const recovery = s.st.phase === "RECOVERY";
  if (res.error !== null) return noReply(s);
  if (res.status === "stale") {
    // Nothing was recorded; send the same Turn once more with the current revisions.
    if (turn.staleRetried) return noReply(s);
    const body: TurnBody = { ...turn.posted, epoch: res.stamp.epoch, policyRev: res.stamp.policyRev, bundleRev: res.stamp.bundleRev, rulesRev: res.stamp.rulesRev };
    s.set({ turn: { ...turn, posted: body, staleRetried: true } });
    s.push({ kind: "turn", body });
    return;
  }
  if (res.status === "hold") {
    if (res.retryAfterMs > 0) s.arm("turnRetry", s.now + res.retryAfterMs);
    if (recovery) return;
    if (s.st.deadlines.permit === undefined) s.arm("permit", Math.max(s.now, turn.tEnd + HOLD_LIMIT_MS));
    return;
  }
  if (res.permit === null) return noReply(s);
  const reply: Omit<PendingReply, "permit"> = { purpose: recovery ? "recovery" : "speech", notes: res.notes, toolCall: null, toolOutput: null };
  requestVerify(s, { ...reply, permit: res.permit });
}

/** No reply will come for this Turn: listen again (after the recovery screen, if one shows). */
function noReply(s: Step): void {
  s.set({ pending: null });
  if (s.st.phase === "RECOVERY") return; // lineDone returns to LISTENING
  toListening(s);
}

function toListening(s: Step): void {
  s.mute();
  s.disarm("permit", "turnRetry", "tool", "lineDone", "item", "transcript");
  s.set({ phase: "LISTENING", turn: null, pending: null, active: null, recovery: s.st.recovery?.kind === "line" ? null : s.st.recovery });
}

function requestVerify(s: Step, reply: PendingReply): void {
  const payload = replyPayload(s.st, reply);
  // A Permit that already fails a check needs no hash: it never plays (R17.3).
  if (payload === null || permitProblem(s.st, reply, null, s.now) !== null) return rejectReply(s);
  s.set({ pending: reply });
  s.push({ kind: "verifyPermit", permitId: reply.permit.permitId, payload });
}

function rejectReply(s: Step): void {
  // R17.3: play nothing and cancel any pending response of this reply.
  for (const id of s.st.inFlight) s.send({ type: "response.cancel", response_id: id });
  s.set({ inFlight: [], pending: null, active: null });
  noReply(s);
}

function onPermitChecked(s: Step, permitId: string, hash: string): void {
  const reply = s.st.pending;
  if (reply === null || reply.permit.permitId !== permitId) return;
  const expected: VoicePhase = reply.purpose === "recovery" ? "RECOVERY" : "HELD";
  if (s.st.phase !== expected || permitProblem(s.st, reply, hash, s.now) !== null) return rejectReply(s);
  s.disarm("permit", "turnRetry");
  s.send(replyCreate(s.st, reply));
  s.set({ pending: null, active: { ...reply, responseId: null, audioStarted: false, pendingTool: null } });
}

function onTool(s: Step, callId: string, res: Infer<typeof ToolResponse>): void {
  const st = s.st;
  const call = st.active?.pendingTool;
  if (st.phase !== "TOOL_WAIT" || call === null || call === undefined || call.callId !== callId || res.callId !== callId) return;
  s.disarm("tool");
  adoptDeck(s, res.deck);
  if (s.st.phase !== "TOOL_WAIT") return;
  // R27.10: a stale result asks for no reply. Anything but a ready result with a Permit ends the turn.
  if (res.status !== "ready" || res.result === null || res.permit === null) return toListening(s);
  s.set({ phase: "HELD", active: null });
  requestVerify(s, { permit: res.permit, purpose: "tool", notes: [], toolCall: call, toolOutput: res.result });
}

// ---------------------------------------------------------------------------------------------
// Realtime events

function receipt(s: Step, a: ActiveReply, kind: "playbackStarted" | "playbackEnded" | "cancelled"): void {
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

function onRealtime(s: Step, ev: RealtimeServerEvent, freshId: string): void {
  const st = s.st;
  if (st.session === null || st.phase === "CLOSED" || st.phase === "CONNECTING" || st.phase === "CONFIGURING") return;
  if (st.recovery?.kind === "connection") return;
  const gen = String(st.session.generation);
  switch (ev.type) {
    case "input_audio_buffer.speech_started": {
      const busy = st.phase === "SPEAKING" || st.phase === "TOOL_WAIT" || st.inFlight.length > 0 || st.active !== null;
      if (busy) bargeIn(s);
      if (ev.item_id !== undefined) recordSpeech(s, ev.item_id, { startMs: ev.audio_start_ms ?? null });
      return;
    }
    case "input_audio_buffer.speech_stopped":
      if (ev.item_id !== undefined) recordSpeech(s, ev.item_id, { endMs: ev.audio_end_ms ?? null });
      return;
    case "input_audio_buffer.committed":
      return onCommitted(s, ev.item_id, freshId);
    case "conversation.item.added":
      return onItemAdded(s, ev.item.id);
    case "conversation.item.input_audio_transcription.completed": {
      const turn = st.turn;
      // A transcript for a Turn already posted is dropped (R15.11).
      if (turn === null || turn.posted !== null || !turn.items.some((i) => i.itemId === ev.item_id)) return;
      s.set({ turn: { ...turn, items: turn.items.map((i) => (i.itemId === ev.item_id ? { ...i, transcript: ev.transcript } : i)) } });
      return maybeAdmit(s);
    }
    case "conversation.item.input_audio_transcription.failed": {
      const turn = st.turn;
      if (turn === null || turn.posted !== null || !turn.items.some((i) => i.itemId === ev.item_id)) return;
      return postTurn(s, "failed");
    }
    case "response.created": {
      const meta = ev.response.metadata;
      const a = st.active;
      const ours = a !== null && a.responseId === null && metaGeneration(meta) === gen && meta?.turnId === a.permit.stamp.turnId;
      if (!ours) {
        // R15.5, R15.7: a response of another Turn or generation is cancelled and changes nothing else.
        s.send({ type: "response.cancel", response_id: ev.response.id });
        return;
      }
      const recent: VoiceState["recent"] = [...st.recent, { responseId: ev.response.id, stamp: a.permit.stamp, parts: [], done: false }];
      // A response pushed out before its response.done sends what it held now; later events for it find nothing.
      sendHeld(s, recent.slice(0, -MAX_RECENT_RESPONSES));
      s.set({ active: { ...a, responseId: ev.response.id }, inFlight: [...st.inFlight, ev.response.id], recent: recent.slice(-MAX_RECENT_RESPONSES) });
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
      const a = s.st.active;
      // A reply that ended with no audio and no tool call: nothing will play.
      if (a !== null && a.responseId === ev.response.id && !a.audioStarted && a.pendingTool === null) {
        if (s.st.phase === "RECOVERY") toListening(s);
        else if (s.st.phase === "HELD") toListening(s);
      }
      return;
    }
    case "output_audio_buffer.started": {
      const a = st.active;
      if (a === null || a.responseId !== ev.response_id || a.audioStarted) return;
      // Re-check at unmute (R15.3, R17.2): Stamp, generation and expiry still hold.
      if (permitProblem(st, a, null, s.now) !== null) {
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
      receipt(s, active, "playbackStarted");
      return;
    }
    case "output_audio_buffer.stopped": {
      const a = st.active;
      if (a === null || a.responseId !== ev.response_id || !a.audioStarted) return;
      s.mute();
      receipt(s, a, "playbackEnded");
      if (st.phase === "TOOL_WAIT") {
        s.set({ active: { ...a, audioStarted: false } });
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
      const a = st.active;
      if (a === null || a.responseId !== ev.response_id || ev.name !== "recall" || a.purpose === "recovery") return;
      // KV02: no tool dispatch without a Permit that still holds.
      if (permitProblem(st, a, null, s.now) !== null) return;
      let args: unknown;
      try {
        args = JSON.parse(ev.arguments);
      } catch {
        return;
      }
      const call: ToolCallItem = { callId: ev.call_id, name: "recall", arguments: ev.arguments };
      s.set({ phase: "TOOL_WAIT", active: { ...a, pendingTool: call } });
      s.push({ kind: "tool", body: { stamp: a.permit.stamp, callId: ev.call_id, tool: { name: "recall", args } as Infer<typeof ToolRequest>["tool"] } });
      s.arm("tool", s.now + TOOL_LIMIT_MS);
      return;
    }
  }
}

/** Barge-in (R15.4, KV04): mute before anything else, cancel by ID, clear, listen. */
function bargeIn(s: Step): void {
  cancelAll(s, false);
  const turn = s.st.turn;
  s.disarm("permit", "turnRetry", "tool", "lineDone");
  s.set({ phase: "LISTENING", turn: turn !== null && turn.posted === null ? turn : null, recovery: null });
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

function onCommitted(s: Step, itemId: string, freshId: string): void {
  const st = s.st;
  if (!(["LISTENING", "WAIT_ITEM", "HELD"] as VoicePhase[]).includes(st.phase) && !(st.phase === "RECOVERY" && st.recovery?.kind === "line")) return;
  if (st.phase === "RECOVERY") toListening(s);
  let turn = s.st.turn;
  // A new Turn starts unless the current one is still collecting items (design "Turn grouping").
  if (turn === null || turn.posted !== null || turn.source !== "asr") {
    turn = { turnId: freshId, source: "asr", text: null, items: [], tEnd: s.now, posted: null, staleRetried: false };
  }
  if (turn.items.length >= MAX_TURN_ITEMS || turn.items.some((i) => i.itemId === itemId)) return;
  const sp = s.st.speech.find((x) => x.itemId === itemId);
  const durationMs = sp?.startMs != null && sp.endMs != null ? sp.endMs - sp.startMs : 0;
  turn = { ...turn, tEnd: s.now, items: [...turn.items, { itemId, commitSeq: null, committedAt: s.now, transcript: null, durationMs }] };
  s.set({ turn, phase: "WAIT_ITEM", pending: null });
  s.arm("item", s.now + ITEM_WAIT_MS);
  // The transcript wait counts from the last commit: t_end resets when the Turn grows.
  s.arm("transcript", s.now + TRANSCRIPT_WAIT_MS);
}

function onItemAdded(s: Step, itemId: string): void {
  const turn = s.st.turn;
  if (turn === null || turn.posted !== null) return;
  const item = turn.items.find((i) => i.itemId === itemId);
  if (item === undefined || item.commitSeq !== null) return;
  const commitSeq = s.st.lastCommitSeq + 1;
  const items = turn.items.map((i) => (i.itemId === itemId ? { ...i, commitSeq } : i));
  s.set({ lastCommitSeq: commitSeq, turn: { ...turn, items } });
  if (s.st.phase === "WAIT_ITEM" && items.every((i) => i.commitSeq !== null)) {
    s.disarm("item");
    s.set({ phase: "HELD" });
  }
  maybeAdmit(s);
}

/** R15.2: admit only when every item is recorded and has its final transcript. */
function maybeAdmit(s: Step): void {
  const turn = s.st.turn;
  if (turn === null || turn.posted !== null || turn.items.length === 0) return;
  if (!turn.items.every((i) => i.commitSeq !== null && i.transcript !== null)) return;
  if (turn.items.every((i) => i.transcript!.trim() === "")) {
    // Nothing was said (noise the VAD committed): no Turn, no clientSeq, keep listening.
    toListening(s);
    return;
  }
  postTurn(s, "final");
}

// ---------------------------------------------------------------------------------------------
// Timers

function onTimer(s: Step, name: TimerName): void {
  const at = s.st.deadlines[name];
  if (at === undefined || s.now < at) return;
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
      // R15.10: committed with no matching item.added within 600 ms.
      if (st.phase === "WAIT_ITEM" && st.turn?.items.some((i) => i.commitSeq === null && i.committedAt + ITEM_WAIT_MS <= s.now)) s.set({ phase: "HELD" });
      return;
    case "transcript": {
      const turn = st.turn;
      // R15.11: any item still missing item.added or its transcript at t_end + 1.5 s.
      if (turn !== null && turn.posted === null && turn.source === "asr" && s.now >= turn.tEnd + TRANSCRIPT_WAIT_MS) postTurn(s, "missing");
      return;
    }
    case "turnRetry":
      if (st.turn?.posted != null && st.pending === null && st.active === null) s.push({ kind: "turn", body: st.turn.posted });
      return;
    case "permit":
      // Held past 2.5 s with no Permit: RECOVERY with nothing to play, then listen again.
      if (st.phase === "HELD" && st.active === null && st.pending === null) {
        s.disarm("turnRetry");
        s.set({ phase: "RECOVERY", recovery: { kind: "line", since: s.now, attempts: 0 }, turn: null });
        s.arm("lineDone", s.now + LINE_FALLBACK_MS);
      }
      return;
    case "lineDone":
      if (st.phase === "RECOVERY" && st.recovery?.kind === "line" && !(st.active?.audioStarted ?? false)) {
        for (const id of st.inFlight) s.send({ type: "response.cancel", response_id: id });
        s.set({ inFlight: [] });
        toListening(s);
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
      if (st.phase === "TOOL_WAIT") toListening(s);
      return;
  }
}
