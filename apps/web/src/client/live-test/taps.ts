/**
 * Brief 050 part B, items 2, 3 and 5: what the recorder hears from the voice client, the API client and the
 * stores. Names, IDs, enums and times only, except the two completed-transcript events, whose text goes out as
 * words lines. Realtime deltas are counted per response and type, never recorded one by one.
 */
import { type LatencyRow, type VoiceCommand, type VoiceEvent, type VoiceState, finishRow } from "@franki/core";
import type { ApiObserve } from "../api";
import type { VoiceObserver } from "../voice-client";
import { type Fields, oneDecimal } from "./recorder";

/** The part of the recorder the taps write to. */
export interface Sink {
  emit(kind: string, fields?: Fields): void;
  words(kind: "words.owner" | "words.franki" | "words.typed", text: string, fields?: Fields): void;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** At most this many delta groups are open at once; the oldest is written out early past it. */
export const MAX_DELTA_GROUPS = 64;

interface DeltaGroup {
  type: string;
  responseId: string | undefined;
  itemId: string | undefined;
  n: number;
  firstM: number;
  lastM: number;
}

/** The IDs a Realtime server event carries, by the names the Realtime API uses. Never its text. */
export function realtimeIds(ev: Rec): { eventId?: string; responseId?: string; itemId?: string } {
  const response = isRec(ev.response) ? ev.response : null;
  const item = isRec(ev.item) ? ev.item : null;
  const out: { eventId?: string; responseId?: string; itemId?: string } = {};
  const eventId = str(ev.event_id);
  const responseId = str(ev.response_id) ?? str(response?.id);
  const itemId = str(ev.item_id) ?? str(item?.id);
  if (eventId !== undefined) out.eventId = eventId;
  if (responseId !== undefined) out.responseId = responseId;
  if (itemId !== undefined) out.itemId = itemId;
  return out;
}

/** Enum-valued extras worth keeping on a few Realtime events. */
function realtimeExtras(ev: Rec): Fields {
  const type = ev.type;
  if (type === "error" && isRec(ev.error)) {
    // The error's type and code are enums; its message is free text and stays out.
    return { errType: str(ev.error.type), code: str(ev.error.code), causeEventId: str(ev.error.event_id) };
  }
  if (type === "response.done" && isRec(ev.response)) return { status: str(ev.response.status) };
  if (type === "response.function_call_arguments.done") return { name: str(ev.name), callId: str(ev.call_id) };
  return {};
}

/** Keys of a voice event that hold IDs or enums. Text (`typedSubmitted.text`) and hashes are never read. */
const VOICE_ID_KEYS = ["turnId", "callId", "permitId", "eventId", "visitId", "name", "source", "supersede", "zone"] as const;

export function voiceEventFields(e: VoiceEvent): Fields {
  const r = e as unknown as Rec;
  const out: Fields = { type: e.type };
  for (const k of VOICE_ID_KEYS) if (k in r) out[k] = r[k];
  const response = isRec(r.response) ? r.response : null;
  if (response !== null) {
    if (typeof response.status === "string") out.status = response.status;
    const stamp = isRec(response.stamp) ? response.stamp : null;
    if (stamp !== null) {
      if (typeof stamp.sessionId === "string") out.sessionId = stamp.sessionId;
      if (typeof stamp.generation === "number") out.generation = stamp.generation;
      if (typeof stamp.turnId === "string" && out.turnId === undefined) out.turnId = stamp.turnId;
    }
  }
  return out;
}

export function voiceCommandFields(c: VoiceCommand): Fields {
  const out: Fields = { type: c.kind };
  switch (c.kind) {
    case "send":
      out.event = c.event.type;
      break;
    case "armTimer":
      out.name = c.name;
      break;
    case "connect":
      out.sessionId = c.sessionId;
      out.generation = c.generation;
      break;
    case "tool":
      out.callId = c.body.callId;
      break;
    case "turn":
      out.turnId = c.body.turnId;
      break;
    default:
      break;
  }
  return out;
}

export interface VoiceTapDeps {
  sink: Sink;
  /** ms since page load. */
  now: () => number;
  /** Told the peer connection and data channel as they come and go (for rt.state and rtc.stats). */
  onLink?: (peer: unknown, channel: unknown) => void;
}

/** The voice client's watcher: voice.event, voice.cmd, rt.event, rt.deltas and the two transcript words lines. */
export function createVoiceTap(deps: VoiceTapDeps): VoiceObserver & { flushDeltas(): void } {
  const { sink, now } = deps;
  const groups = new Map<string, DeltaGroup>();

  const writeGroup = (key: string) => {
    const g = groups.get(key);
    if (g === undefined) return;
    groups.delete(key);
    sink.emit("rt.deltas", { type: g.type, responseId: g.responseId, itemId: g.itemId, n: g.n, firstM: g.firstM, lastM: g.lastM });
  };
  const flushWhere = (match: (g: DeltaGroup) => boolean) => {
    for (const [key, g] of [...groups]) if (match(g)) writeGroup(key);
  };

  const onRealtime = (ev: Rec) => {
    const type = str(ev.type);
    if (type === undefined) return;
    const ids = realtimeIds(ev);
    if (type.endsWith(".delta")) {
      const key = `${type}|${ids.responseId ?? ""}|${ids.itemId ?? ""}`;
      const m = oneDecimal(now());
      const g = groups.get(key);
      if (g === undefined) {
        if (groups.size >= MAX_DELTA_GROUPS) writeGroup(groups.keys().next().value as string);
        groups.set(key, { type, responseId: ids.responseId, itemId: ids.itemId, n: 1, firstM: m, lastM: m });
      } else {
        g.n++;
        g.lastM = m;
      }
      return;
    }
    sink.emit("rt.event", { type, ...ids, ...realtimeExtras(ev) });
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = str(ev.transcript);
      if (text !== undefined) sink.words("words.owner", text, { itemId: ids.itemId });
      flushWhere((g) => g.itemId !== undefined && g.itemId === ids.itemId && g.responseId === undefined);
    } else if (type === "conversation.item.input_audio_transcription.failed") {
      flushWhere((g) => g.itemId !== undefined && g.itemId === ids.itemId && g.responseId === undefined);
    } else if (type === "response.output_audio_transcript.done") {
      const text = str(ev.transcript);
      if (text !== undefined) sink.words("words.franki", text, { responseId: ids.responseId });
    } else if (type === "response.done") {
      flushWhere((g) => g.responseId !== undefined && g.responseId === ids.responseId);
    }
  };

