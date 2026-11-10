/**
 * Call generators and the driver that plays them through the Voice_Machine (voice-control R20.1, R20.5; design
 * "Correctness Properties"). Plain module, not guarded: fixing a generator is an ordinary edit. Each property file
 * holds only its statement.
 *
 * A call is a live Session (Deck, fresh StateAck) followed by up to 60 actions. Actions are drawn without knowing
 * the machine's state and are interpreted against it by `runCall`: "answer the judge with H" means the judge
 * response the machine created most recently, or the `pick`-th one, so every sequence is meaningful. The driver
 * plays the Realtime server and the routes: it answers `response.create` with `response.created`, posts with
 * `turnOk` built as the server would (hash right or wrong), state polls with fresh, stale, null or mismatched
 * acks, and timers at, before or after their deadlines. It also keeps a model of the output buffer (`playing`),
 * which the audible helper reads.
 */
import fc from "fast-check";
import { payloadHash } from "../../admission";
import { type Hasher, canonicalJSON } from "../../ids";
import { tsFromMs } from "../../schema/primitives";
import type { Deck, Permit, Stamp, W } from "../../schema/wire";
import { sampleHead } from "../../testing/samples";
import { FORGET_NOT_YET, ackNote } from "../lines";
import { type RealtimeClientEvent, type TimerName, type TurnBody, type VoiceCommand, type VoiceEvent, type VoiceState, initialVoiceState, step } from "../machine";

// ---------------------------------------------------------------------------------------------
// A pure test hasher: deterministic 64-hex digest, the same for the "server" and the "browser".

function fnv(bytes: Uint8Array, seed: number): string {
  let h = 0x811c9dc5 ^ seed;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}
export const testHasher: Hasher = {
  sha256: (bytes) => [1, 2, 3, 4, 5, 6, 7, 8].map((s) => fnv(bytes, s)).join(""),
  id: (parts) => {
    const text = canonicalJSON(parts);
    const bytes = new TextEncoder().encode(text);
    return `t${[1, 2, 3, 4, 5, 6].map((s) => fnv(bytes, s)).join("").slice(0, 42)}`;
  },
};

// ---------------------------------------------------------------------------------------------
// Actions

export type TurnVariant = "ordinary" | "ready" | "readyAck" | "hold" | "clarify" | "retry" | "stale" | "error" | "late";
export type StateVariant = "fresh" | "stale" | "null" | "mismatch";

export type Action =
  | { k: "speechStart" }
  | { k: "speechStop" }
  | { k: "commit" }
  | { k: "itemAdded"; pick: number }
  | { k: "transcript"; pick: number; fail: boolean; empty: boolean }
  | { k: "created"; pick: number }
  | { k: "judgeDone"; pick: number; letter: "O" | "H" | "U" | "bad" | "incomplete" }
  | { k: "started"; pick: number }
  | { k: "stopped" }
  | { k: "done"; pick: number }
  | { k: "fnCall"; pick: number }
  | { k: "error"; pick: number }
  | { k: "turnOk"; pick: number; variant: TurnVariant; hashOk: boolean }
  | { k: "turnFailed"; pick: number }
  | { k: "stateOk"; variant: StateVariant }
  | { k: "stateFailed" }
  | { k: "higherDeck" }
  | { k: "connectionLost" }
  | { k: "foreign"; what: "otherGen" | "unknownStart" | "cancelledStart" | "unknownDone" }
  | { k: "timer"; early: boolean; pick: number }
  | { k: "hash"; pick: number; ok: boolean }
  | { k: "toolAnswer"; ok: boolean };

export interface Step {
  action: Action;
  dt: number;
}

const pick = fc.nat({ max: 7 });
const TIMERS: TimerName[] = ["item", "transcript", "permit", "turnRetry", "refresh", "tool", "lineDone", "judge", "poll"];

