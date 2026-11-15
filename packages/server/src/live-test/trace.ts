/**
 * The recorder's server events beyond `consoleLog` (brief 050 part A): `model.call`, `turn.slowParse` and
 * `turn.fastSlots`. Each goes through an optional `trace` Log, so with the recorder off nothing runs and nothing
 * changes. Numbers, IDs and enum values only, never words.
 */
import type { ClockPort, FastSlotsResult } from "@franki/core";
import type { CallOptions, OpenAIEndpoint, OpenAIPort } from "../openai/fake";
import type { Log } from "../routes/runtime";

type Fields = Record<string, string | number | boolean | string[]>;

/** A short, bounded name: a schema or tool name passes, anything else does not. */
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const named = (v: unknown): string | null => (typeof v === "string" && NAME.test(v) ? v : null);

/** What a request is for: its JSON schema's name when it has one, else the endpoint. */
export function modelCallFields(endpoint: OpenAIEndpoint, body: unknown): Fields {
  const b = (typeof body === "object" && body !== null ? body : {}) as { model?: unknown; text?: { format?: { name?: unknown } }; tools?: unknown; session?: { model?: unknown } };
  const fields: Fields = { purpose: named(b.text?.format?.name) ?? endpoint, endpoint };
  const model = named(b.model) ?? named(b.session?.model);
  if (model !== null) fields.model = model;
  if (Array.isArray(b.tools)) {
    const tools = b.tools.map((t) => named((t as { name?: unknown } | null)?.name)).filter((n): n is string => n !== null);
    if (tools.length > 0) fields.tools = tools.slice(0, 16);
  }
  return fields;
}

/** Token counts from either the normalized Responses usage or an SDK-shaped one, when the answer carries them. */
export function usageFields(result: unknown): Fields {
  const u = (result as { usage?: Record<string, unknown> } | null)?.usage;
  if (typeof u !== "object" || u === null) return {};
  const inTok = u.inputTokens ?? u.input_tokens;
  const outTok = u.outputTokens ?? u.output_tokens;
  const fields: Fields = {};
  if (typeof inTok === "number" && Number.isFinite(inTok)) fields.inTok = inTok;
  if (typeof outTok === "number" && Number.isFinite(outTok)) fields.outTok = outTok;
  const status = (result as { status?: unknown }).status;
  if (status === "completed" || status === "incomplete" || status === "failed") fields.status = status;
  return fields;
}

/**
 * The OpenAIPort with one `model.call` line per request: purpose, model, time, outcome and tokens. The answer and
 * any error pass through untouched; the trace itself never throws.
 */
export function tracedOpenAI(inner: OpenAIPort, trace: Log, clock: ClockPort): OpenAIPort {
  const emit = (fields: Fields) => {
    try {
      trace("model.call", fields);
    } catch {
      // Never into the caller.
    }
  };
  return {
    async call(endpoint: OpenAIEndpoint, body: unknown, options?: CallOptions): Promise<unknown> {
      const start = clock.read().opsClock.now;
      const base = modelCallFields(endpoint, body);
      try {
        const result = await inner.call(endpoint, body, options);
        emit({ ...base, ms: clock.read().opsClock.now - start, ok: true, ...usageFields(result) });
        return result;
      } catch (error) {
        emit({ ...base, ms: clock.read().opsClock.now - start, ok: false, error: error instanceof Error ? named(error.name) ?? "Error" : "unknown" });
        throw error;
      }
    },
  };
}

/** `turn.fastSlots`: time, validity, the reason when not valid, and the kinds of the items. */
export function fastSlotsFields(r: FastSlotsResult): Fields {
  if (r.kind === "valid") return { ms: r.ms, valid: true, kinds: r.out.items.map((i) => i.kind), need: r.out.need };
  return { ms: r.ms, valid: false, reason: r.kind === "invalid" ? r.reason : r.kind, kinds: [] };
}

export function traceFastSlots(trace: Log | undefined, r: FastSlotsResult, ids: Fields): void {
  if (trace === undefined) return;
  try {
    trace("turn.fastSlots", { ...ids, ...fastSlotsFields(r) });
  } catch {
    // Never into the caller.
  }
}
