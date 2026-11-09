/**
 * A fake Realtime server for the judge spike (brief 006 item 4). It speaks the events the harness reads, on the
 * harness's clock, with a plain energy VAD: speech is any 20 ms chunk whose RMS passes a threshold, and 300 ms of
 * silence after speech stops, commits and adds the item. Judge and reply behavior is scripted per judge call.
 * Nothing here touches the network.
 */
import type { RealtimeClientEvent } from "@franki/core";
import type { HarnessClock } from "./clock";
import type { Connect, ServerEvent, Transport } from "./realtime";

export interface FakeJudgeScript {
  /** The judge message texts, or null for no message at all. Ignored when `noDone`. */
  texts?: string[] | null;
  status?: "completed" | "incomplete" | "cancelled";
  /** Milliseconds from response.create to response.done. */
  delayMs?: number;
  /** Never send response.done (a judge that hangs). */
  noDone?: boolean;
  usage?: Record<string, unknown>;
}

export interface FakeOptions {
  clock: HarnessClock;
  /** The script for judge call `i` (0-based, in the order the harness sends them), for the turn it names. */
  judge: (i: number, turnId: string) => FakeJudgeScript;
  transcript?: (itemIndex: number) => string;
  itemAddedDelayMs?: number;
  transcriptDelayMs?: number;
  replyAudioDelayMs?: number;
  /** A reply that is not cancelled first finishes by itself (`completed`) this long after its response.create. */
  replyDoneMs?: number;
  /** Milliseconds from response.create to response.created, by purpose (default 5 for both). */
  createdDelayMs?: { judge?: number; reply?: number };
  /**
   * `refuse`: a response.create while another response is in progress gets an `error` event and no response
   * (brief 009: the S-Audio question whether two out-of-band responses can run at once). Default `allow`.
   */
  concurrent?: "allow" | "refuse";
  silenceMs?: number;
}

/** The error the fake sends when it refuses a second response. The real server's wording is not known. */
export const FAKE_REFUSAL = {
  type: "invalid_request_error",
  code: "conversation_already_has_active_response",
  message: "Conversation already has an active response in progress. Wait until the response is finished before creating a new one.",
} as const;

export interface FakeLog {
  sent: RealtimeClientEvent[];
  connections: number;
  closed: number;
}

const SPEECH_RMS = 500;

function rms(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  const n = bytes.byteLength >> 1;
  for (let i = 0; i < n; i++) sum += v.getInt16(i * 2, true) ** 2;
  return n === 0 ? 0 : Math.sqrt(sum / n);
}