  return {
    event(e) {
      if (e.type === "realtime") {
        if (isRec(e.event)) onRealtime(e.event as unknown as Rec);
        return;
      }
      sink.emit("voice.event", voiceEventFields(e));
    },
    command(c) {
      sink.emit("voice.cmd", voiceCommandFields(c));
      if (c.kind === "teardown") flushWhere(() => true);
    },
    link(peer, channel) {
      deps.onLink?.(peer, channel);
    },
    flushDeltas() {
      flushWhere(() => true);
    },
  };
}

/** The API client's watcher: one api.call per request that reached the network. */
export function createApiTap(sink: Sink, now: () => number): ApiObserve {
  return (route, method) => {
    const start = now();
    const name = route.startsWith("/api/") ? route.slice(5) : route;
    return ({ status, err }) => {
      sink.emit("api.call", { route: name, method, status: status ?? undefined, ms: oneDecimal(now() - start), err: err ?? undefined });
    };
  };
}

/** A latency row as an event: every field, nulls left out. */
export function latencyFields(row: LatencyRow): Fields {
  return { ...row } as unknown as Fields;
}

/**
 * Item 3: each latency row goes out once, when it is final. A row is final when the machine pushes it to `rows`
 * (the next turn started, or the turn closed). When the call ends with a row still open, that row goes out as it
 * stands, so the rows outlive the call.
 */
export function createLatencyTap(sink: Sink): { onVoice(v: VoiceState): void } {
  const sent = new Set<string>();
  const send = (row: LatencyRow) => {
    if (sent.has(row.turnId)) return;
    sent.add(row.turnId);
    sink.emit("latency.row", latencyFields(row));
  };
  return {
    onVoice(v) {
      for (const row of v.latency.rows) send(row);
      const cur = v.latency.current;
      if (v.phase === "CLOSED" && cur !== null && cur.commit !== null) send(finishRow(cur));
    },
  };
}

/** Writes a store's view when what it shows changes. */
export function changes<T>(sink: Sink, kind: string, fields: (view: T) => Fields): (view: T) => void {
  let last = "";
  return (view) => {
    const f = fields(view);
    const key = JSON.stringify(f);
    if (key === last) return;
    last = key;
    sink.emit(kind, f);
  };
}

export interface RadioLike {
  power: string;
  panel: string;
  signal: string;
  volume: number;
  station: { id: string } | null;
}

export const radioFields = (v: RadioLike): Fields => ({
  state: v.power === "off" ? "off" : v.signal,
  power: v.power,
  panel: v.panel,
  signal: v.signal,
  stationId: v.station?.id,
  volume: Math.round(v.volume * 100) / 100,
});

export const phoneFields = (v: { phase: string; reason: string | null }): Fields => ({ state: v.phase, reason: v.reason ?? undefined });

// ---------------------------------------------------------------------------------------------
// Cards (item 5): shown and closed (gone from the dock) by ID; approved and declined from an approval card's buttons.

export interface CardLike {
  id: string;
  kind: string;
  onYes?: () => void;
  onNotNow?: () => void;
}

export function createCardTap(sink: Sink): { wrap<C extends CardLike>(cards: C[]): C[]; seen(cards: readonly CardLike[]): void } {
  let shown = new Map<string, string>();
  const wrapFn = (f: (() => void) | undefined, card: CardLike, action: string) =>
    f === undefined
      ? undefined
      : () => {
          sink.emit("card", { kind: card.kind, id: card.id, action });
          f();
        };
  return {
    wrap<C extends CardLike>(cards: C[]): C[] {
      return cards.map((c) => {
        if (c.kind === "approval") return { ...c, onYes: wrapFn(c.onYes, c, "approved"), onNotNow: wrapFn(c.onNotNow, c, "declined") } as C;
        return c;
      });
    },
    seen(cards) {
      const now = new Map(cards.map((c) => [c.id, c.kind]));
      for (const [id, kind] of now) if (!shown.has(id)) sink.emit("card", { kind, id, action: "shown" });
      for (const [id, kind] of shown) if (!now.has(id)) sink.emit("card", { kind, id, action: "closed" });
      shown = now;
    },
  };
}
