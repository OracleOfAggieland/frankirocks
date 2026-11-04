/**
 * Realtime call control (contracts §6 Realtime; R14, KS07). Hangups go through the OpenAIPort so tests use
 * Fake_OpenAI. A call OpenAI no longer knows (HTTP 404) counts as already gone, which is a confirmed hangup.
 */
import type { OpenAIPort } from "./fake";

export type HangupOutcome = "hungUp" | "gone";

export async function hangupCall(openai: OpenAIPort, callId: string): Promise<HangupOutcome> {
  try {
    await openai.call("realtime.calls.hangup", { callId });
    return "hungUp";
  } catch (error) {
    if ((error as { status?: unknown } | null)?.status === 404) return "gone";
    throw error;
  }
}
