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
  ADMITTED_TRANSCRIPT_LIMIT_MS,
  CONNECT_LIMIT_MS,
  HELD_TRANSCRIPT_LIMIT_MS,
  JUDGE_LIMIT_MS,
  LATE_TURN_MS,
  MAX_RECENT_RESPONSES,
  MISSING_WINDOW_MS,
  POLL_MS,
  type RealtimeServerEvent,
  TOOL_LIMIT_MS,
  TURN_RESPONSE_LIMIT_MS,
  type VoiceCommand,
  type VoiceEvent,
  type VoiceState,
  avatarState,
  initialVoiceState,
  localStamp,
  permitProblem,
  replyCreate,
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

/** The server's response with a Permit computed the way the Admission_Seam does. */
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
    // The judge and the speculative reply are out at the commit; posting the transcript leaves them running (R2.1).
    expect(r.st.phase).toBe("SPECULATING");
    expect(avatarState(r.st)).toBe("thinking");
    const body = turnBody(r);
    expect(body).toMatchObject({ source: "asr", judge: "timeout", transcriptState: "final", transcript: "My dog is called Pip", clientSeq: 1 });
    expect(body.items).toEqual([{ itemId: "item_1", commitSeq: 1, final: true, audioEndOpsAt: expect.any(String), audioDurationMs: 1400 }]);

    r.ev({ type: "turnOk", turnId: body.turnId, response: admitted(r, "slowOrdinary") }, 100);
    expect(sends(r.last).some((e) => e.type === "response.create")).toBe(false); // nothing before the hash check
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

  it("any item missing a transcript at t_end+2.5 s → RECOVERY with recoveryOnly and only the neutral line", () => {
    const r = listening();
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_1" });
    r.rt({ type: "conversation.item.added", item: { id: "item_1" } }, 30);
    // Speech resumes before the transcript: the next item joins the Turn and t_end resets.
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_2" }, 470);
    r.rt({ type: "conversation.item.added", item: { id: "item_2" } }, 30);
    r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "hello" }, 100);
    expect(r.log.some((c) => c.kind === "turn")).toBe(false); // item_2 has no transcript yet
    r.timer("transcript", 1_900); // 2.5 s after item_1's commit, but only 2.03 s after t_end (R7.4)
    expect(r.st.phase).toBe("SPECULATING");
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

    // R7.8: a transcript that arrives later doesn't change the posted Turn; it goes out once as a superseding post.
    const late = r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_2", transcript: "late" }, 10);
    expect(r.st.turn!.items[1]!.transcript).toBeNull();
    expect(late).toContainEqual(expect.objectContaining({ kind: "turn", supersedesTurnId: body.turnId, body: expect.objectContaining({ turnId: body.turnId, clientSeq: body.clientSeq, transcriptState: "final", transcript: "hello late" }) }));

    r.ev({ type: "turnOk", turnId: body.turnId, response: admitted(r, "recoveryOnly") }, 100);
    const created = sends(answerVerify(r));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ type: "response.create", response: expect.objectContaining({ conversation: "none", input: [], tools: [], instructions: expect.stringContaining(RECOVERY_LINE) }) });
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
    // A recoveryOnly answer to a held Turn plays only the neutral line, with no tools (R7.4, R10.2).
    r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: admitted(r, "recoveryOnly") });
    expect(r.st.phase).toBe("RECOVERY");
    const created = sends(answerVerify(r));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ response: { input: [], tools: [], instructions: expect.stringContaining(RECOVERY_LINE) } });
    // A slowOrdinary Permit can't play while RECOVERY waits for the neutral line.
    expect(permitProblem(r.st, { permit: admitted(r, "slowOrdinary").permit!, purpose: "recovery", notes: [], toolCall: null, toolOutput: null }, null, r.now)).toBe("kind");
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
    // Old audio cannot unmute again; it is only cancelled.
    expect(r.rt({ type: "output_audio_buffer.started", response_id: "resp_1" })).toEqual([{ kind: "send", event: { type: "response.cancel", response_id: "resp_1" } }]);
    expect(r.st.outputMuted).toBe(true);
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
    expect(r.rt({ type: "output_audio_buffer.started", response_id: "resp_old" })).toEqual([{ kind: "send", event: { type: "response.cancel", response_id: "resp_old" } }]);
    expect(r.rt({ type: "response.function_call_arguments.done", response_id: "resp_old", call_id: "c1", name: "recall", arguments: "{}" })).toEqual([]);
    // Only the stray-audio flag moves, so the next reply clears the buffer first (R3.2).
    expect({ ...r.st, strayAudio: before.strayAudio }).toEqual(before);
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
    expect(b.last.some((c) => c.kind === "verifyPermit" || (c.kind === "send" && c.event.type === "response.create"))).toBe(false);

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
    expect(r.last.some((c) => c.kind === "verifyPermit" || (c.kind === "send" && c.event.type === "response.create"))).toBe(false);
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
    // The lead-in audio is still playing, so the phase stays SPEAKING until it stops (R6.1); the call is dispatched.
    expect(r.st.phase).toBe("SPEAKING");
    expect(r.st.active!.pendingTool).toMatchObject({ callId: "call_1" });
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