export const arbAction: fc.Arbitrary<Action> = fc.oneof(
  { weight: 3, arbitrary: fc.constant({ k: "speechStart" } as Action) },
  { weight: 2, arbitrary: fc.constant({ k: "speechStop" } as Action) },
  { weight: 4, arbitrary: fc.constant({ k: "commit" } as Action) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant("itemAdded" as const), pick }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant("transcript" as const), pick, fail: fc.constant(false), empty: fc.constant(false) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("transcript" as const), pick, fail: fc.boolean(), empty: fc.boolean() }) },
  { weight: 6, arbitrary: fc.record({ k: fc.constant("created" as const), pick }) },
  { weight: 5, arbitrary: fc.record({ k: fc.constant("judgeDone" as const), pick, letter: fc.constantFrom("O", "O", "O", "H", "U", "bad", "incomplete") }) },
  { weight: 5, arbitrary: fc.record({ k: fc.constant("started" as const), pick }) },
  { weight: 2, arbitrary: fc.constant({ k: "stopped" } as Action) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("done" as const), pick }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("fnCall" as const), pick }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("error" as const), pick }) },
  {
    weight: 5,
    arbitrary: fc.record({
      k: fc.constant("turnOk" as const),
      pick,
      variant: fc.constantFrom<TurnVariant>("ordinary", "ordinary", "ready", "readyAck", "hold", "clarify", "retry", "stale", "error", "late"),
      hashOk: fc.constantFrom(true, true, true, false),
    }),
  },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("turnFailed" as const), pick }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant("stateOk" as const), variant: fc.constantFrom<StateVariant>("fresh", "fresh", "fresh", "stale", "null", "mismatch") }) },
  { weight: 1, arbitrary: fc.constant({ k: "stateFailed" } as Action) },
  { weight: 1, arbitrary: fc.constant({ k: "higherDeck" } as Action) },
  { weight: 1, arbitrary: fc.constant({ k: "connectionLost" } as Action) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("foreign" as const), what: fc.constantFrom("otherGen", "unknownStart", "cancelledStart", "unknownDone") }) },
  { weight: 5, arbitrary: fc.record({ k: fc.constant("timer" as const), early: fc.boolean(), pick }) },
  { weight: 6, arbitrary: fc.record({ k: fc.constant("hash" as const), pick, ok: fc.constantFrom(true, true, true, true, false) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("toolAnswer" as const), ok: fc.boolean() }) },
);

export const arbStep: fc.Arbitrary<Step> = fc.record({
  action: arbAction,
  dt: fc.oneof({ weight: 5, arbitrary: fc.integer({ min: 0, max: 400 }) }, { weight: 2, arbitrary: fc.integer({ min: 0, max: 2_500 }) }, { weight: 1, arbitrary: fc.constantFrom(0, 600, 1_199, 1_200, 2_499, 2_500, 5_000) }),
});

/** One turn as it usually goes, with its verdict, server answer and timing drawn; perturbed below. */
const arbSceneBase: fc.Arbitrary<Step[]> = fc
  .record({
    letter: fc.constantFrom<"O" | "H" | "U" | "bad" | "incomplete">("O", "O", "O", "H", "U", "bad", "incomplete"),
    variant: fc.constantFrom<TurnVariant>("ordinary", "ordinary", "ready", "readyAck", "hold", "clarify", "retry", "late"),
    hashOk: fc.constantFrom(true, true, true, false),
    judgeMs: fc.integer({ min: 100, max: 1_600 }),
    asrMs: fc.integer({ min: 100, max: 3_000 }),
    fragments: fc.integer({ min: 1, max: 2 }),
    state: fc.constantFrom<StateVariant>("fresh", "fresh", "fresh", "stale", "null", "mismatch"),
  })
  .map(({ letter, variant, hashOk, judgeMs, asrMs, fragments, state }) => {
    const s = (action: Action, dt = 0): Step => ({ action, dt });
    const commits: Step[] = [];
    for (let f = 0; f < fragments; f++) commits.push(s({ k: "speechStart" }, 200), s({ k: "speechStop" }, 900), s({ k: "commit" }, 300), s({ k: "itemAdded", pick: 0 }, 40));
    const judgeFirst = judgeMs <= asrMs;
    const judge = [s({ k: "judgeDone", pick: 0, letter }, judgeFirst ? judgeMs : 0), s({ k: "hash", pick: 0, ok: true })];
    const asr = Array.from({ length: fragments }, (_, i) => s({ k: "transcript", pick: i, fail: false, empty: false }, i === 0 ? (judgeFirst ? Math.max(0, asrMs - judgeMs) : asrMs) : 0));
    return [
      s({ k: "stateOk", variant: state }, 100),
      ...commits,
      s({ k: "created", pick: 1 }, 20),
      s({ k: "created", pick: 0 }, 5),
      s({ k: "hash", pick: 0, ok: true }),
      s({ k: "started", pick: 0 }, 300),
      ...(judgeFirst ? [...judge, ...asr] : [...asr, ...judge]),
      s({ k: "turnOk", pick: 0, variant, hashOk }, 400),
      s({ k: "hash", pick: 0, ok: true }),
      s({ k: "created", pick: 0 }, 30),
      s({ k: "started", pick: 0 }, 300),
      s({ k: "stopped" }, 1_500),
      s({ k: "done", pick: 0 }),
      s({ k: "timer", early: false, pick: 0 }, 100),
    ];
  });

