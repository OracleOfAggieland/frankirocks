/**
 * Typed input and the conversation view's state (R18.1, R18.6, R18.8–R18.10; design "One typed turn").
 *
 * With no call open, the first typed line opens a Session (`/api/session/open`, no SDP) and keeps its Stamp. Each
 * line is one TurnRequest with `source:"typed"`, `items:[]`, `judge:"typed"`, `transcriptState:"final"` and a
 * clientSeq exactly 1 above the last one this client assigned (KV12). While a request is in flight the send
 * control is disabled, so one press sends at most one request. On an error or no response within 10 s the text
 * stays in the box with an error and no reply.
 *
 * Retrying a failed line: the same text reuses the same requestId, turnId and clientSeq, so a request the server
 * did commit is replayed rather than written twice (R19.3). Changed text reuses the clientSeq with new IDs.
 */
import {
  OpenResponse,
  type SS,
  TurnResponse,
  type TurnRequest,
  msFromTs,
  tsFromMs,
  validate,
  type Infer,
} from "@franki/core";
import type { ApiClient, ApiResult } from "./api";
import type { BrowserClock } from "./clock";
import { randomId } from "./ids";

export const TURN_TIMEOUT_MS = 10_000;
export const OPEN_TIMEOUT_MS = 5_000;
export const MAX_TRANSCRIPT = 8192;
/** clientSeq holds (a predecessor not yet committed) are retried this many times within the 10 s limit. */
const MAX_HOLD_RETRIES = 8;

export type ConversationEntry = { key: string; role: "user" | "franki"; text: string };

export interface TypedState {
  text: string;
  sending: boolean;
  /** Why the last line was not sent, or null. */
  error: string | null;
  entries: ConversationEntry[];
  /** The last clientSeq this client assigned in the current Session (0 before the first). */
  lastClientSeq: number;
  sessionId: string | null;
}

interface Pending {
  clientSeq: number;
  requestId: string;
  turnId: string;
  transcript: string;
}

export interface TypedDeps {
  api: ApiClient;
  clock: BrowserClock;
  newId?: () => string;
  /** Waits `ms` before a hold retry. setTimeout by default. */
  sleep?: (ms: number) => Promise<void>;
  /** Told the turn each answered typed line was, for the phone on the screen. Never changes what is sent. */
  onTurn?: (turn: { sessionId: string; turnId: string }) => void;
  /** Told each answered line's words, Franki's reply lines and the turn's forget receipt (brief 020). Never changes what is sent. */
  onReply?: (reply: { transcript: string; lines: string[]; receiptId: string | null }) => void;
}

/** Pure: whether the text may be sent (R18.1, R18.8). */
export function canSendText(text: string): boolean {
  return text.trim() !== "" && text.length <= MAX_TRANSCRIPT;
}

const failureMessage = (r: Exclude<ApiResult<unknown>, { ok: true }>, step: string): string => {
  switch (r.kind) {
    case "signedOut":
      return "Not sent: you are signed out.";
    case "timeout":
      return `Not sent: no response from ${step} within ${step === "the server" ? 10 : 5} seconds.`;
    case "network":
      return `Not sent: could not reach ${step}.`;
    case "http":
      return `Not sent: ${step} answered ${r.error ?? `HTTP ${r.status}`}.`;
  }
};

