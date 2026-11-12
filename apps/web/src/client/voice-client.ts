/**
 * The Voice_Client (R13, R14.1, R14.8, R15, R16, R21.1, R21.2, R21.7, R27.8; design "Call setup", "One voice turn").
 * It owns the RTCPeerConnection, the `oai-events` data channel, the microphone track and the output audio element,
 * and runs the commands of the pure call-state reducer in `@franki/core` (`step`). Every decision about what may
 * play is the reducer's; this file only performs I/O and feeds results back as events.
 *
 * Audio flows directly between the browser and OpenAI over WebRTC. The server sees only the SDP exchange
 * (`/api/session/sdp`) and hangups. The browser never holds an OpenAI credential (R12.6).
 */
import {
  LATENCY_SAMPLE_MS,
  LOUD_LEVEL,
  OpenResponse,
  type RealtimeServerEvent,
  ReceiptResponse,
  SdpResponse,
  TOOL_LIMIT_MS,
  TURN_RESPONSE_LIMIT_MS,
  StateResponse,
  ToolResponse,
  TurnResponse,
  type VoiceCommand,
  type VoiceEvent,
  type VoiceState,
  initialVoiceState,
  msFromTs,
  step,
  validate,
  type Infer,
  type Schema,
} from "@franki/core";
import type { ApiClient, ApiResult } from "./api";
import type { BrowserClock } from "./clock";
import { permitPayloadHash } from "./hash";
import { randomId } from "./ids";

export const OPEN_TIMEOUT_MS = 5_000;
export const SDP_TIMEOUT_MS = 5_000;
export const STATE_TIMEOUT_MS = 1_500;
/** The whole /api/turn budget, retries included: the machine's TURN_RESPONSE_LIMIT_MS (voice-control R7.5). */
export const TURN_TIMEOUT_MS = TURN_RESPONSE_LIMIT_MS;
export const TOOL_TIMEOUT_MS = TOOL_LIMIT_MS;
export const CLOSE_TIMEOUT_MS = 1_500;
export const RECEIPT_TIMEOUT_MS = 1_500;
export const RECEIPT_RETRY_MS = [1_000, 2_000, 5_000] as const;
export const RECEIPT_RETRY_WINDOW_MS = 60_000;
export const SIGN_OUT_LIMIT_MS = 5_000;
const TURN_TRANSIENT_RETRIES = 2;

// ---------------------------------------------------------------------------------------------
// Narrow WebRTC and media shapes, so tests can pass fakes

