/**
 * Realtime call control (contracts §6 Realtime; R12, R14, KS07). Call creation and hangups go through the
 * OpenAIPort so tests use Fake_OpenAI. A call OpenAI no longer knows (HTTP 404) counts as already gone, which is
 * a confirmed hangup.
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

/** The session object posted with the SDP offer (R12.2; contracts §6 Realtime). The model comes from Model_Config. */
export function callSession(voiceModel: string) {
  return { type: "realtime", model: voiceModel, tracing: null, audio: { output: { voice: "cedar" } } } as const;
}

export interface CreateCallBody {
  offerSdp: string;
  session: ReturnType<typeof callSession>;
}

/** What the port returns for `realtime.calls.create`: the SDP answer and the raw `Location` header. */
export interface CreateCallResult {
  answerSdp: string;
  location: string | null;
}

/** Bounds of a Realtime call ID as stored in `Session.registeredCallIds` (s128). */
const CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The call ID from a `Location` header such as `/v1/realtime/calls/rtc_abc`, or null if it has none. */
export function callIdFromLocation(location: string | null): string | null {
  if (location === null) return null;
  const path = location.split(/[?#]/)[0]!.replace(/\/+$/, "");
  const last = path.slice(path.lastIndexOf("/") + 1);
  return CALL_ID.test(last) && path.includes("/realtime/calls/") ? last : null;
}

export function isCreateCallResult(v: unknown): v is CreateCallResult {
  const r = v as Partial<CreateCallResult> | null;
  return r !== null && typeof r === "object" && typeof r.answerSdp === "string" && (r.location === null || typeof r.location === "string");
}

export async function createCall(openai: OpenAIPort, body: CreateCallBody): Promise<CreateCallResult> {
  const r = await openai.call("realtime.calls.create", body);
  if (!isCreateCallResult(r)) throw new Error("realtime.calls.create returned an unexpected shape");
  return r;
}