describe("voice-control machine types (task 11)", () => {
  it("starts with empty judge, speculation and latency state", () => {
    const st = initialVoiceState(CONFIG);
    expect(st).toMatchObject({
      judge: null,
      spec: null,
      unadmitted: [],
      outstanding: [],
      missing: [],
      lastTurnResponseAt: null,
      stateSentAt: null,
      ackDroppedStale: false,
      admittedTurnId: null,
      afterReply: null,
      lastLoudAt: null,
      latency: { current: null, rows: [] },
      eventSeq: 0,
    });
  });

  it("names the wait limits of design §Wait limits", () => {
    expect({ JUDGE_LIMIT_MS, HELD_TRANSCRIPT_LIMIT_MS, ADMITTED_TRANSCRIPT_LIMIT_MS, TURN_RESPONSE_LIMIT_MS, LATE_TURN_MS, MISSING_WINDOW_MS, POLL_MS }).toEqual({
      JUDGE_LIMIT_MS: 1_200,
      HELD_TRANSCRIPT_LIMIT_MS: 2_500,
      ADMITTED_TRANSCRIPT_LIMIT_MS: 5_000,
      TURN_RESPONSE_LIMIT_MS: 5_000,
      LATE_TURN_MS: 2_500,
      MISSING_WINDOW_MS: 10_000,
      POLL_MS: 1_000,
    });
  });

  it("maps the new phases to the thinking look", () => {
    for (const phase of ["JUDGING", "SPECULATING", "SWAPPING"] as const) expect(avatarState({ ...initialVoiceState(CONFIG), phase })).toBe("thinking");
  });
});

// ---------------------------------------------------------------------------------------------
// voice-control: the judge, the speculative reply and fastO (tasks 24 to 28)

type Ev = Record<string, unknown> & { type: string };
const meta = (e: Ev) => ((e.response as Record<string, unknown>).metadata ?? {}) as Record<string, string>;

/** Commit and item.added for one item: the judge and the speculative reply go out together. */
function commitTurn(r: Rig, itemId = "item_1") {
  r.rt({ type: "input_audio_buffer.speech_started", item_id: itemId, audio_start_ms: 1000 });
  r.rt({ type: "input_audio_buffer.speech_stopped", item_id: itemId, audio_end_ms: 2400 }, 1400);
  r.ev({ type: "realtime", event: { type: "input_audio_buffer.committed", item_id: itemId }, freshId: testId(`turn-${itemId}`), lastLoudAt: r.now + 10 - 400 }, 10);
  const t0 = r.now;
  const cmds = r.rt({ type: "conversation.item.added", item: { id: itemId } }, 50);
  const creates = sends(cmds).filter((e) => e.type === "response.create") as Ev[];
  const judge = creates.find((e) => meta(e).purpose === "judge");
  const spec = creates.find((e) => meta(e).purpose === "speculative");
  return { t0, cmds, judge, spec };
}

/** Plays the Realtime server: response.created for a create, by its metadata. */
function created(r: Rig, e: Ev, id: string) {
  return r.rt({ type: "response.created", response: { id, metadata: meta(e) } }, 5);
}

/** Answers the hashPayload command with the real hash. */
function answerHash(r: Rig) {
  const c = r.log.filter((x) => x.kind === "hashPayload").at(-1);
  if (c === undefined || c.kind !== "hashPayload") throw new Error("no hashPayload");
  return r.ev({ type: "specHashed", eventId: c.eventId, hash: payloadHash(c.payload, hasher) });
}

const judgeDone = (r: Rig, id: string, letter: string, dt = 0) =>
  r.rt({ type: "response.done", response: { id, status: "completed", metadata: { purpose: "judge", generation: "1" }, output: [{ type: "message", content: [{ type: "output_text", text: letter }] }] } as never }, dt);

/** A turn up to a fastO admission: judge and spec created, spec hashed, judge O. */
function fastOTurn(r: Rig) {
  const t = commitTurn(r);
  created(r, t.judge!, "resp_j");
  created(r, t.spec!, "resp_s");
  answerHash(r);
  judgeDone(r, "resp_j", "O", 300);
  return t;
}