export interface TrackLike {
  enabled: boolean;
  stop(): void;
}
export interface StreamLike {
  getAudioTracks(): TrackLike[];
}
export interface ChannelLike {
  readonly readyState: string;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
export interface PeerLike {
  readonly connectionState: string;
  addTrack(track: TrackLike, stream: StreamLike): unknown;
  createDataChannel(label: string): ChannelLike;
  createOffer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(d: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(d: { type: "answer"; sdp: string }): Promise<void>;
  close(): void;
  onconnectionstatechange: ((ev: unknown) => void) | null;
  ontrack: ((ev: { streams: readonly unknown[] }) => void) | null;
}
/**
 * The output audio element. `muted` is the only gate on what the Owner hears, written only by the reducer's
 * `muteOutput` and `unmuteOutput` commands; `srcObject` follows the remote track. Nothing reads the element back:
 * there is no `play()`, `paused` or playback event here. So two things are taken, not observed:
 *   - heard: the reducer unmutes when the Realtime server reports `output_audio_buffer.started` for an admitted
 *     reply, and while unmuted the audio is taken as heard; a paused or blocked element, the volume and the speakers
 *     are never checked;
 *   - said: the text of a transcript receipt is the response's output audio transcript from the Realtime server,
 *     not a reading of the audio that played, so it can hold more than was heard before a barge-in.
 */
export interface AudioLike {
  muted: boolean;
  srcObject: unknown;
}
export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface VoiceClientDeps {
  api: ApiClient;
  clock: BrowserClock;
  createPeer: () => PeerLike;
  getMicrophone: () => Promise<StreamLike>;
  audio: AudioLike;
  /** FRANKI_TRANSCRIBE_MODEL, inlined at build from apphosting.yaml (R13.1). */
  transcribeModel: string;
  newId?: () => string;
  timers?: TimerApi;
  hash?: typeof permitPayloadHash;
  /** Told when the mic or remote stream appears or goes away. For the Level_Meter only; never changes call behavior. */
  onStreams?: (s: { mic: StreamLike | null; output: unknown | null }) => void;
  /**
   * The microphone's unsmoothed level (0..1, the Level_Meter's `rawLevel`), read every LATENCY_SAMPLE_MS while a
   * call is connected. The last opsClock time it reached LOUD_LEVEL goes with each commit to the Latency_Clock
   * (voice-control R18.5). Never changes call behavior.
   */
  inputLevel?: () => number;
}

const liveTimers: TimerApi = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

function parsed<T>(schema: Schema<T>, r: ApiResult<unknown>): T | null {
  if (!r.ok) return null;
  const v = validate(schema, r.body);
  return v.ok ? v.value : null;
}

export class VoiceClient {
  private state: VoiceState;
  private readonly listeners = new Set<() => void>();
  private readonly newId: () => string;
  private readonly timers: TimerApi;
  private readonly hash: typeof permitPayloadHash;
  private readonly armed = new Map<string, unknown>();
  /** requestId per turnId, so a re-post of the same Turn is the same request (R19.3). */
  private readonly turnRequestIds = new Map<string, string>();
  private mic: StreamLike | null = null;
  private peer: PeerLike | null = null;
  private channel: ChannelLike | null = null;
  /** Bumped on teardown, so callbacks of an old connection do nothing. */
  private connection = 0;
  private pendingClose: Promise<void> | null = null;
  /** Last remote stream reported to `onStreams`. */
  private remoteStream: unknown | null = null;
  /** The last opsClock time the mic level reached LOUD_LEVEL (R18.5). */
  private lastLoudAt: number | null = null;