/** A scene with steps dropped, duplicated, swapped and noise inserted. */
export const arbScene: fc.Arbitrary<Step[]> = fc
  .tuple(arbSceneBase, fc.array(fc.nat({ max: 99 }), { minLength: 30, maxLength: 30 }), fc.array(fc.tuple(fc.nat({ max: 30 }), arbStep), { maxLength: 4 }), fc.array(fc.nat({ max: 30 }), { maxLength: 3 }))
  .map(([base, rolls, noise, swaps]) => {
    let out: Step[] = [];
    base.forEach((st, i) => {
      const r = rolls[i % rolls.length]!;
      if (r < 12) return; // dropped
      out.push(st);
      if (r >= 95) out.push(st); // repeated
    });
    for (const [at, n] of noise) out.splice(Math.min(at, out.length), 0, n);
    for (const at of swaps) if (at + 1 < out.length) [out[at], out[at + 1]] = [out[at + 1]!, out[at]!];
    out = out.slice(0, 40);
    return out;
  });

/** A call: up to 60 steps after a live Session. Mostly coherent turns, perturbed; some pure noise. */
export const arbCall: fc.Arbitrary<Step[]> = fc.oneof(
  { weight: 4, arbitrary: fc.array(fc.constant(null), { minLength: 1, maxLength: 4 }).chain((n) => fc.tuple(...n.map(() => arbScene))).map((ss) => ss.flat().slice(0, 60)) },
  { weight: 1, arbitrary: fc.array(arbStep, { minLength: 1, maxLength: 60 }) },
);

/** A call that tends to reach a verdict: commit, item, judge answer and audio near the front. */
export const arbTurnCall: fc.Arbitrary<Step[]> = fc.array(arbStep, { minLength: 0, maxLength: 50 }).map((rest) => [
    { action: { k: "commit" } as Action, dt: 10 },
    { action: { k: "itemAdded", pick: 0 } as Action, dt: 50 },
    { action: { k: "created", pick: 0 } as Action, dt: 30 },
    { action: { k: "created", pick: 0 } as Action, dt: 5 },
    { action: { k: "hash", pick: 0, ok: true } as Action, dt: 1 },
    ...rest,
  ]);

// ---------------------------------------------------------------------------------------------
// The driver

export const T0 = Date.UTC(2026, 10, 10, 12);
export const SID = "s".repeat(43);
const GEN = 1;

export interface Response {
  id: string;
  purpose: string;
  turnId: string;
  eventId: string | null;
  /** The step at which the machine sent this response's `response.create`. */
  createStep: number;
  createdAt: number;
  cancelled: boolean;
  done: boolean;
  started: boolean;
}

export interface TraceStep {
  i: number;
  event: VoiceEvent;
  now: number;
  before: VoiceState;
  after: VoiceState;
  commands: VoiceCommand[];
  /** The driver's model of the output buffer after this step: the response whose audio is playing, or null. */
  playing: string | null;
}

export interface Trace {
  steps: TraceStep[];
  responses: Response[];
  /** Every `response.create` the machine sent, with the step it was sent at. */
  creates: { step: number; event: RealtimeClientEvent }[];
}

interface Pending {
  creates: { event: RealtimeClientEvent; step: number }[];
  verify: { permitId: string; payload: Parameters<typeof payloadHash>[0] }[];
  hash: { eventId: string; payload: Parameters<typeof payloadHash>[0] }[];
  posts: { body: TurnBody; answered: boolean; at: number }[];
  states: number[];
  tool: { callId: string; stamp: Stamp } | null;
  open: boolean;
}