describe("judge and speculative reply at the commit (task 24)", () => {
  it("sends both in one step, muted, with event IDs, and arms the judge deadline at t0 + 1,200", () => {
    const r = listening();
    const { t0, cmds, judge, spec } = commitTurn(r);
    expect(judge).toMatchObject({ event_id: expect.stringMatching(/^judge:/), response: { max_output_tokens: "inf", reasoning: { effort: "minimal" }, metadata: { purpose: "judge", contract: "judge_v1" } } });
    expect(spec).toMatchObject({ event_id: expect.stringMatching(/^spec:/), response: { conversation: "none", input: [{ type: "item_reference", id: "item_1" }], metadata: { purpose: "speculative" } } });
    expect(cmds).toContainEqual(expect.objectContaining({ kind: "hashPayload", eventId: spec!.event_id }));
    expect(cmds).toContainEqual({ kind: "armTimer", name: "judge", at: t0 + JUDGE_LIMIT_MS });
    expect(r.st.phase).toBe("SPECULATING");
    expect(r.st.outputMuted).toBe(true);
    expect(avatarState(r.st)).toBe("thinking");
  });

  it("with noteWaiting the judge goes alone (R2.9)", () => {
    const r = listening();
    const d = { ...r.st.deck!, noteWaiting: true };
    r.ev({ type: "stateOk", response: { stamp: ss(d), state: "LISTENING", deck: d, ack: ackAt(d, r.now), barrierReceiptId: null, proactive: null } });
    const { judge, spec } = commitTurn(r);
    expect(judge).toBeDefined();
    expect(spec).toBeUndefined();
    expect(r.st.phase).toBe("JUDGING");
  });

  it("more than 8 unadmitted fragments takes the slow path with nothing sent (R2.7)", () => {
    const r = listening();
    r.st = { ...r.st, unadmitted: Array.from({ length: 8 }, (_, i) => ({ itemId: `old_${i}`, commitSeq: i + 1 })), lastCommitSeq: 8 };
    const { judge, spec } = commitTurn(r);
    expect(judge).toBeUndefined();
    expect(spec).toBeUndefined();
    expect(r.st.phase).toBe("HELD");
  });

  it("no item.added within 600 ms sends no judge (R2.5)", () => {
    const r = listening();
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_1" });
    r.timer("item", 600);
    expect(r.st.phase).toBe("HELD");
    expect(sends(r.log).some((e) => e.type === "response.create")).toBe(false);
  });

  it("speech start cancels both; the next commit judges every fragment again (R2.6)", () => {
    const r = listening();
    const t = commitTurn(r);
    created(r, t.judge!, "resp_j");
    created(r, t.spec!, "resp_s");
    const start = r.rt({ type: "input_audio_buffer.speech_started", item_id: "item_2", audio_start_ms: 3000 }, 100);
    expect(sends(start)).toEqual(expect.arrayContaining([{ type: "response.cancel", response_id: "resp_j" }, { type: "response.cancel", response_id: "resp_s" }, { type: "output_audio_buffer.clear" }]));
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_2" }, 500);
    const again = sends(r.rt({ type: "conversation.item.added", item: { id: "item_2" } }, 20)).find((e) => meta(e as Ev).purpose === "judge") as Ev;
    expect(((again.response as Ev).input as { type: string; id?: string }[]).filter((i) => i.type === "item_reference").map((i) => i.id)).toEqual(["item_1", "item_2"]);
  });
});