  constructor(private readonly deps: VoiceClientDeps) {
    this.state = initialVoiceState({ transcribeModel: deps.transcribeModel }, deps.clock.read().worldClock.zone);
    this.newId = deps.newId ?? (() => randomId());
    this.timers = deps.timers ?? liveTimers;
    this.hash = deps.hash ?? permitPayloadHash;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VoiceState => this.state;

  // Owner actions ------------------------------------------------------------------------------

  call(): void {
    this.dispatch({ type: "callPressed", zone: this.deps.clock.read().worldClock.zone });
  }
  hangUp(): void {
    this.dispatch({ type: "hangupPressed" });
  }
  toggleMute(): void {
    this.dispatch({ type: "mutePressed" });
  }
  retry(): void {
    this.dispatch({ type: "retryPressed" });
  }
  /** A typed line while the call is live: the reply follows the voice path (design "One typed turn" step 4). */
  sendTyped(text: string): boolean {
    if (this.state.phase !== "LISTENING") return false;
    this.dispatch({ type: "typedSubmitted", turnId: this.newId(), text });
    return true;
  }
  get inCall(): boolean {
    return this.state.phase !== "CLOSED";
  }

  /**
   * Sign-out (R9.5, R9.8): hang up any open call, then wait for `/api/session/close` for at most 5 s. The
   * microphone and the peer connection are released locally first, whatever the server does.
   */
  async signOut(): Promise<void> {
    if (this.state.phase !== "CLOSED") this.hangUp();
    const close = this.pendingClose;
    if (close === null) return;
    await new Promise<void>((resolve) => {
      const t = this.timers.setTimeout(resolve, SIGN_OUT_LIMIT_MS);
      void close.then(() => {
        this.timers.clearTimeout(t);
        resolve();
      });
    });
  }

  // The reducer loop ---------------------------------------------------------------------------

  dispatch(event: VoiceEvent): void {
    const r = step(this.state, event, this.deps.clock.read().opsClock.now);
    this.state = r.state;
    for (const l of this.listeners) l();
    for (const c of r.commands) this.run(c);
  }

  private run(c: VoiceCommand): void {
    switch (c.kind) {
      case "muteOutput":
        this.deps.audio.muted = true;
        return;
      case "unmuteOutput":
        this.deps.audio.muted = false;
        return;
      case "setMic":
        // Mute touches only the outgoing microphone track (R15.6, R15.9).
        for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = c.enabled;
        return;
      case "connect":
        void this.connect(c.sessionId, c.generation);
        return;
      case "teardown":
        this.teardown();
        return;
      case "send":
        if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(c.event));
        return;
      case "open":
        void this.postOpen(c.body);
        return;
      case "state": {
        // `sentAt` dates the StateAck: one requested before the last turn answer can't grant fastO (R4.4).
        const sentAt = this.deps.clock.read().opsClock.now;
        void this.post("/api/session/state", c.body, STATE_TIMEOUT_MS, StateResponse).then((res) =>
          this.dispatch(res === null ? { type: "stateFailed" } : { type: "stateOk", response: res, sentAt }),
        );
        return;
      }
      case "turn":
        void this.postTurn(c.body, c.supersedesTurnId ?? null);
        return;
      case "tool":
        void this.post("/api/tool", { requestId: this.newId(), ...c.body }, TOOL_TIMEOUT_MS, ToolResponse).then((res) =>
          this.dispatch(res === null ? { type: "toolFailed", callId: c.body.callId } : { type: "toolOk", callId: c.body.callId, response: res }),
        );
        return;
      case "close": {
        const done = this.deps.api
          .call("/api/session/close", { body: { requestId: this.newId(), ...c.body }, timeoutMs: CLOSE_TIMEOUT_MS })
          .then((r) => this.dispatch(r.ok ? { type: "closeDone" } : { type: "closeFailed" }));
        const tracked: Promise<void> = done.finally(() => {
          if (this.pendingClose === tracked) this.pendingClose = null;
        });
        this.pendingClose = tracked;
        return;
      }
      case "receipt":
        void this.sendReceipt({ requestId: this.newId(), ...c.body });
        return;
      case "verifyPermit":
        void this.hash(c.payload).then(
          (hash) => this.dispatch({ type: "permitChecked", permitId: c.permitId, hash }),
          () => this.dispatch({ type: "permitChecked", permitId: c.permitId, hash: "" }),
        );
        return;
      case "hashPayload":
        // The speculative reply's payload hash, checked against the server's at a fastO or slowOrdinary admission.
        void this.hash(c.payload).then(
          (hash) => this.dispatch({ type: "specHashed", eventId: c.eventId, hash }),
          () => this.dispatch({ type: "specHashed", eventId: c.eventId, hash: "" }),
        );
        return;
      case "armTimer": {
        const prior = this.armed.get(c.name);
        if (prior !== undefined) this.timers.clearTimeout(prior);
        const delay = Math.max(0, c.at - this.deps.clock.read().opsClock.now);
        this.armed.set(
          c.name,
          this.timers.setTimeout(() => {
            this.armed.delete(c.name);
            this.dispatch({ type: "timer", name: c.name });
          }, delay),
        );
        return;
      }
    }
  }

  // Routes ---------------------------------------------------------------------------------------

  private async post<T>(path: string, body: unknown, timeoutMs: number, schema: Schema<T>): Promise<T | null> {
    return parsed(schema, await this.deps.api.call<unknown>(path, { body, timeoutMs }));
  }

  private async postOpen(body: Extract<VoiceCommand, { kind: "open" }>["body"]): Promise<void> {
    const sentAt = this.deps.clock.mono();
    const r = await this.deps.api.call<unknown>("/api/session/open", { body: { requestId: this.newId(), ...body }, timeoutMs: OPEN_TIMEOUT_MS });
    const res = parsed(OpenResponse, r) as Infer<typeof OpenResponse> | null;
    if (res === null) return this.dispatch({ type: "openFailed" });
    if (res.deck !== null) this.deps.clock.syncToServer(msFromTs(res.deck.issuedAt), sentAt, this.deps.clock.mono());
    this.dispatch({ type: "openOk", response: res });
  }

