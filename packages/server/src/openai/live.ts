/**
 * The live OpenAIPort. Server-only; never constructed in tests (tests/setup/setup.ts blocks the network anyway).
 * `responses.create` takes Responses API params and returns the normalized ResponsesResult.
 * `realtime.calls.create` posts the SDP offer to `/v1/realtime/calls` and returns the answer and `Location`;
 * `realtime.calls.hangup` posts to `/v1/realtime/calls/{id}/hangup`. `decisions.create` posts to `/v1/decisions`.
 */
import OpenAI from "openai";
import { type Env, openaiApiKey } from "../config/env";
import type { OpenAIEndpoint, OpenAIPort } from "./fake";
import { type CreateCallBody, type CreateCallResult, HANGUP_CALL_DEADLINE_MS } from "./realtime-calls";
import type { ResponsesResult } from "./responses";

interface SdkResponse {
  status?: string | null;
  output_text?: string | null;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number } | null;
}

export function normalizeResponse(r: SdkResponse): ResponsesResult {
  let refusal: string | null = null;
  for (const item of r.output ?? []) {
    for (const c of item.content ?? []) if (c.type === "refusal" && typeof c.refusal === "string") refusal = c.refusal;
  }
  const status = r.status === "completed" ? "completed" : r.status === "incomplete" ? "incomplete" : "failed";
  const text = typeof r.output_text === "string" && r.output_text.length > 0 ? r.output_text : null;
  return {
    status,
    outputText: refusal === null ? text : null,
    refusal,
    usage: { inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0 },
  };
}

export function liveOpenAI(env: Env = process.env): OpenAIPort {
  let client: OpenAI | null = null;
  const sdk = () => (client ??= new OpenAI({ apiKey: openaiApiKey(env) }));
  return {
    async call(endpoint: OpenAIEndpoint, body: unknown): Promise<unknown> {
      switch (endpoint) {
        case "responses.create": {
          const r = (await sdk().responses.create(body as never)) as unknown as SdkResponse;
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