describe("verdicts and fastO admission (task 25)", () => {
  it("a valid O with a fresh ack issues fastO; the speculative reply itself unmutes at its start", () => {
    const r = listening();
    fastOTurn(r);
    const verify = r.last.find((c) => c.kind === "verifyPermit");
    expect(verify).toBeDefined();
    expect(r.st.pending!.permit).toMatchObject({ kind: "fastO", scope: "reply", noteIds: [] });
    const admittedCmds = answerVerify(r);
    expect(sends(admittedCmds).some((e) => e.type === "response.create")).toBe(false);
    expect(admittedCmds).toContainEqual(expect.objectContaining({ kind: "receipt", body: expect.objectContaining({ kind: "admitted", permitKind: "fastO", responseId: "resp_s" }) }));
    const start = r.rt({ type: "output_audio_buffer.started", response_id: "resp_s" }, 100);
    expect(start[0]).toEqual({ kind: "unmuteOutput" });
    expect(r.st.phase).toBe("SPEAKING");
  });

  it("an O after muted audio began cancels, clears and regenerates (R3.2)", () => {
    const r = listening();
    const t = commitTurn(r);
    created(r, t.judge!, "resp_j");
    created(r, t.spec!, "resp_s");
    answerHash(r);
    expect(r.rt({ type: "output_audio_buffer.started", response_id: "resp_s" }, 200).some((c) => c.kind === "unmuteOutput")).toBe(false);
    judgeDone(r, "resp_j", "O", 100);
    const cmds = sends(answerVerify(r));
    expect(cmds.slice(0, 3)).toEqual([{ type: "response.cancel", response_id: "resp_s" }, { type: "output_audio_buffer.clear" }, expect.objectContaining({ type: "response.create" })]);
    expect(meta(cmds[2] as Ev).purpose).toBe("speech");
  });

  it("H, U, an invalid answer and a judge error hold the turn; a later O changes nothing (R3.3, R3.4)", () => {
    for (const letter of ["H", "U", "OK."]) {
      const r = listening();
      const t = commitTurn(r);
      created(r, t.judge!, "resp_j");
      created(r, t.spec!, "resp_s");
      const held = sends(judgeDone(r, "resp_j", letter, 200));
      expect(held).toEqual(expect.arrayContaining([{ type: "response.cancel", response_id: "resp_s" }, { type: "output_audio_buffer.clear" }]));
      expect(r.st.phase).toBe("HELD");
      expect(judgeDone(r, "resp_j", "O", 10).some((c) => c.kind === "verifyPermit")).toBe(false);
    }
    const e = listening();
    const t = commitTurn(e);
    e.rt({ type: "error", error: { code: "x", event_id: t.judge!.event_id as string } });
    expect(e.st.phase).toBe("HELD");
  });

  it("no verdict by t0 + 1,200 cancels both and takes the slow path (R3.5)", () => {
    const r = listening();
    const t = commitTurn(r);
    created(r, t.judge!, "resp_j");
    created(r, t.spec!, "resp_s");
    const cmds = r.timer("judge", JUDGE_LIMIT_MS);
    expect(sends(cmds)).toEqual(expect.arrayContaining([{ type: "response.cancel", response_id: "resp_j" }, { type: "response.cancel", response_id: "resp_s" }]));
    expect(r.st.phase).toBe("HELD");
    expect(r.st.latency.current!.refused).toBe("verdict");
  });

  it("a refused fastO records why (R3.6, R18.6)", () => {
    const r = listening();
    const t = commitTurn(r);
    created(r, t.judge!, "resp_j");
    created(r, t.spec!, "resp_s");
    answerHash(r);
    // The server refuses the ack (a parse gap, say).
    const d = r.st.deck!;
    r.ev({ type: "stateOk", sentAt: r.now, response: { stamp: ss(d), state: "LISTENING", deck: d, ack: null, barrierReceiptId: null, proactive: null } }, 100);
    judgeDone(r, "resp_j", "O", 100);
    expect(r.last.some((c) => c.kind === "verifyPermit")).toBe(false);
    expect(r.st.phase).toBe("HELD");
    expect(r.st.latency.current!.refused).toBe("ack");
  });

  it("a function call inside the speculative reply waits for admission, then dispatches (R6.3)", () => {
    const r = listening();
    const t = commitTurn(r);
    created(r, t.judge!, "resp_j");
    created(r, t.spec!, "resp_s");
    answerHash(r);
    const held = r.rt({ type: "response.function_call_arguments.done", response_id: "resp_s", call_id: "call_1", name: "recall", arguments: "{}" });
    expect(held.some((c) => c.kind === "tool")).toBe(false);
    judgeDone(r, "resp_j", "O", 100);
    expect(answerVerify(r)).toContainEqual(expect.objectContaining({ kind: "tool", body: expect.objectContaining({ callId: "call_1" }) }));
  });

  it("the post carries the verdict known when it is sent (R3.9)", () => {
    const r = listening();
    const t = commitTurn(r);
    created(r, t.judge!, "resp_j");
    judgeDone(r, "resp_j", "H", 100);
    r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "forget it" }, 100);
    expect(turnBody(r).judge).toBe("H");
  });
});

