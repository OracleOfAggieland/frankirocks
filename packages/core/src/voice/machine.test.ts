import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RECOVERY_LINE, payloadHash } from "../admission";
import { type Hasher, canonicalJSON } from "../ids";
import { tsFromMs } from "../schema/primitives";
import type { Deck, Permit, TurnResponse } from "../schema/wire";
import type { Infer } from "../schema/v";
import { sampleHead, testId } from "../testing/samples";
import {
  ACK_LIMIT_MS,
  CONNECT_LIMIT_MS,
  MAX_RECENT_RESPONSES,
  type RealtimeServerEvent,
  TOOL_LIMIT_MS,
  type VoiceCommand,
  type VoiceEvent,
  type VoiceState,
  avatarState,
  initialVoiceState,
  localStamp,
  permitProblem,
  step,
} from "./machine";

const hasher: Hasher = {
  id: (parts) => createHash("sha256").update(canonicalJSON(parts)).digest("base64url"),
  sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
};

const T = Date.UTC(2026, 10, 3, 12);
const SID = testId("session");
const CONFIG = { transcribeModel: "test-transcribe-model" };

function deckAt(issued: number, revs: Partial<Deck> = {}): Deck {
  return {
    epoch: 1,
    policyRev: 1,
    generation: 1,
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

const ss = (d: Deck) => ({ sessionId: SID, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: d.generation });
const ackAt = (d: Deck, at: number) => ({ stamp: ss(d), issuedOpsAt: tsFromMs(at), expiresOpsAt: tsFromMs(at + 2500) });

/** Runs events in order, collecting every command; `now` per event. */
class Rig {
  st: VoiceState = initialVoiceState(CONFIG, "America/Chicago");
  now = T;
  log: VoiceCommand[] = [];
  last: VoiceCommand[] = [];

  ev(event: VoiceEvent, advanceMs = 0): VoiceCommand[] {
    this.now += advanceMs;
    const r = step(this.st, event, this.now);
    this.st = r.state;
    this.last = r.commands;
    this.log.push(...r.commands);
    return r.commands;
  }
  rt(event: RealtimeServerEvent, advanceMs = 0, freshId = testId(`turn${this.log.length}`)): VoiceCommand[] {
    return this.ev({ type: "realtime", event, freshId }, advanceMs);
  }
  timer(name: Parameters<typeof step>[1] extends infer E ? (E extends { type: "timer"; name: infer N } ? N : never) : never, advanceMs = 0) {
    return this.ev({ type: "timer", name }, advanceMs);
  }
}

/** Signed-in call up to LISTENING; pass a closed Rig to start its next call. */
function listening(r = new Rig()): Rig {
  r.ev({ type: "callPressed", zone: "America/Chicago" });
  const deck = deckAt(r.now + 200);
  r.ev({ type: "openOk", response: { sessionId: SID, generation: 1, deck, state: "connecting", ack: ackAt(deck, r.now + 200), proactive: null } }, 200);
  r.ev({ type: "channelOpen" }, 300);
  r.ev({ type: "stateOk", response: { stamp: ss(deck), state: "LISTENING", deck: deckAt(r.now + 100), ack: ackAt(deck, r.now + 100), barrierReceiptId: null, proactive: null } }, 100);
  expect(r.st.phase).toBe("LISTENING");
  return r;
}

function turnBody(r: Rig) {
  const c = [...r.log].reverse().find((x) => x.kind === "turn");
  if (c === undefined || c.kind !== "turn") throw new Error("no turn posted");
  return c.body;
}

/** The server's response with a Permit computed the way devAdmit does. */
function admitted(r: Rig, kind: Permit["kind"], tamper: Partial<Permit> = {}): Infer<typeof TurnResponse> {
  const body = turnBody(r);
  const stamp = localStamp(r.st)!;
  const deck = r.st.deck!;
  const audioIds = [...body.items].sort((a, b) => a.commitSeq - b.commitSeq).map((i) => i.itemId);
  const hash = payloadHash({ stamp, head: deck.head, notes: [], turns: deck.turns, audioIds, toolOutput: null }, hasher);
  const permit: Permit = {
    permitId: testId("permit"),
    stamp,
    kind,
    scope: "reply",
    approvedPayloadHash: hash,
    noteIds: [],
    momentIds: [],
    expiresAt: tsFromMs(r.now + 10_000),
    ...tamper,
  };
  return { requestId: testId("req"), stamp, status: "ordinary", deck, permit, notes: [], cards: [], pendingId: null, question: null, retryAfterMs: 0, receiptId: null, error: null };
}

/** Answers a verifyPermit command with the real hash of its payload. */
function answerVerify(r: Rig, override?: string): VoiceCommand[] {
  const c = r.last.find((x) => x.kind === "verifyPermit");
  if (c === undefined || c.kind !== "verifyPermit") throw new Error("no verifyPermit");
  return r.ev({ type: "permitChecked", permitId: c.permitId, hash: override ?? payloadHash(c.payload, hasher) });
}

const sends = (cmds: VoiceCommand[]) => cmds.flatMap((c) => (c.kind === "send" ? [c.event] : []));

/** Speech to a recorded, transcribed item: posts the TurnRequest. */
function speak(r: Rig, itemId = "item_1", text = "My dog is called Pip") {
  r.rt({ type: "input_audio_buffer.speech_started", item_id: itemId, audio_start_ms: 1000 });
  r.rt({ type: "input_audio_buffer.speech_stopped", item_id: itemId, audio_end_ms: 2400 }, 1400);
  r.rt({ type: "input_audio_buffer.committed", item_id: itemId }, 10);
  r.rt({ type: "conversation.item.added", item: { id: itemId } }, 50);
  r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: itemId, transcript: text }, 400);
}

