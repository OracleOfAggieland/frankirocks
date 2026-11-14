/**
 * The live OpenAIPort. Server-only; never constructed in tests (tests/setup/setup.ts blocks the network anyway).
 * `responses.create` takes Responses API params and returns the normalized ResponsesResult.
 * `realtime.calls.create` posts the SDP offer to `/v1/realtime/calls` and returns the answer and `Location`;
 * `realtime.calls.hangup` posts to `/v1/realtime/calls/{id}/hangup`. `decisions.create` posts to `/v1/decisions`.
 */
import OpenAI from "openai";
import { type Env, openaiApiKey } from "../config/env";
import type { CallOptions, OpenAIEndpoint, OpenAIPort } from "./fake";
import { type CreateCallBody, type CreateCallResult, HANGUP_CALL_DEADLINE_MS } from "./realtime-calls";
import type { ResponsesFunctionCall, ResponsesResult } from "./responses";

interface SdkResponse {
  status?: string | null;
  output_text?: string | null;
  output?: { type: string; name?: string; arguments?: string; call_id?: string; status?: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number } | null;
}

/** Brief 046 part C: a complete `read_money` call's arguments; the turn route validates them against `MoneyArgs`. */
function moneyCall(r: SdkResponse): { moneyCallArguments?: string } {
  const item = r.output?.find((i) => i.type === "function_call" && i.name === "read_money" && (i.status === undefined || i.status === "completed"));
  return item !== undefined && typeof item.arguments === "string" && item.arguments.length <= 2048 ? { moneyCallArguments: item.arguments } : {};
}

/** Brief 049 part A: the errand helper's tool calls in one response must fit this many, and each its arguments. */
export const FUNCTION_CALLS_MAX = 16;
const FUNCTION_ARGS_CHARS = 4096;
const OUTPUT_ITEMS_MAX = 24;

/**
 * Brief 049 part A, ruling 5: the complete function calls with a call ID, and the output items to send back with
 * their outputs. Nothing when there is none, so every other caller's result is as before.
 */
function functionCalls(r: SdkResponse): { functionCalls?: ResponsesFunctionCall[]; outputItems?: unknown[] } {
  const calls: ResponsesFunctionCall[] = [];
  for (const i of r.output ?? []) {
    if (i.type !== "function_call" || (i.status !== undefined && i.status !== "completed")) continue;
    if (typeof i.call_id !== "string" || typeof i.name !== "string" || typeof i.arguments !== "string" || i.arguments.length > FUNCTION_ARGS_CHARS) continue;
    calls.push({ callId: i.call_id, name: i.name, arguments: i.arguments });
  }
  if (calls.length === 0) return {};
  return { functionCalls: calls.slice(0, FUNCTION_CALLS_MAX), outputItems: (r.output ?? []).slice(0, OUTPUT_ITEMS_MAX) };
}

export function normalizeResponse(r: SdkResponse): ResponsesResult {
  let refusal: string | null = null;
  for (const item of r.output ?? []) {
    for (const c of item.content ?? []) if (c.type === "refusal" && typeof c.refusal === "string") refusal = c.refusal;
  }
  const status = r.status === "completed" ? "completed" : r.status === "incomplete" ? "incomplete" : "failed";
  const text = typeof r.output_text === "string" && r.output_text.length > 0 ? r.output_text : null;
  return {
    ...(r.output?.some((item) =>
      item.type === "function_call" && item.name === "make_phone_call" &&
      (item.status === undefined || item.status === "completed") && /^\s*\{\s*\}\s*$/.test(item.arguments ?? "")
    ) ? { phoneCallRequested: true } : {}),
    ...moneyCall(r),
    ...functionCalls(r),
    status,
    outputText: refusal === null ? text : null,
    refusal,
    usage: { inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0 },
  };
}

/**
 * Review fix R5 of brief 049: a caller with its own deadline (the errand helper) passes it, so the SDK stops the
 * request there, and makes no retries of its own (the caller owns its one retry). Undefined for every other caller.
 */
export function responsesRequestOptions(options: CallOptions | undefined): { maxRetries: 0; timeout?: number; signal?: AbortSignal } | undefined {
  if (options === undefined) return undefined;
  return { maxRetries: 0, ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }), ...(options.signal === undefined ? {} : { signal: options.signal }) };
}

export function liveOpenAI(env: Env = process.env): OpenAIPort {
  let client: OpenAI | null = null;
  const sdk = () => (client ??= new OpenAI({ apiKey: openaiApiKey(env) }));
  return {
    async call(endpoint: OpenAIEndpoint, body: unknown, options?: CallOptions): Promise<unknown> {
      switch (endpoint) {
        case "responses.create": {
          const r = (await sdk().responses.create(body as never, responsesRequestOptions(options))) as unknown as SdkResponse;
          return normalizeResponse(r);
        }
        case "realtime.calls.hangup": {
          const { callId } = body as { callId: string };
          // No SDK retries: the hangup Job owns retries and backoff, and hidden retries used up the close budget.
          await sdk().post(`/realtime/calls/${encodeURIComponent(callId)}/hangup`, { maxRetries: 0, timeout: HANGUP_CALL_DEADLINE_MS });
          return null;
        }
        case "decisions.create":
          // POST /v1/decisions (TurnIntents, voice-control R11.2). The caller owns the 350 ms deadline, so no SDK retries.
          return sdk().decisions.create(body as never, { maxRetries: 0 });
        case "realtime.calls.create": {
          // Multipart `sdp` + `session` (the SDK encodes it); the answer is the SDP body, the call ID is in Location.
          const { offerSdp, session } = body as CreateCallBody;
          const res = await sdk().realtime.calls.create({ sdp: offerSdp, session: session as never });
          const result: CreateCallResult = { answerSdp: await res.text(), location: res.headers.get("location") };
          return result;
        }
      }
    },
  };
}