describe("turn responses, cuts and tools by scope (task 26)", () => {
  /** Up to SPEAKING under fastO, then the transcript posted. */
  function playingFastO() {
    const r = listening();
    fastOTurn(r);
    answerVerify(r);
    r.rt({ type: "output_audio_buffer.started", response_id: "resp_s" }, 100);
    r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "quick question" }, 100);
    return r;
  }

  it("ready cuts a playing fastO reply; ordinary with postCommitControl and hold don't (R11.6; question 92)", () => {
    for (const [status, kind, cut] of [["ready", "postCommitControl", true], ["ordinary", "postCommitControl", false], ["ordinary", "slowOrdinary", false], ["hold", "recoveryOnly", false]] as const) {
      const r = playingFastO();
      const res = { ...admitted(r, kind), status };
      const cmds = r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: res }, 300);
      expect(cmds.some((c) => c.kind === "muteOutput"), `${status} ${kind}`).toBe(cut);
      expect(r.st.phase).toBe(cut ? "HELD" : "SPEAKING");
    }
  });

  it("a slowOrdinary that arrives while SPECULATING admits the speculative reply itself", () => {
    const r = listening();
    const t = commitTurn(r);
    created(r, t.judge!, "resp_j");
    created(r, t.spec!, "resp_s");
    answerHash(r);
    r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "hello" }, 100);
    const cmds = r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: admitted(r, "slowOrdinary") }, 200);
    expect(sends(cmds)).toContainEqual({ type: "response.cancel", response_id: "resp_j" });
    expect(sends(answerVerify(r)).some((e) => e.type === "response.create")).toBe(false);
    expect(r.rt({ type: "output_audio_buffer.started", response_id: "resp_s" }, 100)[0]).toEqual({ kind: "unmuteOutput" });
  });

  it("scope ack and recoveryOnly have no tools; scope reply keeps recall; an ack note is said verbatim", () => {
    const tools = (scope: Permit["scope"], notes: Parameters<typeof replyCreate>[1]["notes"] = []) => {
      const r = listening();
      speak(r);
      const res = admitted(r, "postCommitControl", { scope });
      return (replyCreate(r.st, { permit: res.permit!, purpose: "speech", notes, toolCall: null, toolOutput: null }).response as Ev).tools as unknown[];
    };
    expect(tools("ack")).toEqual([]);
    expect(tools("reply")).toHaveLength(1);
    const r = listening();
    speak(r);
    const note = { noteId: testId("n"), rev: 1, kind: "ack" as const, text: "I can't forget things yet.", rootKeys: [], dependsOn: [], sens: "S0" as const, expiresAt: tsFromMs(r.now + 10_000), unprompted: false, momentId: null, tokens: [] };
    const res = admitted(r, "postCommitControl", { scope: "ack" });
    const e = replyCreate(r.st, { permit: res.permit!, purpose: "speech", notes: [note], toolCall: null, toolOutput: null });
    expect(e.response).toMatchObject({ instructions: 'Say exactly this and nothing else: "I can\'t forget things yet."', input: [], tools: [] });
  });

  it("a Permit after t0 + 2,500 but before the request times out plays and is marked late (R7.5)", () => {
    const r = listening();
    speak(r);
    r.timer("judge", JUDGE_LIMIT_MS);
    r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: admitted(r, "slowOrdinary") }, 2_000);
    expect(sends(answerVerify(r)).some((e) => e.type === "response.create")).toBe(true);
    expect(r.st.latency.current!.permitAt! - r.st.latency.current!.commit!).toBeGreaterThan(LATE_TURN_MS);
  });

  it("after the permit wait ends, a turnOk only adopts its Deck", () => {
    const r = listening();
    speak(r);
    // The answer as the server built it, before the wait ended.
    const answer = admitted(r, "slowOrdinary");
    r.timer("permit", TURN_RESPONSE_LIMIT_MS);
    expect(r.st.phase).toBe("RECOVERY");
    const cmds = r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: answer }, 10);
    expect(cmds.some((c) => c.kind === "verifyPermit")).toBe(false);
  });
});

