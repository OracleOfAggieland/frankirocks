import { type LatencyRow, type VoiceEvent, type VoiceState, emptyTimes, finishRow, initialVoiceState } from "@franki/core";
import { describe, expect, it } from "vitest";
import type { Fields } from "./recorder";
import { createApiTap, createCardTap, createLatencyTap, createVoiceTap, changes, phoneFields, radioFields, voiceCommandFields, voiceEventFields } from "./taps";

function sink() {
  const lines: { kind: string; fields: Fields; text?: string }[] = [];
  return {
    lines,
    emit: (kind: string, fields: Fields = {}) => lines.push({ kind, fields }),
    words: (kind: string, text: string, fields: Fields = {}) => lines.push({ kind, fields, text }),
  };
}

const rt = (event: Record<string, unknown>): VoiceEvent => ({ type: "realtime", event, freshId: "f" }) as unknown as VoiceEvent;
const SECRET = "the owner's private words";

describe("the Realtime tap", () => {
  it("writes names and IDs of server events, never their text", () => {
    const s = sink();
    const tap = createVoiceTap({ sink: s, now: () => 10 });
    tap.event!(rt({ type: "response.created", event_id: "ev1", response: { id: "resp_1", metadata: { purpose: SECRET } } }));
    tap.event!(rt({ type: "conversation.item.added", event_id: "ev2", item: { id: "item_1", content: [{ transcript: SECRET }] } }));
    tap.event!(rt({ type: "error", event_id: "ev3", error: { type: "invalid_request_error", code: "bad", message: SECRET, event_id: "c1" } }));
    tap.event!(rt({ type: "response.function_call_arguments.done", response_id: "resp_1", call_id: "call_1", name: "read_money", arguments: SECRET }));
    expect(s.lines.map((l) => l.kind)).toEqual(["rt.event", "rt.event", "rt.event", "rt.event"]);
    expect(s.lines[0]!.fields).toEqual({ type: "response.created", eventId: "ev1", responseId: "resp_1" });
    expect(s.lines[1]!.fields).toEqual({ type: "conversation.item.added", eventId: "ev2", itemId: "item_1" });
    expect(s.lines[2]!.fields).toMatchObject({ type: "error", errType: "invalid_request_error", code: "bad", causeEventId: "c1" });
    expect(JSON.stringify(s.lines)).not.toContain(SECRET);
  });

  it("turns the two completed transcripts into words lines", () => {
    const s = sink();
    const tap = createVoiceTap({ sink: s, now: () => 10 });
    tap.event!(rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "Call my mom" }));
    tap.event!(rt({ type: "response.output_audio_transcript.done", response_id: "resp_1", transcript: "Calling her now." }));
    const words = s.lines.filter((l) => l.kind.startsWith("words."));
    expect(words).toEqual([
      { kind: "words.owner", fields: { itemId: "item_1" }, text: "Call my mom" },
      { kind: "words.franki", fields: { responseId: "resp_1" }, text: "Calling her now." },
    ]);
    const events = s.lines.filter((l) => l.kind === "rt.event");
    expect(JSON.stringify(events)).not.toContain("Call my mom");
    expect(JSON.stringify(events)).not.toContain("Calling her now.");
  });

  it("counts deltas per response and type, written once when the response ends", () => {
    const s = sink();
    let m = 100;
    const tap = createVoiceTap({ sink: s, now: () => m });
    for (let i = 0; i < 5; i++) {
      tap.event!(rt({ type: "response.output_audio_transcript.delta", response_id: "resp_1", delta: SECRET }));
      m += 20;
    }
    tap.event!(rt({ type: "response.output_audio.delta", response_id: "resp_1", delta: "AAAA" }));
    tap.event!(rt({ type: "response.output_audio_transcript.delta", response_id: "resp_2", delta: SECRET }));
    expect(s.lines.filter((l) => l.kind === "rt.deltas")).toHaveLength(0);
    tap.event!(rt({ type: "response.done", response: { id: "resp_1", status: "completed" } }));
    const deltas = s.lines.filter((l) => l.kind === "rt.deltas");
    expect(deltas.map((d) => d.fields)).toEqual([
      { type: "response.output_audio_transcript.delta", responseId: "resp_1", itemId: undefined, n: 5, firstM: 100, lastM: 180 },
      { type: "response.output_audio.delta", responseId: "resp_1", itemId: undefined, n: 1, firstM: 200, lastM: 200 },
    ]);
    expect(s.lines.find((l) => l.kind === "rt.event" && l.fields.type === "response.done")!.fields).toMatchObject({ status: "completed" });
    // The other response's deltas go out at teardown.
    tap.command!({ kind: "teardown" });
    expect(s.lines.filter((l) => l.kind === "rt.deltas").at(-1)!.fields).toMatchObject({ responseId: "resp_2", n: 1 });
    expect(JSON.stringify(s.lines)).not.toContain(SECRET);
  });

  it("closes input transcription deltas on the item's completed event", () => {
    const s = sink();
    const tap = createVoiceTap({ sink: s, now: () => 5 });
    tap.event!(rt({ type: "conversation.item.input_audio_transcription.delta", item_id: "item_9", delta: "Ca" }));
    tap.event!(rt({ type: "conversation.item.input_audio_transcription.delta", item_id: "item_9", delta: "ll" }));
    tap.event!(rt({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_9", transcript: "Call" }));
    expect(s.lines.find((l) => l.kind === "rt.deltas")!.fields).toMatchObject({ itemId: "item_9", n: 2 });
  });

  it("writes other voice events and commands with IDs and enums only", () => {
    const s = sink();
    const tap = createVoiceTap({ sink: s, now: () => 0 });
    tap.event!({ type: "typedSubmitted", turnId: "t1", text: SECRET, source: "typed" });
    tap.event!({ type: "permitChecked", permitId: "p1", hash: "deadbeef" });
    tap.command!({ kind: "send", event: { type: "response.create", response: { instructions: SECRET } } });
    expect(s.lines.map((l) => [l.kind, l.fields])).toEqual([
      ["voice.event", { type: "typedSubmitted", turnId: "t1", source: "typed" }],
      ["voice.event", { type: "permitChecked", permitId: "p1" }],
      ["voice.cmd", { type: "send", event: "response.create" }],
    ]);
    expect(JSON.stringify(s.lines)).not.toContain(SECRET);
    expect(voiceCommandFields({ kind: "armTimer", name: "judge", at: 5 } as never)).toEqual({ type: "armTimer", name: "judge" });
    expect(voiceEventFields({ type: "turnOk", turnId: "t2", supersede: false, response: { status: "admit", stamp: { sessionId: "s1", generation: 2 } } } as never)).toEqual({
      type: "turnOk",
      turnId: "t2",
      supersede: false,
      status: "admit",
      sessionId: "s1",
      generation: 2,
    });
  });

  it("passes the peer and channel on", () => {
    const got: unknown[] = [];
    const tap = createVoiceTap({ sink: sink(), now: () => 0, onLink: (p, c) => got.push(p, c) });
    tap.link!({ pc: 1 } as never, null);
    expect(got).toEqual([{ pc: 1 }, null]);
  });
});

describe("the API tap", () => {
  it("writes route, method, status and time, or the failure", () => {
    const s = sink();
    let t = 0;
    const observe = createApiTap(s, () => t);
    const done = observe("/api/turn", "POST")!;
    t = 412.26;
    done({ status: 200, err: null });
    observe("/api/session/state", "POST")!({ status: null, err: "timeout" });
    expect(s.lines).toEqual([
      { kind: "api.call", fields: { route: "turn", method: "POST", status: 200, ms: 412.3, err: undefined } },
      { kind: "api.call", fields: { route: "session/state", method: "POST", status: undefined, ms: 0, err: "timeout" } },
    ]);
  });
});

const row = (turnId: string, commit: number | null = 10): LatencyRow => finishRow({ ...emptyTimes(turnId), lastLoud: 5, commit, audible: 900, path: "fastO" });
const voice = (rows: LatencyRow[], current: VoiceState["latency"]["current"], phase: VoiceState["phase"] = "LISTENING"): VoiceState =>
  ({ ...initialVoiceState({ transcribeModel: "x" }), phase, latency: { current, rows } }) as VoiceState;

describe("the latency tap", () => {
  it("writes each row once, when the machine has closed it", () => {
    const s = sink();
    const tap = createLatencyTap(s);
    tap.onVoice(voice([], { ...emptyTimes("t1"), commit: 10 }));
    expect(s.lines).toHaveLength(0);
    tap.onVoice(voice([row("t1")], { ...emptyTimes("t2"), commit: 20 }));
    tap.onVoice(voice([row("t1")], { ...emptyTimes("t2"), commit: 20, audible: 30 }));
    expect(s.lines.map((l) => l.fields.turnId)).toEqual(["t1"]);
    expect(s.lines[0]!.fields).toMatchObject({ turnId: "t1", endToAudibleMs: 895, commitDelayMs: 5, path: "fastO", late: false });
  });

  it("writes a row still open when the call ends, and never again", () => {
    const s = sink();
    const tap = createLatencyTap(s);
    const open = { ...emptyTimes("t3"), commit: 40, lastLoud: 30 };
    tap.onVoice(voice([], open, "CLOSED"));
    tap.onVoice(voice([finishRow(open)], null, "CLOSED"));
    expect(s.lines.map((l) => l.fields.turnId)).toEqual(["t3"]);
    // A turn that never committed has no row.
    tap.onVoice(voice([finishRow(open)], emptyTimes("t4"), "CLOSED"));
    expect(s.lines).toHaveLength(1);
  });
});

describe("the stores and cards", () => {
  it("writes the radio and the phone only when they change", () => {
    const s = sink();
    const radio = changes(s, "radio", radioFields);
    radio({ power: "off", panel: "closed", signal: "silent", volume: 0.8, station: null });
    radio({ power: "off", panel: "closed", signal: "silent", volume: 0.8, station: null });
    radio({ power: "on", panel: "open", signal: "playing", volume: 0.8, station: { id: "st-1" } });
    const phone = changes(s, "phone", phoneFields);
    phone({ phase: "dialing", reason: null });
    phone({ phase: "missed", reason: "busy" });
    expect(s.lines.map((l) => [l.kind, l.fields])).toEqual([
      ["radio", { state: "off", power: "off", panel: "closed", signal: "silent", stationId: undefined, volume: 0.8 }],
      ["radio", { state: "playing", power: "on", panel: "open", signal: "playing", stationId: "st-1", volume: 0.8 }],
      ["phone", { state: "dialing", reason: undefined }],
      ["phone", { state: "missed", reason: "busy" }],
    ]);
  });

  it("writes cards shown and closed by ID, and an approval's answer", () => {
    const s = sink();
    const tap = createCardTap(s);
    let yes = 0;
    const cards = [
      { id: "c1", kind: "approval", title: SECRET, onYes: () => yes++, onNotNow: () => {} },
      { id: "c2", kind: "read", title: SECRET },
    ];
    tap.seen(cards);
    const wrapped = tap.wrap(cards);
    wrapped[0]!.onYes!();
    expect(yes).toBe(1);
    expect(wrapped[1]).toBe(cards[1]);
    tap.seen([cards[1]!]);
    expect(s.lines.map((l) => l.fields)).toEqual([
      { kind: "approval", id: "c1", action: "shown" },
      { kind: "read", id: "c2", action: "shown" },
      { kind: "approval", id: "c1", action: "approved" },
      { kind: "approval", id: "c1", action: "closed" },
    ]);
    expect(JSON.stringify(s.lines)).not.toContain(SECRET);
  });
});
