/**
 * A live call for the script runner (brief 045, part V, finding 3): the real voice machine (`step` in
 * `core/src/voice/machine.ts`) driven against the real routes, with this file standing in only for the browser's
 * shell (the WebRTC channel, the speaker, and the Realtime model, which speaks exactly the line it is given). The
 * machine's commands go where the Voice_Client sends them: `open`, `state`, `turn`, `receipt` and `close` to their
 * routes, `verifyPermit` to the same hash the browser computes (SHA-256 of the canonical admission payload, as
 * `apps/web/src/client/hash.ts` does), and each `response.create` to a model that plays it, ends it and reports
 * its transcript. Nothing here decides whether a line may play: the machine does.
 */
import { type RealtimeClientEvent, type VoiceCommand, type VoiceEvent, type VoiceState, admissionPayload, canonicalBytes, initialVoiceState, step } from "@franki/core";
import { testId } from "@franki/core/testing";
import { sha256Hex } from "../crypto";
import { closeRoute } from "../routes/close";
import { openRoute } from "../routes/open";
import { receiptRoute } from "../routes/receipt";
import { stateRoute } from "../routes/state";
import { turnRoute } from "../routes/turn";
import { type TestRig, callRoute } from "./fakes";

/** The most commands one event may lead to before the call is taken as stuck (fails the script). */
export const CALL_PUMP_LIMIT = 200;

/** What one call step did, for the script's outputs. */
export interface CallLog {
  /** Every answer a route gave, by route, in order. */
  answers: { route: "open" | "state" | "turn" | "receipt" | "close"; status: number; body: any }[];
  /** The words the model was told to say, in order (the `response.create` instructions' Fixed_Line or Head). */
  creates: RealtimeClientEvent[];
  /** What was heard: each played response's transcript. */
  heard: string[];
}

/** The text a `response.create` says verbatim, or its whole instructions. */
function spokenOf(e: RealtimeClientEvent): string {
  const r = (e.response ?? {}) as { instructions?: string };
  const text = r.instructions ?? "";
  const quoted = /"([^"]+)"/.exec(text);
  return quoted?.[1] ?? text;
}

export class ScriptCall {
  st: VoiceState;
  private n = 0;
  private queue: VoiceCommand[] = [];
  log: CallLog = { answers: [], creates: [], heard: [] };

  constructor(
    private readonly rig: TestRig,
    zone: string,
  ) {
    this.st = initialVoiceState({ transcribeModel: "test-transcribe" }, zone);
  }

  private now(): number {
    return this.rig.clock.read().opsClock.now;
  }

  /** A wire ID (43 characters), as the browser makes one. */
  private id(kind: string): string {
    this.n += 1;
    return testId(`call-${kind}-${this.n}`);
  }

  private fresh(prefix: string): string {
    this.n += 1;
    return `${prefix}${String(this.n).padStart(24, "0")}`;
  }

  /** Steps the machine with one event and runs every command that follows, until the call is still. */
  async ev(event: VoiceEvent): Promise<void> {
    this.feed(event);
    let budget = CALL_PUMP_LIMIT;
    while (this.queue.length > 0) {
      if ((budget -= 1) < 0) throw new Error("call: the machine did not settle");
      await this.run(this.queue.shift()!);
    }
  }

  private feed(event: VoiceEvent): void {
    const r = step(this.st, event, this.now());
    this.st = r.state;
    this.queue.push(...r.commands);
  }

  private async run(c: VoiceCommand): Promise<void> {
    const rid = (k: string) => this.id(k);
    switch (c.kind) {
      case "open": {
        const res = await callRoute(this.rig, openRoute, { ...c.body, requestId: rid("open") });
        this.log.answers.push({ route: "open", status: res.status, body: res.body });
        return this.feed(res.status === 200 ? { type: "openOk", response: res.body } : { type: "openFailed" });
      }
      case "connect":
        return this.feed({ type: "channelOpen" });
      case "state": {
        const sentAt = this.now();
        const res = await callRoute(this.rig, stateRoute, c.body);
        this.log.answers.push({ route: "state", status: res.status, body: res.body });
        return this.feed(res.status === 200 ? { type: "stateOk", response: res.body, sentAt } : { type: "stateFailed" });
      }
      case "turn": {
        const res = await callRoute(this.rig, turnRoute, { ...c.body, requestId: rid("req") });
        this.log.answers.push({ route: "turn", status: res.status, body: res.body });
        return this.feed(res.status === 200 ? { type: "turnOk", turnId: c.body.turnId, response: res.body } : { type: "turnFailed", turnId: c.body.turnId });
      }
      case "receipt": {
        const res = await callRoute(this.rig, receiptRoute, { ...c.body, requestId: rid("receipt") });
        this.log.answers.push({ route: "receipt", status: res.status, body: res.body });
        return;
      }
      case "close": {
        const res = await callRoute(this.rig, closeRoute, { ...c.body, requestId: rid("close") });
        this.log.answers.push({ route: "close", status: res.status, body: res.body });
        return;
      }
      case "verifyPermit":
        return this.feed({ type: "permitChecked", permitId: c.permitId, hash: sha256Hex(canonicalBytes(admissionPayload(c.payload))) });
      case "hashPayload":
        return this.feed({ type: "specHashed", eventId: c.eventId, hash: sha256Hex(canonicalBytes(admissionPayload(c.payload))) });
      case "send":
        if (c.event.type === "response.create") return this.playCreate(c.event);
        return;
      default:
        // Mute, mic, timers and teardown belong to the browser's shell; nothing here needs them.
        return;
    }
  }

  /** The model plays a created response to its end and reports its transcript. */
  private playCreate(e: RealtimeClientEvent): void {
    this.log.creates.push(e);
    const metadata = ((e.response as Record<string, unknown> | undefined)?.metadata ?? {}) as Record<string, string>;
    if (metadata.purpose !== "speech") return;
    const id = this.fresh("resp_");
    const text = spokenOf(e);
    const rt = (event: Record<string, unknown>) => this.feed({ type: "realtime", event: event as never, freshId: this.fresh("u") });
    rt({ type: "response.created", response: { id, metadata } });
    rt({ type: "output_audio_buffer.started", response_id: id });
    rt({ type: "response.output_audio_transcript.done", response_id: id, transcript: text });
    rt({ type: "output_audio_buffer.stopped", response_id: id });
    rt({ type: "response.done", response: { id, status: "completed", metadata } });
    this.log.heard.push(text);
  }

  /** Call pressed: the open, the channel, setup to its ack, and any opening line played. */
  async press(): Promise<void> {
    await this.ev({ type: "callPressed", zone: this.st.zone });
  }

  /** The owner stays quiet for `ms`, then the browser's poll goes out and its answer is handled. */
  async quiet(ms: number): Promise<void> {
    this.rig.clock.advance(ms);
    await this.ev({ type: "timer", name: "poll" });
  }

  /** A line typed into the box during the call. */
  async type(text: string): Promise<void> {
    await this.ev({ type: "typedSubmitted", turnId: this.id("turn"), text, source: "typed" });
  }

  /** Hang up. */
  async hangUp(): Promise<void> {
    await this.ev({ type: "hangupPressed" });
  }

  /** Takes and clears what the call did since the last take. */
  take(): CallLog {
    const l = this.log;
    this.log = { answers: [], creates: [], heard: [] };
    return l;
  }
}