describe("deadlines, missing posts, polling and speech start (task 27)", () => {
  it("an admitted turn posts missing at t0 + 5,000 and keeps playing (R7.6)", () => {
    const r = listening();
    const t = fastOTurn(r);
    answerVerify(r);
    r.rt({ type: "output_audio_buffer.started", response_id: "resp_s" }, 100);
    r.timer("transcript", t.t0 - r.now + HELD_TRANSCRIPT_LIMIT_MS);
    expect(r.log.some((c) => c.kind === "turn")).toBe(false);
    r.timer("transcript", ADMITTED_TRANSCRIPT_LIMIT_MS - HELD_TRANSCRIPT_LIMIT_MS);
    expect(turnBody(r)).toMatchObject({ transcriptState: "missing" });
    expect(r.st.phase).toBe("SPEAKING");
    expect(r.st.outputMuted).toBe(false);
  });

  it("posting keeps the ack; a turn answer drops it; an ack requested before the last turn answer can't grant fastO (R4.3, R4.4; review item 1)", () => {
    const r = listening();
    speak(r);
    expect(r.st.ack).not.toBeNull();
    const sentAt = r.now;
    r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: admitted(r, "slowOrdinary") }, 50);
    expect(r.st.ack).toBeNull();
    const d = r.st.deck!;
    r.ev({ type: "stateOk", sentAt, response: { stamp: ss(d), state: "LISTENING", deck: d, ack: ackAt(d, r.now), barrierReceiptId: null, proactive: null } }, 10);
    expect(r.st.ack).toBeNull();
    expect(r.st.ackDroppedStale).toBe(true);
  });

  it("polls state once a second, never two in flight (R4.5)", () => {
    const r = listening();
    const states = () => r.log.filter((c) => c.kind === "state").length;
    const before = states();
    r.timer("poll", POLL_MS);
    expect(states()).toBe(before + 1);
    r.timer("poll", POLL_MS);
    expect(states()).toBe(before + 1); // the first is still in flight
    expect(r.st.deadlines.poll).toBe(r.now + POLL_MS);
  });

  it("the missing window ends: a later transcript is dropped (R7.8)", () => {
    const r = listening();
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_1" });
    r.timer("transcript", HELD_TRANSCRIPT_LIMIT_MS);
    const n = r.log.filter((c) => c.kind === "turn").length;
    r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "too late" }, MISSING_WINDOW_MS + 1);
    expect(r.log.filter((c) => c.kind === "turn")).toHaveLength(n);
  });
});

describe("latency rows and the avatar (task 28)", () => {
  it("a fastO turn's row has every time, path fastO, and closes when the reply ends", () => {
    const r = listening();
    fastOTurn(r);
    answerVerify(r);
    r.rt({ type: "output_audio_buffer.started", response_id: "resp_s" }, 100);
    r.rt({ type: "output_audio_buffer.stopped", response_id: "resp_s" }, 1500);
    const row = r.st.latency.rows.at(-1)!;
    expect(row).toMatchObject({ path: "fastO", verdict: "O", refused: null, late: false });
    for (const k of ["lastLoud", "commit", "judgeSent", "verdictAt", "permitAt", "audible"] as const) expect(row[k]).not.toBeNull();
    expect(row.commitDelayMs).toBe(400);
  });

  it("regenerated and slow paths", () => {
    const g = listening();
    const t = commitTurn(g);
    created(g, t.judge!, "resp_j");
    created(g, t.spec!, "resp_s");
    answerHash(g);
    g.rt({ type: "output_audio_buffer.started", response_id: "resp_s" }, 200);
    judgeDone(g, "resp_j", "O", 100);
    answerVerify(g);
    expect(g.st.latency.current!.path).toBe("regenerated");
    expect(g.st.latency.current!.firstMuted).not.toBeNull();
    const s = listening();
    speak(s);
    s.ev({ type: "turnOk", turnId: turnBody(s).turnId, response: admitted(s, "slowOrdinary") }, 100);
    answerVerify(s);
    expect(s.st.latency.current!.path).toBe("slow");
  });

  it("the avatar never shows speaking while output is muted (R6.4)", () => {
    const st = initialVoiceState(CONFIG);
    expect(avatarState({ ...st, phase: "SPEAKING", outputMuted: true })).toBe("thinking");
    expect(avatarState({ ...st, phase: "SPEAKING", outputMuted: false })).toBe("speaking");
  });
});

// docs/briefs/011-review-wave-a.md
describe("wave A review fixes", () => {
  it("item 1: a turn's own post doesn't refuse its own fastO; another turn's post still does", () => {
    const r = listening();
    const t = commitTurn(r);
    created(r, t.judge!, "resp_j");
    created(r, t.spec!, "resp_s");
    answerHash(r);
    // The transcript arrives before the verdict: the turn is posted, and the ack it holds still vouches for every earlier turn.
    r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "My dog is called Pip" }, 100);
    expect(r.log.some((c) => c.kind === "turn")).toBe(true);
    expect(r.st.ack).not.toBeNull();
    judgeDone(r, "resp_j", "O", 200);
    expect(r.st.pending?.permit.kind).toBe("fastO");
    expect(r.st.latency.current!.refused).toBeNull();
  });

  it("item 1: an outstanding post of another turn still refuses fastO", () => {
    const r = listening();
    // Turn 1 is posted and never answered.
    speak(r);
    r.ev({ type: "realtime", event: { type: "input_audio_buffer.speech_started", item_id: "item_2", audio_start_ms: 5000 }, freshId: testId("x") }, 10);
    const t = commitTurn(r, "item_2");
    created(r, t.judge!, "resp_j2");
    created(r, t.spec!, "resp_s2");
    answerHash(r);
    const d = r.st.deck!;
    r.ev({ type: "stateOk", sentAt: r.now, response: { stamp: ss(d), state: "LISTENING", deck: d, ack: ackAt(d, r.now), barrierReceiptId: null, proactive: null } }, 10);
    judgeDone(r, "resp_j2", "O", 100);
    expect(r.st.pending?.permit.kind).not.toBe("fastO");
    expect(r.st.latency.current!.refused).toBe("outstanding");
  });
});