export function deckAt(issued: number, revs: Partial<Deck> = {}): Deck {
  return {
    epoch: 1,
    policyRev: 1,
    generation: GEN,
    bundleRev: 1,
    rulesRev: 1,
    issuedAt: tsFromMs(issued),
    expiresAt: tsFromMs(issued + 60_000),
    head: sampleHead(),
    whispers: [],
    noteWaiting: false,
    turns: [],
    cards: [],
    activePlanId: null,
    ...revs,
  };
}

const ssOf = (d: Deck) => ({ sessionId: SID, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: d.generation });
const ackOf = (d: Deck, at: number, policyBump = 0) => ({ stamp: { ...ssOf(d), policyRev: d.policyRev + policyBump }, issuedOpsAt: tsFromMs(at), expiresOpsAt: tsFromMs(at + 2_500) });

const meta = (e: RealtimeClientEvent): Record<string, string> => ((e.response as Record<string, unknown> | undefined)?.metadata as Record<string, string> | undefined) ?? {};

/** A driver for one call. `ev` steps the machine and records the trace. */
export class CallDriver {
  st: VoiceState = initialVoiceState({ transcribeModel: "test-transcribe" }, "UTC");
  now = T0;
  trace: Trace = { steps: [], responses: [], creates: [] };
  playing: string | null = null;
  serverDeck: Deck = deckAt(T0);
  pending: Pending = { creates: [], verify: [], hash: [], posts: [], states: [], tool: null, open: false };
  items: string[] = [];
  private n = 0;

  constructor(readonly hasher: Hasher = testHasher) {}

  fresh(prefix: string): string {
    this.n += 1;
    return `${prefix}${String(this.n).padStart(43 - prefix.length, "0")}`;
  }

  ev(event: VoiceEvent, dt = 0): VoiceCommand[] {
    this.now += dt;
    const before = this.st;
    const r = step(this.st, event, this.now);
    this.st = r.state;
    this.absorb(r.commands);
    this.trace.steps.push({ i: this.trace.steps.length, event, now: this.now, before, after: r.state, commands: r.commands, playing: this.playing });
    return r.commands;
  }

  rt(event: Record<string, unknown>, dt = 0, extra: Partial<Extract<VoiceEvent, { type: "realtime" }>> = {}): VoiceCommand[] {
    return this.ev({ type: "realtime", event: event as never, freshId: this.fresh("u"), ...extra }, dt);
  }

  /** Reads the commands into the driver's world. */
  private absorb(cmds: VoiceCommand[]): void {
    const stepIndex = this.trace.steps.length;
    for (const c of cmds) {
      switch (c.kind) {
        case "send": {
          const e = c.event;
          if (e.type === "response.create") {
            this.pending.creates.push({ event: e, step: stepIndex });
            this.trace.creates.push({ step: stepIndex, event: e });
          } else if (e.type === "response.cancel") {
            const r = this.trace.responses.find((x) => x.id === e.response_id);
            if (r !== undefined) r.cancelled = true;
            if (this.playing === e.response_id) this.playing = null;
          } else if (e.type === "output_audio_buffer.clear") this.playing = null;
          break;
        }
        case "verifyPermit":
          this.pending.verify.push({ permitId: c.permitId, payload: c.payload });
          break;
        case "hashPayload":
          this.pending.hash.push({ eventId: c.eventId, payload: c.payload });
          break;
        case "turn":
          this.pending.posts.push({ body: c.body, answered: false, at: this.now });
          break;
        case "state":
          this.pending.states.push(this.now);
          break;
        case "tool":
          this.pending.tool = { callId: c.body.callId, stamp: c.body.stamp };
          break;
        case "teardown":
          this.playing = null;
          for (const r of this.trace.responses) r.cancelled = true;
          this.pending.creates = [];
          break;
        case "open":
          this.pending.open = true;
          break;
        default:
          break;
      }
    }
  }

