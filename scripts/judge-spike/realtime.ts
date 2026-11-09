/**
 * The Realtime wire for the judge spike (brief 006 item 4; contracts §6 "Realtime"). The spike talks to a Realtime
 * session over a WebSocket, so it streams audio with `input_audio_buffer.append` where the browser uses WebRTC.
 *
 * Node 24's built-in WebSocket (undici) takes a `headers` option in its second argument, so the key goes in an
 * `Authorization` header and no dependency is needed.
 */
import type { RealtimeClientEvent } from "@franki/core";

export const REALTIME_URL = "wss://api.openai.com/v1/realtime";
/** Contracts §6: Franki's voice. */
export const SPIKE_VOICE = "cedar";
/** The spike's fixed reply instruction. No Head, no notes: the spike measures the judge and the first audio. */
export const SPIKE_REPLY_INSTRUCTIONS = "You are Franki, a friendly voice assistant. Answer in one short spoken sentence.";
export const PCM_FORMAT = { type: "audio/pcm", rate: 24_000 } as const;

/**
 * Contracts §6 `session.update`, with the spike's fixed instruction in place of the Head: server VAD at 300 ms
 * silence that neither creates nor interrupts responses, 16-bit PCM at 24 kHz both ways, voice cedar.
 */
export function spikeSessionUpdate(transcribeModel: string): RealtimeClientEvent {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      tracing: null,
      instructions: SPIKE_REPLY_INSTRUCTIONS,
      tools: [],
      audio: {
        input: {
          format: PCM_FORMAT,
          transcription: { model: transcribeModel },
          turn_detection: { type: "server_vad", silence_duration_ms: 300, create_response: false, interrupt_response: false },
        },
        output: { format: PCM_FORMAT, voice: SPIKE_VOICE },
      },
    },
  };
}

/** The reply after a completed `O`: out of band, this turn's audio only, audio out (spec §3 step 3). */
export function spikeReplyCreate(lineId: string, itemIds: readonly string[]): RealtimeClientEvent {
  return {
    type: "response.create",
    response: {
      conversation: "none",
      output_modalities: ["audio"],
      instructions: SPIKE_REPLY_INSTRUCTIONS,
      tools: [],
      metadata: { purpose: "speech", turnId: lineId, generation: "0" },
      input: itemIds.map((id) => ({ type: "item_reference", id })),
    },
  };
}

/**
 * Event names the harness accepts. The GA names come first; the beta names are accepted too, and the run
 * records which ones the server sent.
 */
export const EVENT = {
  itemAdded: ["conversation.item.added", "conversation.item.created"],
  textDelta: ["response.output_text.delta", "response.text.delta"],
  audioDelta: ["response.output_audio.delta", "response.audio.delta"],
} as const;

export type ServerEvent = Record<string, unknown> & { type: string };

export interface Transport {
  send(event: RealtimeClientEvent): void;
  close(): void;
  /** Called for every server event, with nothing else between receipt and the call. */
  onEvent(fn: (event: ServerEvent) => void): void;
  onClose(fn: (reason: string) => void): void;
}

export interface ConnectOptions {
  model: string;
  apiKey: string;
}

export type Connect = (opts: ConnectOptions) => Promise<Transport>;

/** The live transport. Only the CLI's `--live` path passes this to the harness. */
export const liveConnect: Connect = ({ model, apiKey }) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`${REALTIME_URL}?model=${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const handlers: ((e: ServerEvent) => void)[] = [];
    const closers: ((reason: string) => void)[] = [];
    let open = false;
    ws.onopen = () => {
      open = true;
      resolve({
        send: (event) => ws.send(JSON.stringify(event)),
        close: () => ws.close(),
        onEvent: (fn) => void handlers.push(fn),
        onClose: (fn) => void closers.push(fn),
      });
    };
    ws.onmessage = (m) => {
      let event: unknown;
      try {
        event = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (typeof event === "object" && event !== null && typeof (event as ServerEvent).type === "string") for (const h of handlers) h(event as ServerEvent);
    };
    ws.onclose = (e) => {
      if (!open) reject(new Error(`WebSocket closed before opening (code ${e.code})`));
      for (const c of closers) c(`code ${e.code}`);
    };
    ws.onerror = () => {
      if (!open) reject(new Error("WebSocket failed to open"));
    };
  });

/** Base64 of bytes, for `input_audio_buffer.append`. */
export const base64 = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