/** Up to SPEAKING with a verified slowOrdinary Permit. */
function speaking(): Rig {
  const r = listening();
  speak(r);
  r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: admitted(r, "slowOrdinary") }, 100);
  answerVerify(r);
  const turnId = localStamp(r.st)!.turnId;
  r.rt({ type: "response.created", response: { id: "resp_1", metadata: { purpose: "speech", turnId, generation: "1", noteIds: "" } } }, 20);
  r.rt({ type: "output_audio_buffer.started", response_id: "resp_1" }, 200);
  expect(r.st.phase).toBe("SPEAKING");
  return r;
}

/** The final transcript of each message a response spoke, in order. */
function spoke(r: Rig, responseId: string, ...texts: string[]): void {
  for (const transcript of texts) r.rt({ type: "response.output_audio_transcript.done", response_id: responseId, transcript });
}

/** From LISTENING, one more spoken Turn up to `response.created` for `resp_<n>`; returns that event's commands. */
function replyTo(r: Rig, n: number): VoiceCommand[] {
  speak(r, `item_${n}`, `Line ${n}`);
  r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: admitted(r, "slowOrdinary") }, 100);
  answerVerify(r);
  return r.rt({ type: "response.created", response: { id: `resp_${n}`, metadata: { purpose: "speech", turnId: localStamp(r.st)!.turnId, generation: "1", noteIds: "" } } }, 20);
}

const responseDone = (id: string): RealtimeServerEvent => ({ type: "response.done", response: { id, metadata: { purpose: "speech", generation: "1" } } });

const transcripts = (cmds: VoiceCommand[]) => cmds.flatMap((c) => (c.kind === "receipt" && c.body.kind === "transcript" ? [c.body] : []));