describe("wave A review fixes, item 2: the poll's Deck carries the safe turns", () => {
  const safe = (turnId: string, role: "user" | "assistant", text: string) => ({ turnId: testId(turnId), role, text, sens: "S0" as const, rootKeys: [], dependsOn: [], policyRev: 1 });
  const withTurns = (d: Deck, turns: ReturnType<typeof safe>[]): Deck => ({ ...d, turns });

  it("after a turn answer and a poll, the next commit's judge and speculative reply carry the earlier user turn and Franki's reply", () => {
    const r = listening();
    speak(r);
    const sentBefore = r.now;
    r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: admitted(r, "slowOrdinary") }, 50);
    const turns = [safe("t1", "user", "My dog is called Pip"), safe("a1", "assistant", "Pip is a lovely name. How old is Pip?")];
    // A poll sent before the answer carries the old Deck: it doesn't replace the newer one.
    const d0 = r.st.deck!;
    r.ev({ type: "stateOk", sentAt: sentBefore, response: { stamp: ss(d0), state: "LISTENING", deck: d0, ack: null, barrierReceiptId: null, proactive: null } }, 10);
    const d = withTurns(r.st.deck!, turns);
    r.ev({ type: "stateOk", sentAt: r.now, response: { stamp: ss(d), state: "LISTENING", deck: d, ack: ackAt(d, r.now), barrierReceiptId: null, proactive: null } }, 10);
    // The reply ends and the owner answers.
    r.st = { ...r.st, phase: "LISTENING", turn: null, active: null, pending: null };
    const t = commitTurn(r, "item_2");
    expect(JSON.stringify(t.judge)).toContain("How old is Pip?");
    const input = (t.spec!.response as { input: Record<string, unknown>[] }).input;
    expect(JSON.stringify(input)).toContain("My dog is called Pip");
    expect(JSON.stringify(input)).toContain("How old is Pip?");
  });

  it("a poll sent before the last turn answer doesn't replace that answer's Deck at the same revisions", () => {
    const r = listening();
    speak(r);
    const sentBefore = r.now;
    const answer = admitted(r, "slowOrdinary");
    const turns = [safe("t1", "user", "My dog is called Pip")];
    r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: { ...answer, deck: withTurns(answer.deck!, turns) } }, 50);
    expect(r.st.deck!.turns).toHaveLength(1);
    const old = withTurns(r.st.deck!, []);
    r.ev({ type: "stateOk", sentAt: sentBefore, response: { stamp: ss(old), state: "LISTENING", deck: old, ack: null, barrierReceiptId: null, proactive: null } }, 10);
    expect(r.st.deck!.turns).toHaveLength(1);
  });
});

describe("wave A review fixes, Part 2", () => {
  it("item 3: a typed line during a call gets its reply", () => {
    const r = listening();
    r.ev({ type: "typedSubmitted", turnId: testId("typed-1"), text: "What is my dog called?" });
    expect(turnBody(r)).toMatchObject({ source: "typed", transcriptState: "final" });
    expect(r.st.phase).toBe("HELD");
    r.ev({ type: "turnOk", turnId: testId("typed-1"), response: admitted(r, "slowOrdinary") }, 400);
    expect(sends(answerVerify(r)).map((e) => e.type)).toContain("response.create");
  });

  it("item 4: speech start while HELD with nothing in flight drops the wait; the late Permit doesn't play over the owner", () => {
    const r = listening();
    const t = commitTurn(r);
    created(r, t.judge!, "resp_j");
    created(r, t.spec!, "resp_s");
    answerHash(r);
    judgeDone(r, "resp_j", "H", 200);
    r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "My dog is called Pip" }, 100);
    expect(r.st.phase).toBe("HELD");
    const body = turnBody(r);
    const answer = admitted(r, "slowOrdinary");
    r.rt({ type: "input_audio_buffer.speech_started", item_id: "item_2", audio_start_ms: 5000 }, 100);
    expect(r.st.phase).toBe("LISTENING");
    expect(r.st.pending).toBeNull();
    expect(r.st.deadlines.permit).toBeUndefined();
    const cmds = r.ev({ type: "turnOk", turnId: body.turnId, response: answer }, 300);
    expect(cmds.some((c) => c.kind === "verifyPermit")).toBe(false);
    expect(r.st.outputMuted).toBe(true);
  });

  it("item 4: speech start in RECOVERY waiting for the Neutral_Line drops that wait too", () => {
    const r = listening();
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_1" });
    r.timer("transcript", HELD_TRANSCRIPT_LIMIT_MS);
    expect(r.st.phase).toBe("RECOVERY");
    r.rt({ type: "input_audio_buffer.speech_started", item_id: "item_2", audio_start_ms: 5000 }, 100);
    expect(r.st.phase).toBe("LISTENING");
    expect(r.st.deadlines.lineDone).toBeUndefined();
  });
});

