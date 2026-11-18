import { expect, it } from "vitest";
import type { Proactive, StateResponse } from "../schema/wire";
import type { Infer } from "../schema/v";
import { ProactiveDriver } from "./testing/arb-proactive";

function state(d: ProactiveDriver, line: Proactive): Infer<typeof StateResponse> {
  return { stamp: line.permit.stamp, state: "LISTENING", deck: d.serverDeck, ack: null, barrierReceiptId: null,
    proactive: line, audience: "private", phoneActivity: [], webSearch: { status: "found", cards: [] } };
}

it("allows a web answer at a pause, keeps its text out of instructions, and yields when the owner speaks", () => {
  const d = new ProactiveDriver(false).start();
  const p: Proactive = { ...d.line(d.serverDeck, d.now, "ok"), asks: false, source: "webSearch" };
  d.ev({ type: "stateOk", response: state(d, p), sentAt: d.now });
  d.play({ dt: 0, action: { k: "hash", pick: 0, ok: true } });
  const response = d.pending.creates.at(-1)?.event.response;
  expect(response).toMatchObject({ conversation: "none", tools: [], input: [{ role: "user", content: [{ text: JSON.stringify({ answer: p.whisper.text }) }] }] });
  expect(response).toHaveProperty("instructions", expect.not.stringContaining(p.whisper.text));
  d.play({ dt: 0, action: { k: "created", pick: 0 } });
  d.play({ dt: 0, action: { k: "done", pick: 0 } });
  d.play({ dt: 0, action: { k: "started", pick: 0 } });
  expect(d.st.phase).toBe("SPEAKING");
  const id = d.st.active!.responseId!;
  const transcript = d.rt({ type: "response.output_audio_transcript.done", response_id: id, transcript: p.whisper.text });
  expect(transcript.some(c => c.kind === "receipt" && c.body.kind === "transcript")).toBe(false);
  const interruption = d.rt({ type: "input_audio_buffer.speech_started", item_id: "new-topic", audio_start_ms: 1 });
  expect(interruption).toContainEqual(expect.objectContaining({ kind: "receipt", body: expect.objectContaining({ kind: "cancelled" }) }));
  expect(interruption.some(c => c.kind === "receipt" && c.body.kind === "playbackEnded")).toBe(false);
  expect(d.st.outputMuted).toBe(true);
  const next = d.ev({ type: "stateOk", response: state(d, p), sentAt: d.now }, 50);
  expect(next.some(c => c.kind === "verifyPermit")).toBe(false);
});