describe("voice state machine", () => {
  it("one voice turn: final transcript → TurnRequest → verified Permit → one response.create → unmute", () => {
    const r = listening();
    speak(r);
    expect(r.st.phase).toBe("HELD");
    expect(avatarState(r.st)).toBe("thinking");
    const body = turnBody(r);
    expect(body).toMatchObject({ source: "asr", judge: "timeout", transcriptState: "final", transcript: "My dog is called Pip", clientSeq: 1 });
    expect(body.items).toEqual([{ itemId: "item_1", commitSeq: 1, final: true, audioEndOpsAt: expect.any(String), audioDurationMs: 1400 }]);

    r.ev({ type: "turnOk", turnId: body.turnId, response: admitted(r, "slowOrdinary") }, 100);
    expect(r.last.some((c) => c.kind === "send")).toBe(false); // nothing before the hash check
    const created = sends(answerVerify(r));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: "response.create",
      response: { conversation: "none", instructions: sampleHead().text, input: [{ type: "item_reference", id: "item_1" }], metadata: { purpose: "speech", turnId: body.turnId, generation: "1" } },
    });
    expect(r.st.outputMuted).toBe(true);

    r.rt({ type: "response.created", response: { id: "resp_1", metadata: { purpose: "speech", turnId: body.turnId, generation: "1", noteIds: "" } } });
    const start = r.rt({ type: "output_audio_buffer.started", response_id: "resp_1" }, 200);
    expect(start[0]).toEqual({ kind: "unmuteOutput" });
    expect(start).toContainEqual(expect.objectContaining({ kind: "receipt", body: expect.objectContaining({ kind: "playbackStarted", responseId: "resp_1", permitKind: "slowOrdinary" }) }));
    expect(avatarState(r.st)).toBe("speaking");

    const stop = r.rt({ type: "output_audio_buffer.stopped", response_id: "resp_1" }, 2000);
    expect(stop[0]).toEqual({ kind: "muteOutput" });
    expect(stop).toContainEqual(expect.objectContaining({ kind: "receipt", body: expect.objectContaining({ kind: "playbackEnded" }) }));
    expect(r.st.phase).toBe("LISTENING");
  });

  it("a response that speaks two messages sends one transcript receipt with both, in order, at response.done", () => {
    const r = speaking();
    const meta = { purpose: "speech", turnId: r.st.active!.permit.stamp.turnId, generation: "1" };
    expect(r.rt({ type: "response.output_audio_transcript.done", response_id: "resp_1", transcript: "Okay, let me note that." })).toEqual([]);
    expect(r.rt({ type: "response.output_audio_transcript.done", response_id: "resp_1", transcript: " Your dog is called Pip. " })).toEqual([]);
    const done = r.rt({ type: "response.done", response: { id: "resp_1", metadata: meta } });
    expect(done.filter((c) => c.kind === "receipt")).toEqual([
      { kind: "receipt", body: expect.objectContaining({ kind: "transcript", responseId: "resp_1", text: "Okay, let me note that. Your dog is called Pip." }) },
    ]);
    // A second response.done sends nothing more; a transcript that comes after it is sent on its own.
    expect(r.rt({ type: "response.done", response: { id: "resp_1", metadata: meta } }).filter((c) => c.kind === "receipt")).toEqual([]);
    expect(r.rt({ type: "response.output_audio_transcript.done", response_id: "resp_1", transcript: "Late." })).toEqual([
      { kind: "receipt", body: expect.objectContaining({ kind: "transcript", responseId: "resp_1", text: "Late." }) },
    ]);
    // An unknown response's transcript is dropped.
    expect(r.rt({ type: "response.output_audio_transcript.done", response_id: "resp_x", transcript: "Not ours." })).toEqual([]);
  });

  it("a response pushed out of `recent` before its response.done sends what it held, once", () => {
    const r = speaking();
    spoke(r, "resp_1", "Okay, let me note that.", "Your dog is called Pip.");
    r.rt({ type: "output_audio_buffer.stopped", response_id: "resp_1" }, 1500);
    // resp_1's response.done never comes; later replies finish normally until it is the oldest one kept.
    for (let n = 2; n <= MAX_RECENT_RESPONSES; n++) {
      replyTo(r, n);
      r.rt(responseDone(`resp_${n}`));
    }
    expect(transcripts(r.log)).toEqual([]);
    expect(transcripts(replyTo(r, MAX_RECENT_RESPONSES + 1))).toEqual([
      expect.objectContaining({ responseId: "resp_1", text: "Okay, let me note that. Your dog is called Pip." }),
    ]);
    expect(r.st.recent.map((x) => x.responseId)).not.toContain("resp_1");
    expect(transcripts(r.rt(responseDone("resp_1")))).toEqual([]);
  });

  it("hanging up sends what a response still held after teardown and before close, and never again", () => {
    const r = speaking();
    const stamp = r.st.active!.permit.stamp;
    spoke(r, "resp_1", "Okay, let me note that.", "Your dog is called Pip.");
    const cmds = r.ev({ type: "hangupPressed" });
    expect(cmds.map((c) => c.kind)).toEqual(["muteOutput", "teardown", "receipt", "close"]);
    expect(transcripts(cmds)).toEqual([expect.objectContaining({ stamp, responseId: "resp_1", text: "Okay, let me note that. Your dog is called Pip." })]);
    // The next call's replies push resp_1 out of `recent` without a second receipt.
    r.ev({ type: "closeDone" });
    listening(r);
    for (let n = 2; n <= MAX_RECENT_RESPONSES + 1; n++) {
      replyTo(r, n);
      r.rt(responseDone(`resp_${n}`));
    }
    expect(r.st.recent.map((x) => x.responseId)).not.toContain("resp_1");
    expect(transcripts(r.log).map((b) => b.responseId)).toEqual(["resp_1"]);
  });

  it("a lost connection or closed data channel sends what a response still held before close, and never again", () => {
    const r = speaking();
    const stamp = r.st.active!.permit.stamp;
    spoke(r, "resp_1", "Okay, let me note that.");
    const cmds = r.ev({ type: "connectionLost" });
    expect(cmds.map((c) => c.kind).filter((k) => k !== "armTimer")).toEqual(["muteOutput", "teardown", "receipt", "close"]);
    expect(transcripts(cmds)).toEqual([expect.objectContaining({ stamp, responseId: "resp_1", text: "Okay, let me note that." })]);
    expect(r.st.phase).toBe("RECOVERY");
    // Hanging up during recovery sends nothing more.
    expect(r.ev({ type: "hangupPressed" }).filter((c) => c.kind === "receipt")).toEqual([]);
  });

  it("barge-in mutes before anything else, cancels each recorded response, then clears", () => {
    const r = speaking();
    const cmds = r.rt({ type: "input_audio_buffer.speech_started", item_id: "item_2", audio_start_ms: 5000 });
    expect(cmds[0]).toEqual({ kind: "muteOutput" });
    const cancelAt = cmds.findIndex((c) => c.kind === "send" && c.event.type === "response.cancel");
    const clearAt = cmds.findIndex((c) => c.kind === "send" && c.event.type === "output_audio_buffer.clear");
    expect(cancelAt).toBeGreaterThan(0);
    expect(clearAt).toBeGreaterThan(cancelAt);
    expect(sends(cmds)[0]).toEqual({ type: "response.cancel", response_id: "resp_1" });
    expect(cmds).toContainEqual(expect.objectContaining({ kind: "receipt", body: expect.objectContaining({ kind: "playbackEnded", responseId: "resp_1" }) }));
    expect(r.st.phase).toBe("LISTENING");
    expect(r.st.active).toBeNull();
  });

  it("barge-in while a response is in flight before audio sends a cancelled receipt", () => {
    const r = listening();
    speak(r);
    r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: admitted(r, "slowOrdinary") });
    answerVerify(r);
    r.rt({ type: "response.created", response: { id: "resp_9", metadata: { purpose: "speech", turnId: localStamp(r.st)!.turnId, generation: "1" } } });
    const cmds = r.rt({ type: "input_audio_buffer.speech_started" });
    expect(cmds[0]).toEqual({ kind: "muteOutput" });
    expect(sends(cmds)).toEqual([{ type: "response.cancel", response_id: "resp_9" }, { type: "output_audio_buffer.clear" }]);
    expect(cmds).toContainEqual(expect.objectContaining({ kind: "receipt", body: expect.objectContaining({ kind: "cancelled" }) }));
  });

  it("600 ms → HELD when committed has no matching item.added", () => {
    const r = listening();
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_1" });
    expect(r.st.phase).toBe("WAIT_ITEM");
    r.timer("item", 599);
    expect(r.st.phase).toBe("WAIT_ITEM"); // early timer is ignored
    r.timer("item", 1);
    expect(r.st.phase).toBe("HELD");
    expect(r.st.outputMuted).toBe(true);
    expect(r.log.some((c) => c.kind === "send" && c.event.type === "response.create")).toBe(false);
    expect(r.log.some((c) => c.kind === "turn")).toBe(false); // admission still waits for the transcript
  });

  it("any item missing a transcript at t_end+1.5 s → RECOVERY with recoveryOnly and only the neutral line", () => {
    const r = listening();
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_1" });
    r.rt({ type: "conversation.item.added", item: { id: "item_1" } }, 30);
    // Speech resumes before the transcript: the next item joins the Turn and t_end resets.
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_2" }, 470);
    r.rt({ type: "conversation.item.added", item: { id: "item_2" } }, 30);
    r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "hello" }, 100);
    expect(r.log.some((c) => c.kind === "turn")).toBe(false); // item_2 has no transcript yet
    r.timer("transcript", 900); // 1.5 s after item_1's commit, but only 1.03 s after t_end
    expect(r.st.phase).toBe("HELD");
    r.timer("transcript", 470);
    expect(r.st.phase).toBe("RECOVERY");
    expect(avatarState(r.st)).toBe("recovery");
    const body = turnBody(r);
    expect(body).toMatchObject({ transcriptState: "missing", transcript: "" });
    expect(body.items.map((i) => [i.itemId, i.commitSeq, i.final])).toEqual([
      ["item_1", 1, false],
      ["item_2", 2, false],
    ]);
    expect(r.log.filter((c) => c.kind === "turn")).toHaveLength(1);

    // A transcript that arrives later is dropped.
    r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_2", transcript: "late" }, 10);
    expect(r.st.turn!.items[1]!.transcript).toBeNull();

    r.ev({ type: "turnOk", turnId: body.turnId, response: admitted(r, "recoveryOnly") }, 100);
    const created = sends(answerVerify(r));
    expect(created).toEqual([
      { type: "response.create", response: expect.objectContaining({ conversation: "none", input: [], tools: [], instructions: expect.stringContaining(RECOVERY_LINE) }) },
    ]);
    r.rt({ type: "response.created", response: { id: "resp_r", metadata: { purpose: "speech", turnId: body.turnId, generation: "1" } } });
    expect(r.rt({ type: "output_audio_buffer.started", response_id: "resp_r" })[0]).toEqual({ kind: "unmuteOutput" });
    r.rt({ type: "output_audio_buffer.stopped", response_id: "resp_r" }, 1500);
    expect(r.st.phase).toBe("LISTENING");
  });

  it("a transcription failure posts transcriptState failed and enters RECOVERY", () => {
    const r = listening();
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_1" });
    r.rt({ type: "conversation.item.input_audio_transcription.failed", item_id: "item_1" }, 200);
    expect(turnBody(r)).toMatchObject({ transcriptState: "failed", transcript: "" });
    expect(r.st.phase).toBe("RECOVERY");
  });

  it("a slowOrdinary Permit never plays the recovery path, and recoveryOnly never plays speech", () => {
    const r = listening();
    speak(r);
    r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: admitted(r, "recoveryOnly") });
    expect(r.last.some((c) => c.kind === "verifyPermit")).toBe(false);
    expect(r.st.phase).toBe("LISTENING");
  });

  it("higher stamp cancels and clears, then sends the new Head", () => {
    const r = speaking();
    const higher = deckAt(r.now, { bundleRev: 2, head: { ...sampleHead(), text: "You are Franki, v2." } });
    const cmds = r.ev({ type: "stateOk", response: { stamp: ss(higher), state: "SPEAKING", deck: higher, ack: ackAt(higher, r.now), barrierReceiptId: null, proactive: null } });
    expect(cmds[0]).toEqual({ kind: "muteOutput" });
    expect(sends(cmds).slice(0, 2)).toEqual([{ type: "response.cancel", response_id: "resp_1" }, { type: "output_audio_buffer.clear" }]);
    expect(sends(cmds)[2]).toMatchObject({ type: "session.update", session: { instructions: "You are Franki, v2." } });
    expect(r.st.deck!.bundleRev).toBe(2);
    expect(r.st.active).toBeNull();
    expect(r.st.phase).toBe("HELD");
    // Old audio cannot unmute again.
    expect(r.rt({ type: "output_audio_buffer.started", response_id: "resp_1" })).toEqual([]);
  });

  it("a lower or equal Deck changes nothing in flight", () => {
    const r = speaking();
    const same = deckAt(r.now);
    const cmds = r.ev({ type: "stateOk", response: { stamp: ss(same), state: "SPEAKING", deck: same, ack: ackAt(same, r.now), barrierReceiptId: null, proactive: null } });
    expect(sends(cmds)).toEqual([]);
    expect(r.st.phase).toBe("SPEAKING");
  });

  it("wrong generation dropped: no audio, no tool dispatch, no state change", () => {
    const r = listening();
    speak(r);
    r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: admitted(r, "slowOrdinary") });
    answerVerify(r);
    const before = r.st;
    const turnId = localStamp(r.st)!.turnId;
    const cmds = r.rt({ type: "response.created", response: { id: "resp_old", metadata: { purpose: "speech", turnId, generation: "0" } } });
    expect(cmds).toEqual([{ kind: "send", event: { type: "response.cancel", response_id: "resp_old" } }]);
    expect(r.st).toBe(before);
    expect(r.rt({ type: "output_audio_buffer.started", response_id: "resp_old" })).toEqual([]);
    expect(r.rt({ type: "response.function_call_arguments.done", response_id: "resp_old", call_id: "c1", name: "recall", arguments: "{}" })).toEqual([]);
    expect(r.st).toBe(before);
    expect(r.st.outputMuted).toBe(true);
  });

  it("Permit mismatch plays nothing: payload hash, Stamp and expiry", () => {
    // Hash mismatch.
    const a = listening();
    speak(a);
    a.ev({ type: "turnOk", turnId: turnBody(a).turnId, response: admitted(a, "slowOrdinary") });
    const cmds = answerVerify(a, "f".repeat(64));
    expect(sends(cmds).some((e) => e.type === "response.create")).toBe(false);
    expect(a.st.phase).toBe("LISTENING");
    expect(a.st.outputMuted).toBe(true);

    // Stamp mismatch (another Turn): never even hashed.
    const b = listening();
    speak(b);
    const wrong = admitted(b, "slowOrdinary", { stamp: { ...localStamp(b.st)!, turnId: testId("other") } });
    b.ev({ type: "turnOk", turnId: turnBody(b).turnId, response: wrong });
    expect(b.last.some((c) => c.kind === "verifyPermit" || c.kind === "send")).toBe(false);

    // Expired by the time audio would start: cancelled, cleared, stays muted.
    const c = listening();
    speak(c);
    c.ev({ type: "turnOk", turnId: turnBody(c).turnId, response: admitted(c, "slowOrdinary") });
    answerVerify(c);
    c.rt({ type: "response.created", response: { id: "resp_1", metadata: { purpose: "speech", turnId: localStamp(c.st)!.turnId, generation: "1" } } });
    const late = c.rt({ type: "output_audio_buffer.started", response_id: "resp_1" }, 10_000);
    expect(late.some((x) => x.kind === "unmuteOutput")).toBe(false);
    expect(sends(late)).toEqual([{ type: "response.cancel", response_id: "resp_1" }, { type: "output_audio_buffer.clear" }]);
    expect(c.st.outputMuted).toBe(true);
  });

  it("CONNECTING timer starts at the open response, not the press", () => {
    const r = new Rig();
    r.ev({ type: "callPressed", zone: "UTC" });
    expect(r.st.phase).toBe("CONNECTING");
    // A slow open (4 s) must not eat into the 5 s setup limit.
    const deck = deckAt(r.now + 4000);
    const cmds = r.ev({ type: "openOk", response: { sessionId: SID, generation: 1, deck, state: "connecting", ack: ackAt(deck, r.now + 4000), proactive: null } }, 4000);
    expect(cmds).toContainEqual({ kind: "armTimer", name: "connect", at: r.now + CONNECT_LIMIT_MS });
    r.timer("connect", 4999);
    expect(r.st.phase).toBe("CONNECTING");
    r.timer("connect", 1);
    expect(r.st.phase).toBe("RECOVERY");
    expect(r.last[0]).toEqual({ kind: "muteOutput" });
    expect(r.last).toContainEqual({ kind: "close", body: { sessionId: SID, generation: 1, reason: "error" } });
    expect(r.last).toContainEqual({ kind: "armTimer", name: "reconnect", at: r.now + 1000 });
  });

  it("open that fails or takes over 5 s shows the closed state with the open error (R16.6)", () => {
    const r = new Rig();
    r.ev({ type: "callPressed", zone: "UTC" });
    r.timer("openWait", 5000);
    expect(r.st).toMatchObject({ phase: "CLOSED", error: "open" });
    expect(r.last).toContainEqual({ kind: "teardown" });
  });

  it("no matching ack within 1.5 s of session.update closes with error and enters RECOVERY (R13.9)", () => {
    const r = new Rig();
    r.ev({ type: "callPressed", zone: "UTC" });
    const deck = deckAt(r.now);
    r.ev({ type: "openOk", response: { sessionId: SID, generation: 1, deck, state: "connecting", ack: ackAt(deck, r.now), proactive: null } });
    const cfg = r.ev({ type: "channelOpen" }, 500);
    const update = sends(cfg)[0]!;
    expect(update).toMatchObject({
      type: "session.update",
      session: {
        type: "realtime",
        tracing: null,
        instructions: sampleHead().text,
        audio: { input: { noise_reduction: { type: "near_field" }, transcription: { model: "test-transcribe-model", language: "en" }, turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: false, interrupt_response: false } } },
      },
    });
    expect(update.session).not.toHaveProperty("model");
    expect(update.session).not.toHaveProperty("voice");
    expect((update.session as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(["recall"]);
    r.timer("ack", ACK_LIMIT_MS);
    expect(r.st.phase).toBe("RECOVERY");
    expect(r.log.some((c) => c.kind === "unmuteOutput")).toBe(false);
    expect(r.last).toContainEqual({ kind: "close", body: { sessionId: SID, generation: 1, reason: "error" } });
  });

  it("expired Deck builds no reply until a refresh returns a fresh one", () => {
    const r = listening();
    speak(r);
    // The Permit is still valid; only the held Deck has passed its 60 s expiry.
    const res = admitted(r, "slowOrdinary", { expiresAt: tsFromMs(r.now + 120_000) });
    r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: { ...res, deck: null } }, 60_000);
    expect(r.last.some((c) => c.kind === "verifyPermit" || c.kind === "send")).toBe(false);
    expect(r.st.phase).toBe("LISTENING");

    // A refresh with a fresh Deck: the next Turn gets its reply.
    const fresh = deckAt(r.now);
    r.ev({ type: "stateOk", response: { stamp: ss(fresh), state: "LISTENING", deck: fresh, ack: ackAt(fresh, r.now), barrierReceiptId: null, proactive: null } });
    speak(r, "item_2", "Pip again");
    r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: admitted(r, "slowOrdinary") });
    expect(sends(answerVerify(r)).map((e) => e.type)).toEqual(["response.create"]);
  });

  it("an expired Deck is reported as deckExpired by the Permit check", () => {
    const r = listening();
    speak(r);
    const res = admitted(r, "slowOrdinary", { expiresAt: tsFromMs(T + 120_000) });
    r.now += 61_000;
    expect(permitProblem(r.st, { permit: res.permit!, purpose: "speech", notes: [], toolCall: null, toolOutput: null }, null, r.now)).toBe("deckExpired");
  });

  it("fastO needs a matching ack younger than 2.5 s (KV13); other kinds do not", () => {
    const r = listening();
    speak(r);
    const res = admitted(r, "fastO", { expiresAt: tsFromMs(r.now + 10_000) });
    const reply = { permit: res.permit!, purpose: "speech" as const, notes: [], toolCall: null, toolOutput: null };
    r.st = { ...r.st, ack: ackAt(r.st.deck!, r.now - 2500) };
    expect(permitProblem(r.st, reply, null, r.now)).toBe("ack");
    r.st = { ...r.st, ack: { ...ackAt(r.st.deck!, r.now), stamp: { ...ss(r.st.deck!), bundleRev: 9 } } };
    expect(permitProblem(r.st, reply, null, r.now)).toBe("ack");
    r.st = { ...r.st, ack: ackAt(r.st.deck!, r.now - 1000) };
    expect(permitProblem(r.st, reply, null, r.now)).toBeNull();
    const slow = { ...reply, permit: { ...reply.permit, kind: "slowOrdinary" as const } };
    r.st = { ...r.st, ack: null };
    expect(permitProblem(r.st, slow, null, r.now)).toBeNull();
  });

  it("mute only touches the microphone track", () => {
    const r = speaking();
    expect(r.ev({ type: "mutePressed" })).toEqual([{ kind: "setMic", enabled: false }]);
    expect(r.st).toMatchObject({ micMuted: true, outputMuted: false, phase: "SPEAKING" });
    expect(r.ev({ type: "mutePressed" })).toEqual([{ kind: "setMic", enabled: true }]);
  });

  it("recall call → TOOL_WAIT → /api/tool; a ready result with a Permit continues with function_call_output", () => {
    const r = speaking();
    const turnId = localStamp(r.st)!.turnId;
    const args = JSON.stringify({ purpose: "answer", query: "dog", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" });
    const cmds = r.rt({ type: "response.function_call_arguments.done", response_id: "resp_1", call_id: "call_1", name: "recall", arguments: args });
    expect(r.st.phase).toBe("TOOL_WAIT");
    expect(cmds).toContainEqual(expect.objectContaining({ kind: "tool", body: expect.objectContaining({ callId: "call_1", tool: { name: "recall", args: JSON.parse(args) } }) }));
    const result = { name: "recall" as const, notes: [], coverage: { state: "complete" as const, from: null, to: null, missingRanges: [], generation: 0 }, truncated: false, cursor: null, pendingId: null, snapshot: null, cards: [] };
    const stamp = localStamp(r.st)!;
    const deck = r.st.deck!;
    const hash = payloadHash({ stamp, head: deck.head, notes: [], turns: deck.turns, audioIds: ["item_1"], toolOutput: result }, hasher);
    const permit: Permit = { permitId: testId("p2"), stamp, kind: "slowOrdinary", scope: "reply", approvedPayloadHash: hash, noteIds: [], momentIds: [], expiresAt: tsFromMs(r.now + 10_000) };
    r.ev({ type: "toolOk", callId: "call_1", response: { stamp, callId: "call_1", status: "ready", result, deck: null, permit } }, 300);
    expect(r.st.phase).toBe("HELD");
    const created = sends(answerVerify(r));
    expect(created).toHaveLength(1);
    const input = (created[0]!.response as { input: { type: string }[] }).input;
    expect(input.map((i) => i.type)).toEqual(["item_reference", "function_call", "function_call_output"]);
    expect(turnId).toBe(stamp.turnId);
  });

  it("waits TOOL_LIMIT_MS for a recall result, even after the words said before the call finish playing", () => {
    const r = speaking();
    const cmds = r.rt({ type: "response.function_call_arguments.done", response_id: "resp_1", call_id: "call_1", name: "recall", arguments: "{}" });
    expect(cmds).toContainEqual({ kind: "armTimer", name: "tool", at: r.now + TOOL_LIMIT_MS });
    // "Let me check" ends after 1.5 s; the result is still on its way.
    r.rt({ type: "output_audio_buffer.stopped", response_id: "resp_1" }, 1500);
    expect(r.st.phase).toBe("TOOL_WAIT");
    expect(avatarState(r.st)).toBe("thinking");
  });

  it("a stale tool result requests no reply (R27.10)", () => {
    const r = speaking();
    r.rt({ type: "response.function_call_arguments.done", response_id: "resp_1", call_id: "call_1", name: "recall", arguments: "{}" });
    const stamp = localStamp(r.st)!;
    const cmds = r.ev({ type: "toolOk", callId: "call_1", response: { stamp, callId: "call_1", status: "stale", result: null, deck: null, permit: null } });
    expect(cmds.some((c) => c.kind === "verifyPermit" || c.kind === "send")).toBe(false);
    expect(r.st.phase).toBe("LISTENING");
  });

  it("hang up stops the mic and connection before posting close; presses are ignored until close answers", () => {
    const r = speaking();
    const cmds = r.ev({ type: "hangupPressed" });
    expect(cmds.map((c) => c.kind)).toEqual(["muteOutput", "teardown", "close"]);
    expect(r.st.phase).toBe("CLOSED");
    expect(r.ev({ type: "callPressed", zone: "UTC" })).toEqual([]);
    r.ev({ type: "closeDone" });
    expect(r.ev({ type: "callPressed", zone: "UTC" })[0]).toMatchObject({ kind: "open", body: { previousSessionId: SID } });
  });

  it("state refresh failures keep the ack and retry after 1, 2 and 5 s, with a retry control at 30 s (R13.8)", () => {
    const r = listening();
    const ack = r.st.ack;
    r.timer("refresh", 45_000);
    expect(r.last[0]).toMatchObject({ kind: "state" });
    r.ev({ type: "stateFailed" }, 1500);
    expect(r.st.ack).toBe(ack);
    expect(r.last).toContainEqual({ kind: "armTimer", name: "stateRetry", at: r.now + 1000 });
    r.timer("stateRetry", 1000);
    r.ev({ type: "stateFailed" }, 1500);
    expect(r.last).toContainEqual({ kind: "armTimer", name: "stateRetry", at: r.now + 2000 });
    r.timer("stateRetryUi", 30_000);
    expect(r.st.stateRetryVisible).toBe(true);
  });

  it("connection loss mutes, reconnects with a new open, and shows the retry button at 30 s (R15.8)", () => {
    const r = speaking();
    const cmds = r.ev({ type: "connectionLost" });
    expect(cmds[0]).toEqual({ kind: "muteOutput" });
    expect(r.st.phase).toBe("RECOVERY");
    expect(r.st.active).toBeNull();
    r.timer("reconnect", 1000);
    expect(r.last).toContainEqual(expect.objectContaining({ kind: "open", body: expect.objectContaining({ previousSessionId: SID }) }));
    expect(avatarState(r.st)).toBe("recovery");
    r.ev({ type: "openFailed" }, 500);
    expect(r.last).toContainEqual({ kind: "armTimer", name: "reconnect", at: r.now + 2000 });
    r.timer("retryUi", 28_500);
    expect(r.st.retryVisible).toBe(true);
  });
});