/** A Connect that opens fake sessions, and the log of everything the harness sent. */
export function fakeConnect(opts: FakeOptions): { connect: Connect; log: FakeLog } {
  const log: FakeLog = { sent: [], connections: 0, closed: 0 };
  let judgeCalls = 0;
  let itemCount = 0;
  let responseCount = 0;
  const connect: Connect = async () => {
    log.connections++;
    const handlers: ((e: ServerEvent) => void)[] = [];
    const closers: ((r: string) => void)[] = [];
    let open = true;
    const emit = (delayMs: number, event: ServerEvent, then?: () => void) =>
      opts.clock.setTimer(delayMs, () => {
        if (!open) return;
        then?.();
        for (const h of handlers) h(event);
      });
    let audioMs = 0;
    let speech: { itemId: string; startMs: number } | null = null;
    let silenceFrom: number | null = null;
    const replies = new Map<string, { metadata: unknown; timers: unknown[] }>();
    /** Responses in progress: created and not yet done. */
    const active = new Set<string>();
    let eventCount = 0;
    const silenceMs = opts.silenceMs ?? 300;

    const transport: Transport = {
      send(event) {
        log.sent.push(event);
        switch (event.type) {
          case "session.update":
            emit(5, { type: "session.updated", session: event.session });
            return;
          case "input_audio_buffer.append": {
            const bytes = new Uint8Array(Buffer.from(String(event.audio), "base64"));
            const ms = bytes.byteLength / 48;
            const loud = rms(bytes) >= SPEECH_RMS;
            if (loud) {
              if (speech === null) {
                speech = { itemId: `item_${++itemCount}`, startMs: audioMs };
                emit(10, { type: "input_audio_buffer.speech_started", item_id: speech.itemId, audio_start_ms: audioMs });
              }
              silenceFrom = null;
            } else if (speech !== null) {
              if (silenceFrom === null) silenceFrom = audioMs;
              if (audioMs + ms - silenceFrom >= silenceMs) {
                const id = speech.itemId;
                const index = itemCount;
                const endMs = silenceFrom;
                speech = null;
                silenceFrom = null;
                emit(10, { type: "input_audio_buffer.speech_stopped", item_id: id, audio_end_ms: Math.round(endMs) });
                emit(15, { type: "input_audio_buffer.committed", item_id: id, previous_item_id: null });
                emit(15 + (opts.itemAddedDelayMs ?? 30), { type: "conversation.item.added", item: { id, type: "message", role: "user" } });
                emit(15 + (opts.transcriptDelayMs ?? 400), {
                  type: "conversation.item.input_audio_transcription.completed",
                  item_id: id,
                  transcript: opts.transcript?.(index - 1) ?? "fake transcript",
                });
              }
            }
            audioMs += ms;
            return;
          }
          case "response.create": {
            const r = (event.response ?? {}) as Record<string, unknown>;
            const metadata = (r.metadata ?? {}) as Record<string, string>;
            if (opts.concurrent === "refuse" && active.size > 0) {
              emit(5, { type: "error", event_id: `event_${++eventCount}`, error: { ...FAKE_REFUSAL, param: null, event_id: null } });
              return;
            }
            const id = `resp_${++responseCount}`;
            active.add(id);
            const isJudge = metadata.purpose === "judge";
            const createdMs = (isJudge ? opts.createdDelayMs?.judge : opts.createdDelayMs?.reply) ?? 5;
            emit(createdMs, { type: "response.created", response: { id, status: "in_progress", metadata } });
            if (isJudge) {
              const script = opts.judge(judgeCalls++, String(metadata.turnId ?? ""));
              const delay = script.delayMs ?? 180;
              const texts = script.texts === undefined ? ["O"] : script.texts;
              if (texts !== null && texts.length > 0 && !script.noDone) {
                emit(Math.max(createdMs, Math.min(delay, 40)), { type: "response.output_text.delta", response_id: id, delta: texts[0]!.slice(0, 1) });
              }
              if (!script.noDone) {
                emit(
                  delay,
                  {
                    type: "response.done",
                    response: {
                      id,
                      status: script.status ?? "completed",
                      metadata,
                      output: texts === null ? [] : texts.map((text) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] })),
                      usage: script.usage ?? { total_tokens: 120, input_tokens: 119, output_tokens: 1, output_token_details: { text_tokens: 1, audio_tokens: 0 } },
                    },
                  },
                  () => active.delete(id),
                );
              }
            } else {
              const timers = [emit(Math.max(createdMs, opts.replyAudioDelayMs ?? 250), { type: "response.output_audio.delta", response_id: id, delta: "AAAA" })];
              if (opts.replyDoneMs !== undefined) {
                timers.push(
                  emit(Math.max(createdMs, opts.replyDoneMs), { type: "response.done", response: { id, status: "completed", metadata, output: [] } }, () => {
                    active.delete(id);
                    replies.delete(id);
                  }),
                );
              }
              replies.set(id, { metadata, timers });
            }
            return;
          }
          case "response.cancel": {
            const id = String(event.response_id);
            const reply = replies.get(id);
            if (reply !== undefined) {
              replies.delete(id);
              for (const timer of reply.timers) opts.clock.clearTimer(timer);
              emit(5, { type: "response.done", response: { id, status: "cancelled", metadata: reply.metadata, output: [] } }, () => active.delete(id));
            } else active.delete(id);
            return;
          }
        }
      },
      close() {
        if (!open) return;
        open = false;
        log.closed++;
        for (const c of closers) c("closed by client");
      },
      onEvent: (fn) => void handlers.push(fn),
      onClose: (fn) => void closers.push(fn),
    };
    emit(5, { type: "session.created", session: {} });
    return transport;
  };
  return { connect, log };
}

/** Placeholder speech for a dry run with no audio file: a 220 Hz tone of `ms` milliseconds. */
export function placeholderPcm(ms: number): Uint8Array {
  const n = Math.round((ms / 1000) * 24_000);
  const out = new Uint8Array(n * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / 24_000)), true);
  return out;
}