  /** Brings a call to LISTENING: open, connect, configure and the first ack. */
  connect(): void {
    this.pending.open = false;
    this.serverDeck = deckAt(this.now, { policyRev: this.serverDeck.policyRev });
    this.ev({ type: "openOk", response: { sessionId: SID, generation: GEN, deck: this.serverDeck, state: "connecting", ack: ackOf(this.serverDeck, this.now), proactive: null } }, 100);
    this.ev({ type: "channelOpen" }, 200);
    const sent = this.pending.states.shift() ?? this.now;
    this.ev({ type: "stateOk", response: { stamp: ssOf(this.serverDeck), state: "LISTENING", deck: this.serverDeck, ack: ackOf(this.serverDeck, this.now), barrierReceiptId: null, proactive: null }, sentAt: sent }, 50);
  }

  start(): this {
    this.ev({ type: "callPressed", zone: "UTC" });
    this.connect();
    return this;
  }

  /** The server's Permit for a posted body, hashed as the seam does. */
  permitFor(body: TurnBody, kind: Permit["kind"], scope: Permit["scope"], notes: W[], hashOk: boolean): Permit {
    const stamp: Stamp = { sessionId: body.sessionId, epoch: body.epoch, policyRev: body.policyRev, bundleRev: body.bundleRev, rulesRev: body.rulesRev, generation: body.generation, turnId: body.turnId };
    const deck = this.st.deck ?? this.serverDeck;
    const audioIds = [...body.items].sort((a, b) => a.commitSeq - b.commitSeq).map((i) => i.itemId);
    const hash = payloadHash({ stamp, head: deck.head, notes, turns: deck.turns, audioIds, toolOutput: null }, this.hasher);
    return {
      permitId: this.fresh("p"),
      stamp,
      kind,
      scope,
      approvedPayloadHash: hashOk ? hash : "0".repeat(64),
      noteIds: notes.map((n) => n.noteId),
      momentIds: [],
      expiresAt: tsFromMs(this.now + 10_000),
    };
  }

  turnResponse(body: TurnBody, variant: TurnVariant, hashOk: boolean) {
    const stamp: Stamp = { sessionId: body.sessionId, epoch: body.epoch, policyRev: body.policyRev, bundleRev: body.bundleRev, rulesRev: body.rulesRev, generation: body.generation, turnId: body.turnId };
    const base = { requestId: this.fresh("r"), stamp, deck: this.serverDeck, notes: [] as W[], cards: [], pendingId: null, question: null, retryAfterMs: 0, receiptId: null, error: null };
    const missing = body.transcriptState !== "final";
    const v: TurnVariant = missing && variant !== "retry" && variant !== "stale" && variant !== "error" ? "hold" : variant;
    switch (v) {
      case "ordinary":
      case "late":
        return { ...base, status: "ordinary" as const, permit: body.supersedesRequestId !== null ? null : this.permitFor(body, "slowOrdinary", "reply", [], hashOk) };
      case "ready":
        return { ...base, status: "ready" as const, permit: this.permitFor(body, "postCommitControl", "reply", [], hashOk) };
      case "readyAck": {
        const note = ackNote(FORGET_NOT_YET, this.fresh("n"), tsFromMs(this.now + 10_000));
        return { ...base, status: "ready" as const, notes: [note], permit: this.permitFor(body, "postCommitControl", "ack", [note], hashOk) };
      }
      case "hold":
        return { ...base, status: "hold" as const, permit: this.permitFor(body, "recoveryOnly", "reply", [], hashOk) };
      case "clarify":
        return { ...base, status: "clarify" as const, permit: this.permitFor(body, "recoveryOnly", "reply", [], hashOk) };
      case "retry":
        return { ...base, status: "hold" as const, permit: null, retryAfterMs: 250 };
      case "stale":
        return { ...base, status: "stale" as const, permit: null };
      case "error":
        return { ...base, status: "hold" as const, permit: null, error: "DEPENDENCY" as const };
    }
  }