  private async postTurn(body: Extract<VoiceCommand, { kind: "turn" }>["body"], supersedesTurnId: string | null): Promise<void> {
    // A Superseding_Post is a new request for the same Turn, naming the request that posted it `missing` (R7.8).
    const key = supersedesTurnId === null ? body.turnId : `supersede:${supersedesTurnId}`;
    let requestId = this.turnRequestIds.get(key);
    if (requestId === undefined) {
      requestId = this.newId();
      this.turnRequestIds.set(key, requestId);
    }
    const supersedesRequestId = supersedesTurnId === null ? body.supersedesRequestId : (this.turnRequestIds.get(supersedesTurnId) ?? null);
    if (supersedesTurnId !== null && supersedesRequestId === null) return this.dispatch({ type: "turnFailed", turnId: body.turnId });
    // Every attempt and every wait fits inside one TURN_TIMEOUT_MS from the first send (R7.5).
    const start = this.deps.clock.mono();
    const left = () => TURN_TIMEOUT_MS - (this.deps.clock.mono() - start);
    for (let attempt = 0; ; attempt++) {
      const r = await this.deps.api.call<unknown>("/api/turn", { body: { ...body, requestId, supersedesRequestId }, timeoutMs: Math.max(1, left()) });
      const res = parsed(TurnResponse, r);
      // A Superseding_Post that arrived before its `missing` post completed answers a retryable hold: resend it
      // inside the same budget. The machine sees only the final answer (review of wave A, item 19).
      if (res !== null && supersedesTurnId !== null && res.status === "hold" && res.permit === null && res.retryAfterMs > 0 && left() - res.retryAfterMs > 0) {
        await this.sleep(res.retryAfterMs);
        continue;
      }
      if (res !== null) return this.dispatch({ type: "turnOk", turnId: body.turnId, response: res });
      // Same requestId on a transient failure: a request the server did commit is replayed, not written twice.
      const transient = !r.ok && (r.kind === "timeout" || r.kind === "network" || (r.kind === "http" && r.retryAfterMs > 0));
      const wait = !r.ok && r.kind === "http" ? Math.min(5_000, r.retryAfterMs) : 250;
      if (!transient || attempt >= TURN_TRANSIENT_RETRIES || left() - wait <= 0) return this.dispatch({ type: "turnFailed", turnId: body.turnId });
      await this.sleep(wait);
    }
  }

  /** R21.7: resend the identical body until accepted or refused, at most 60 s after the first send. */
  private async sendReceipt(body: { requestId: string } & Extract<VoiceCommand, { kind: "receipt" }>["body"]): Promise<void> {
    const start = this.deps.clock.mono();
    for (let attempt = 0; ; attempt++) {
      const r = await this.deps.api.call<unknown>("/api/receipt", { body, timeoutMs: RECEIPT_TIMEOUT_MS });
      if (parsed(ReceiptResponse, r) !== null) return; // accepted:true or accepted:false; neither is retried
      if (r.ok || (r.kind === "http" && r.retryAfterMs === 0) || r.kind === "signedOut") return;
      const wait = r.kind === "http" ? Math.min(5_000, r.retryAfterMs) : (RECEIPT_RETRY_MS[attempt] ?? RECEIPT_RETRY_MS[RECEIPT_RETRY_MS.length - 1]!);
      if (this.deps.clock.mono() - start + wait >= RECEIPT_RETRY_WINDOW_MS) return;
      await this.sleep(wait);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.timers.setTimeout(resolve, ms));
  }

  // WebRTC ---------------------------------------------------------------------------------------