/** A turn the judge held, posted final, waiting in HELD for its Permit. */
function heldPosted(r: Rig) {
  const t = commitTurn(r);
  created(r, t.judge!, "resp_j");
  created(r, t.spec!, "resp_s");
  answerHash(r);
  judgeDone(r, "resp_j", "H", 200);
  r.rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "My dog is called Pip" }, 100);
  expect(r.st.phase).toBe("HELD");
  return turnBody(r);
}

describe("wave A review fixes, items 5 and 6", () => {
  it("item 5: a new turn doesn't inherit the old turn's permit and turnRetry deadlines", () => {
    const r = listening();
    heldPosted(r);
    expect(r.st.deadlines.permit).toBeDefined();
    r.ev({ type: "turnOk", turnId: turnBody(r).turnId, response: { ...admitted(r, "slowOrdinary"), status: "hold", permit: null, retryAfterMs: 250 } }, 50);
    expect(r.st.deadlines.turnRetry).toBeDefined();
    // A commit with no speech_started first (the VAD sent none) starts a new turn.
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_2" }, 10, testId("turn-2"));
    expect(r.st.turn!.turnId).toBe(testId("turn-2"));
    expect(r.st.deadlines.permit).toBeUndefined();
    expect(r.st.deadlines.turnRetry).toBeUndefined();
    r.rt({ type: "conversation.item.added", item: { id: "item_2" } }, 20);
    r.timer("permit", TURN_RESPONSE_LIMIT_MS);
    expect(r.st.turn?.turnId).toBe(testId("turn-2"));
  });

  it("item 6: a failed post of a turn that is no longer current reconnects", () => {
    const r = listening();
    const old = heldPosted(r);
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_2" }, 10, testId("turn-2"));
    r.ev({ type: "turnFailed", turnId: old.turnId }, 100);
    expect(r.st.recovery?.kind).toBe("connection");
    expect(r.log.some((c) => c.kind === "teardown")).toBe(true);
  });

  it("item 6: a stale answer for a turn that is no longer current reconnects", () => {
    const r = listening();
    const old = heldPosted(r);
    const stale = { ...admitted(r, "slowOrdinary"), status: "stale" as const, permit: null };
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_2" }, 10, testId("turn-2"));
    r.ev({ type: "turnOk", turnId: old.turnId, response: stale }, 100);
    expect(r.st.recovery?.kind).toBe("connection");
  });

  it("item 6: the permit deadline and the request's own timeout give the same result in either order", () => {
    for (const order of ["permitFirst", "failedFirst"] as const) {
      const r = listening();
      const old = heldPosted(r);
      r.now += TURN_RESPONSE_LIMIT_MS;
      if (order === "permitFirst") r.timer("permit");
      r.ev({ type: "turnFailed", turnId: old.turnId });
      if (order === "failedFirst") r.timer("permit");
      expect(r.st.recovery?.kind).toBe("connection");
    }
  });

  it("item 6: a non-current turn's answer still adopts a higher Deck", () => {
    const r = listening();
    const old = heldPosted(r);
    const res = admitted(r, "slowOrdinary");
    r.rt({ type: "input_audio_buffer.committed", item_id: "item_2" }, 10, testId("turn-2"));
    const higher = { ...res.deck!, policyRev: res.deck!.policyRev + 1 };
    r.ev({ type: "turnOk", turnId: old.turnId, response: { ...res, deck: higher, stamp: { ...res.stamp, policyRev: higher.policyRev } } }, 100);
    expect(r.st.deck!.policyRev).toBe(higher.policyRev);
  });
});