  /** Plays one generated step. Auxiliary steps (reconnect) are recorded too. */
  play(s: Step): void {
    if (this.pending.open && this.st.awaitingOpen) this.connect();
    const a = s.action;
    const dt = s.dt;
    const nth = <T>(xs: readonly T[], p: number): T | undefined => (xs.length === 0 ? undefined : xs[xs.length - 1 - (p % xs.length)]);
    switch (a.k) {
      case "speechStart":
        this.rt({ type: "input_audio_buffer.speech_started", item_id: `pending_${this.items.length}`, audio_start_ms: 0 }, dt);
        return;
      case "speechStop":
        this.rt({ type: "input_audio_buffer.speech_stopped", item_id: `pending_${this.items.length}`, audio_end_ms: 1_000 }, dt);
        return;
      case "commit": {
        const id = `item_${this.items.length}`;
        this.items.push(id);
        this.rt({ type: "input_audio_buffer.committed", item_id: id }, dt, { lastLoudAt: this.now + dt - 400 });
        return;
      }
      case "itemAdded": {
        const id = nth(this.items, a.pick);
        if (id !== undefined) this.rt({ type: "conversation.item.added", item: { id } }, dt);
        return;
      }
      case "transcript": {
        const id = nth(this.items, a.pick);
        if (id === undefined) return;
        if (a.fail) this.rt({ type: "conversation.item.input_audio_transcription.failed", item_id: id }, dt);
        else this.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: a.empty ? "" : `words of ${id}` }, dt);
        return;
      }
      case "created": {
        const c = nth(this.pending.creates, a.pick);
        if (c === undefined) return;
        this.pending.creates = this.pending.creates.filter((x) => x !== c);
        const m = meta(c.event);
        const id = this.fresh("resp_");
        this.trace.responses.push({ id, purpose: m.purpose ?? "?", turnId: m.turnId ?? "?", eventId: (c.event.event_id as string | undefined) ?? null, createStep: c.step, createdAt: this.trace.steps.length, cancelled: false, done: false, started: false });
        this.rt({ type: "response.created", response: { id, metadata: m } }, dt);
        return;
      }
      case "judgeDone": {
        const r = nth(this.trace.responses.filter((x) => x.purpose === "judge" && !x.done), a.pick);
        if (r === undefined) return;
        r.done = true;
        const text = a.letter === "bad" ? "OK." : a.letter === "incomplete" ? "O" : a.letter;
        const status = a.letter === "incomplete" ? "incomplete" : r.cancelled ? "cancelled" : "completed";
        this.rt({ type: "response.done", response: { id: r.id, status, metadata: { purpose: "judge", turnId: r.turnId, generation: String(GEN) }, output: [{ type: "message", content: [{ type: "output_text", text }] }] } }, dt);
        return;
      }
      case "started": {
        const r = nth(this.trace.responses.filter((x) => x.purpose !== "judge" && !x.cancelled && !x.started), a.pick);
        if (r === undefined) return;
        r.started = true;
        this.playing = r.id;
        this.rt({ type: "output_audio_buffer.started", response_id: r.id }, dt);
        return;
      }
      case "stopped": {
        const id = this.playing;
        if (id === null) return;
        this.playing = null;
        this.rt({ type: "output_audio_buffer.stopped", response_id: id }, dt);
        return;
      }
      case "done": {
        const r = nth(this.trace.responses.filter((x) => x.purpose !== "judge" && !x.done), a.pick);
        if (r === undefined) return;
        r.done = true;
        this.rt({ type: "response.done", response: { id: r.id, status: r.cancelled ? "cancelled" : "completed", metadata: { purpose: r.purpose, turnId: r.turnId, generation: String(GEN) } } }, dt);
        return;
      }
      case "fnCall": {
        const r = nth(this.trace.responses.filter((x) => x.purpose !== "judge" && !x.cancelled), a.pick);
        if (r === undefined) return;
        this.rt({ type: "response.function_call_arguments.done", response_id: r.id, call_id: this.fresh("call_"), name: "recall", arguments: '{"query":"x"}' }, dt);
        return;
      }
      case "error": {
        const c = nth(this.trace.creates.filter((x) => typeof x.event.event_id === "string"), a.pick);
        if (c === undefined) return;
        this.rt({ type: "error", error: { type: "invalid_request_error", code: "conversation_already_has_active_response", event_id: c.event.event_id as string } }, dt);
        return;
      }
      case "turnOk": {
        const open = this.pending.posts.filter((p) => !p.answered);
        const p = nth(open, a.pick);
        if (p === undefined) return;
        p.answered = true;
        this.ev({ type: "turnOk", turnId: p.body.turnId, response: this.turnResponse(p.body, a.variant, a.hashOk) as never }, a.variant === "late" ? Math.max(dt, 2_600) : dt);
        return;
      }
      case "turnFailed": {
        const p = nth(this.pending.posts.filter((x) => !x.answered), a.pick);
        if (p === undefined) return;
        p.answered = true;
        this.ev({ type: "turnFailed", turnId: p.body.turnId }, dt);
        return;
      }
      case "stateOk": {
        const sentAt = this.pending.states.shift();
        if (sentAt === undefined) return;
        const at = this.now + dt;
        const d = deckAt(at, { policyRev: this.serverDeck.policyRev });
        this.serverDeck = d;
        const ack = a.variant === "null" ? null : a.variant === "stale" ? ackOf(d, at - 3_000) : a.variant === "mismatch" ? ackOf(d, at, 1) : ackOf(d, at);
        this.ev({ type: "stateOk", response: { stamp: ssOf(d), state: "LISTENING", deck: d, ack, barrierReceiptId: null, proactive: null }, sentAt }, dt);
        return;
      }
      case "stateFailed":
        if (this.pending.states.shift() !== undefined) this.ev({ type: "stateFailed" }, dt);
        return;
      case "higherDeck":
        this.serverDeck = deckAt(this.now, { policyRev: this.serverDeck.policyRev + 1 });
        return;
      case "connectionLost":
        this.ev({ type: "connectionLost" }, dt);
        return;
      case "foreign": {
        if (a.what === "otherGen") this.rt({ type: "response.created", response: { id: this.fresh("resp_x"), metadata: { purpose: "speech", turnId: this.st.turn?.turnId ?? "x", generation: "9" } } }, dt);
        else if (a.what === "unknownStart") this.rt({ type: "output_audio_buffer.started", response_id: this.fresh("resp_u") }, dt);
        else if (a.what === "unknownDone") this.rt({ type: "response.done", response: { id: this.fresh("resp_u"), metadata: { purpose: "judge", turnId: "x", generation: "9" } } }, dt);
        else {
          const r = this.trace.responses.find((x) => x.cancelled && x.purpose !== "judge");
          if (r !== undefined) this.rt({ type: "output_audio_buffer.started", response_id: r.id }, dt);
        }
        return;
      }
      case "timer": {
        const armed = Object.entries(this.st.deadlines) as [TimerName, number][];
        if (a.early) {
          const name = TIMERS[a.pick % TIMERS.length]!;
          this.ev({ type: "timer", name }, Math.min(dt, 50));
          return;
        }
        if (armed.length === 0) return;
        const [name, at] = armed.sort((x, y) => x[1] - y[1])[0]!;
        this.ev({ type: "timer", name }, Math.max(0, at - this.now));
        return;
      }
      case "hash": {
        const all = [...this.pending.verify.map((v) => ({ kind: "verify" as const, v })), ...this.pending.hash.map((v) => ({ kind: "hash" as const, v }))];
        const x = nth(all, a.pick);
        if (x === undefined) return;
        const h = a.ok ? payloadHash(x.v.payload, this.hasher) : "f".repeat(64);
        if (x.kind === "verify") {
          this.pending.verify = this.pending.verify.filter((y) => y !== x.v);
          this.ev({ type: "permitChecked", permitId: (x.v as { permitId: string }).permitId, hash: h }, dt);
        } else {
          this.pending.hash = this.pending.hash.filter((y) => y !== x.v);
          this.ev({ type: "specHashed", eventId: (x.v as { eventId: string }).eventId, hash: h }, dt);
        }
        return;
      }
      case "toolAnswer": {
        const t = this.pending.tool;
        if (t === null) return;
        this.pending.tool = null;
        if (a.ok) this.ev({ type: "toolOk", callId: t.callId, response: { stamp: t.stamp, callId: t.callId, status: "hold", result: null, deck: null, permit: null } as never }, dt);
        else this.ev({ type: "toolFailed", callId: t.callId }, dt);
        return;
      }
    }
  }
}

/** Plays a whole call and returns its trace. */
export function runCall(steps: readonly Step[], hasher: Hasher = testHasher): CallDriver {
  const d = new CallDriver(hasher).start();
  for (const s of steps) d.play(s);
  return d;
}