  private async connect(sessionId: string, generation: number): Promise<void> {
    const id = ++this.connection;
    const live = () => id === this.connection;
    try {
      const mic = this.mic ?? (await this.deps.getMicrophone());
      if (!live()) return mic.getAudioTracks().forEach((t) => t.stop());
      this.mic = mic;
      this.reportStreams();
      this.sampleLevels(live);
      for (const t of mic.getAudioTracks()) t.enabled = !this.state.micMuted;
      const pc = this.deps.createPeer();
      this.peer = pc;
      pc.ontrack = (ev) => {
        if (!live()) return;
        this.deps.audio.srcObject = ev.streams[0] ?? null;
        this.remoteStream = ev.streams[0] ?? null;
        this.reportStreams();
      };
      pc.onconnectionstatechange = () => {
        if (live() && pc.connectionState === "failed") this.dispatch({ type: "connectionLost" });
      };
      for (const t of mic.getAudioTracks()) pc.addTrack(t, mic);
      const dc = pc.createDataChannel("oai-events");
      this.channel = dc;
      dc.onopen = () => {
        if (live()) this.dispatch({ type: "channelOpen" });
      };
      dc.onclose = () => {
        // A close without an Owner hang-up (R15.8); teardown bumps `connection` first, so it is silent then.
        if (live()) this.dispatch({ type: "connectionLost" });
      };
      dc.onmessage = (ev) => {
        if (!live() || typeof ev.data !== "string") return;
        let event: RealtimeServerEvent;
        try {
          event = JSON.parse(ev.data) as RealtimeServerEvent;
        } catch {
          return;
        }
        if (typeof event?.type !== "string") return;
        // Every server event reaches the machine, `error` included, so a refused judge or speculative reply is seen (R2.8).
        if (event.type === "input_audio_buffer.committed") this.dispatch({ type: "realtime", event, freshId: this.newId(), lastLoudAt: this.lastLoudAt });
        else this.dispatch({ type: "realtime", event, freshId: this.newId() });
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!live()) return;
      // The offer goes only to the SDP_Proxy (R12.1).
      const answer = await this.post("/api/session/sdp", { requestId: this.newId(), sessionId, generation, offerSdp: offer.sdp ?? "" }, SDP_TIMEOUT_MS, SdpResponse);
      if (!live()) return;
      if (answer === null) return this.dispatch({ type: "sdpFailed" });
      await pc.setRemoteDescription({ type: "answer", sdp: answer.answerSdp });
    } catch {
      if (live()) this.dispatch({ type: "sdpFailed" });
    }
  }

  /** Stop the microphone track, close the data channel, close the peer connection (R14.1). */
  private teardown(): void {
    this.connection++;
    this.lastLoudAt = null;
    for (const t of this.mic?.getAudioTracks() ?? []) t.stop();
    this.mic = null;
    const dc = this.channel;
    const pc = this.peer;
    this.channel = null;
    this.peer = null;
    try {
      dc?.close();
    } catch {
      // already closed
    }
    try {
      pc?.close();
    } catch {
      // already closed
    }
    this.deps.audio.srcObject = null;
    this.remoteStream = null;
    this.reportStreams();
  }

  /** Reads the mic level every LATENCY_SAMPLE_MS while this connection lives, keeping the last loud time (R18.5). */
  private sampleLevels(live: () => boolean): void {
    const read = this.deps.inputLevel;
    if (read === undefined) return;
    const tick = () => {
      if (!live()) return;
      let level = 0;
      try {
        level = read();
      } catch {
        // the meter's problem, not the call's
      }
      if (level >= LOUD_LEVEL) this.lastLoudAt = this.deps.clock.read().opsClock.now;
      this.timers.setTimeout(tick, LATENCY_SAMPLE_MS);
    };
    this.timers.setTimeout(tick, LATENCY_SAMPLE_MS);
  }

  /** Tells the Level_Meter the current streams. A throwing callback never reaches the call. */
  private reportStreams(): void {
    try {
      this.deps.onStreams?.({ mic: this.mic, output: this.remoteStream });
    } catch {
      // the meter's problem, not the call's
    }
  }
}