export class TypedTurns {
  private state: TypedState = { text: "", sending: false, error: null, entries: [], lastClientSeq: 0, sessionId: null };
  private listeners = new Set<() => void>();
  private stamp: SS | null = null;
  private pending: Pending | null = null;
  private readonly newId: () => string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: TypedDeps) {
    this.newId = deps.newId ?? (() => randomId());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TypedState => this.state;

  canSend(): boolean {
    return !this.state.sending && canSendText(this.state.text);
  }

  setText(text: string): void {
    this.set({ text });
  }

  /** One press of send or Enter. Returns false when nothing was sent. */
  async submit(): Promise<boolean> {
    if (!this.canSend()) return false;
    return this.send(this.state.text, true);
  }

  /**
   * Sends a chip's words down the same typed path, as the owner's own (spec §15), and leaves the box as it is. A
   * chip is a code constant, never pasted text. Returns false when nothing was sent.
   */
  async sendLine(text: string): Promise<boolean> {
    if (this.state.sending || !canSendText(text)) return false;
    return this.send(text, false);
  }

  private async send(transcript: string, fromBox: boolean): Promise<boolean> {
    this.set({ sending: true, error: null });
    try {
      const stamp = this.stamp ?? (await this.openSession());
      if (typeof stamp === "string") return this.fail(stamp);
      const pending = this.pendingFor(transcript);
      const result = await this.sendTurn(stamp, pending);
      if (typeof result === "string") return this.fail(result);

      this.pending = null;
      this.stamp = ssOf(result.stamp);
      const entries = [...this.state.entries, { key: pending.turnId, role: "user" as const, text: transcript }];
      // No call is open in this path, so the reply shows as text and no audio plays (R18.6).
      for (const note of result.notes) entries.push({ key: note.noteId, role: "franki", text: note.text });
      this.set({ ...(fromBox ? { text: "" } : {}), sending: false, error: null, entries });
      this.deps.onTurn?.({ sessionId: result.stamp.sessionId, turnId: result.stamp.turnId });
      this.deps.onReply?.({ transcript, lines: result.notes.map((n) => n.text), receiptId: result.receiptId });
      return true;
    } catch {
      return this.fail("Not sent: something went wrong in the browser.");
    }
  }

  /**
   * Closes the typed Session, if one is open (R9.5: sign-out closes any open Session). Waits at most `timeoutMs`;
   * a failure is left to the server's expiry close (R9.8). Afterwards the next line opens a new Session.
   */
  async closeSession(timeoutMs = 5_000): Promise<void> {
    const stamp = this.stamp;
    this.stamp = null;
    this.pending = null;
    if (stamp === null) return;
    this.set({ sessionId: null, lastClientSeq: 0 });
    await this.deps.api.call("/api/session/close", {
      body: { requestId: this.newId(), sessionId: stamp.sessionId, generation: stamp.generation, reason: "user" },
      timeoutMs,
    });
  }

  /** Drops every typed line and reply this client holds, after a completed forget (lab-ui-foundation R17.5). */
  dropTurnCopies(): void {
    this.set({ entries: [], text: "" });
  }

  /** Forgets the typed Session without a request: a call open closes it on the server (KV09). */
  dropSession(): void {
    if (this.stamp === null) return;
    this.stamp = null;
    this.pending = null;
    this.set({ sessionId: null, lastClientSeq: 0 });
  }

  private fail(message: string): false {
    // The text stays in the box and no reply is shown (R18.10).
    this.set({ sending: false, error: message });
    return false;
  }

  private pendingFor(transcript: string): Pending {
    if (this.pending !== null && this.pending.transcript === transcript) return this.pending;
    // The clientSeq stays the one assigned to the unsent line; a new line gets last + 1 (R18.1).
    const clientSeq = this.pending?.clientSeq ?? this.state.lastClientSeq + 1;
    this.pending = { clientSeq, requestId: this.newId(), turnId: this.newId(), transcript };
    if (clientSeq !== this.state.lastClientSeq) this.set({ lastClientSeq: clientSeq });
    return this.pending;
  }

  private async openSession(): Promise<SS | string> {
    const { clock, api } = this.deps;
    const sentAt = clock.mono();
    const r = await api.call<unknown>("/api/session/open", {
      body: { requestId: this.newId(), initiator: "user", previousSessionId: null, clientZone: clock.read().worldClock.zone, visitId: null },
      timeoutMs: OPEN_TIMEOUT_MS,
    });
    if (!r.ok) return failureMessage(r, "session open");
    const parsed = validate(OpenResponse, r.body);
    if (!parsed.ok) return "Not sent: session open returned an unexpected response.";
    const open = parsed.value as Infer<typeof OpenResponse>;
    if (open.state === "blocked" || open.ack === null) return "Not sent: Franki is not accepting new sessions right now.";
    if (open.deck !== null) clock.syncToServer(msFromTs(open.deck.issuedAt), sentAt, clock.mono());
    this.stamp = open.ack.stamp;
    this.pending = null;
    this.set({ sessionId: open.sessionId, lastClientSeq: 0 });
    return open.ack.stamp;
  }

  private async sendTurn(stamp: SS, pending: Pending): Promise<Infer<typeof TurnResponse> | string> {
    const { api, clock } = this.deps;
    let current = stamp;
    for (let attempt = 0; ; attempt++) {
      const body: Infer<typeof TurnRequest> = {
        ...current,
        turnId: pending.turnId,
        requestId: pending.requestId,
        clientSeq: pending.clientSeq,
        source: "typed",
        items: [],
        utteredWorldAt: tsFromMs(clock.read().worldClock.now),
        transcript: pending.transcript,
        transcriptState: "final",
        judge: "typed",
        pendingId: null,
        choiceId: null,
        supersedesRequestId: null,
        uiControl: null,
      };
      const r = await api.call<unknown>("/api/turn", { body, timeoutMs: TURN_TIMEOUT_MS });
      if (!r.ok) {
        // The Session is gone or closed (expiry, another call open): the next press opens a new one.
        if (r.kind === "http" && (r.error === "STALE" || r.error === "SCOPE")) this.stamp = null;
        return failureMessage(r, "the server");
      }
      const parsed = validate(TurnResponse, r.body);
      if (!parsed.ok) return "Not sent: the server returned an unexpected response.";
      const res = parsed.value as Infer<typeof TurnResponse>;
      if (res.error !== null) return `Not sent: the server answered ${res.error}.`;
      if (res.status === "stale" && attempt === 0) {
        // The Stamp's revisions moved on; nothing was recorded, so the same request may go again with the new Stamp.
        current = ssOf(res.stamp);
        this.stamp = current;
        continue;
      }
      if (res.status === "hold" && res.retryAfterMs > 0 && attempt < MAX_HOLD_RETRIES) {
        await this.sleep(res.retryAfterMs);
        continue;
      }
      if (res.status === "stale" || (res.status === "hold" && res.retryAfterMs > 0)) return "Not sent: the session moved on. Try again.";
      return res;
    }
  }

  private set(patch: Partial<TypedState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

function ssOf(stamp: Infer<typeof TurnResponse>["stamp"]): SS {
  return {
    sessionId: stamp.sessionId,
    epoch: stamp.epoch,
    policyRev: stamp.policyRev,
    bundleRev: stamp.bundleRev,
    rulesRev: stamp.rulesRev,
    generation: stamp.generation,
  };
}
