/**
 * /api/google/* (brief 049 part B): the Google sheet's three calls and the callback page's one. Each answer is
 * validated against its closed response and mapped to what `ui/google/google-machine` needs; a body the contract
 * would refuse is a failure, shown as nothing. Nothing here keeps a code, a state or a token.
 */
import {
  GoogleConnectRequest,
  GoogleConnectResponse,
  GoogleDisconnectRequest,
  GoogleDisconnectResponse,
  GoogleStartRequest,
  GoogleStartResponse,
  GoogleStatusResponse,
  type Schema,
  validate,
} from "@franki/core";
import type { GoogleCallbackOutcome, GoogleDisconnectAnswer, GoogleStartAnswer, GoogleStatusAnswer } from "../ui/google/google-machine";
import type { ApiClient, ApiResult } from "./api";

export const GOOGLE_STATUS_PATH = "/api/google/status";
export const GOOGLE_START_PATH = "/api/google/start";
export const GOOGLE_CONNECT_PATH = "/api/google/connect";
export const GOOGLE_DISCONNECT_PATH = "/api/google/disconnect";
/** Status and start read and write Firestore only. */
export const GOOGLE_STATUS_TIMEOUT_MS = 6_000;
/** Connect and disconnect each make one or two calls to Google on the server. */
export const GOOGLE_CALL_TIMEOUT_MS = 30_000;
/** The only host Google's authorization page may be on. */
export const GOOGLE_AUTHORIZE_ORIGIN = "https://accounts.google.com";

type Failure = Exclude<ApiResult<unknown>, { ok: true }>;
const isConfig = (r: Failure) => r.kind === "http" && r.error === "CONFIG";
/** The server answered and said no, as opposed to no answer, a call in flight, or a server failure. */
const isRefusal = (r: Failure) => r.kind === "http" && r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 408;

async function post(api: ApiClient, path: string, request: Schema<unknown>, body: unknown, timeoutMs: number): Promise<ApiResult<unknown> | null> {
  // A request the contract would refuse is never sent.
  if (!validate(request, body).ok) return null;
  return api.call<unknown>(path, { method: "POST", body, timeoutMs });
}

/** True only for an https URL on Google's authorization host, with no user name or password in it. */
export function isGoogleAuthorizeUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.origin === GOOGLE_AUTHORIZE_ORIGIN && u.username === "" && u.password === "";
}

/** GET /api/google/status. */
export async function readGoogleStatus(api: ApiClient): Promise<GoogleStatusAnswer> {
  const r = await api.call<unknown>(GOOGLE_STATUS_PATH, { method: "GET", timeoutMs: GOOGLE_STATUS_TIMEOUT_MS });
  if (!r.ok) return { ok: false, why: isConfig(r) ? "notConfigured" : "failed" };
  const parsed = validate(GoogleStatusResponse, r.body);
  if (!parsed.ok) return { ok: false, why: "failed" };
  const v = parsed.value as GoogleStatusResponse;
  // Brief 054 (R17.4): the sheet says "simulated" only when the server did, so the mark is carried only when present.
  return "simulated" in v && v.simulated === true ? { ok: true, google: v.google, simulated: true } : { ok: true, google: v.google };
}

/** POST /api/google/start. An answer whose URL is not on Google's authorization host is a failure. */
export async function startGoogle(api: ApiClient): Promise<GoogleStartAnswer> {
  const r = await post(api, GOOGLE_START_PATH, GoogleStartRequest, {}, GOOGLE_STATUS_TIMEOUT_MS);
  if (r === null) return { ok: false, why: "failed" };
  if (!r.ok) return { ok: false, why: isConfig(r) ? "notConfigured" : "failed" };
  const parsed = validate(GoogleStartResponse, r.body);
  if (!parsed.ok) return { ok: false, why: "failed" };
  const url = (parsed.value as GoogleStartResponse).url;
  return isGoogleAuthorizeUrl(url) ? { ok: true, url } : { ok: false, why: "failed" };
}

/**
 * POST /api/google/connect, sent once by the callback page. A refusal (a used or expired state, a grant that can't
 * be kept, another account) is `refused`; no answer, a call in flight or a server failure is `unknown`.
 */
export async function connectGoogle(api: ApiClient, body: GoogleConnectRequest): Promise<GoogleCallbackOutcome> {
  const r = await post(api, GOOGLE_CONNECT_PATH, GoogleConnectRequest, body, GOOGLE_CALL_TIMEOUT_MS);
  if (r === null) return "refused";
  if (!r.ok) return isRefusal(r) ? "refused" : "unknown";
  const parsed = validate(GoogleConnectResponse, r.body);
  return parsed.ok ? (parsed.value as GoogleConnectResponse).outcome : "unknown";
}

/** POST /api/google/disconnect. `failed`: the server answered that it did not; `unknown`: no answer reached here. */
export async function disconnectGoogle(api: ApiClient, body: GoogleDisconnectRequest): Promise<GoogleDisconnectAnswer> {
  const r = await post(api, GOOGLE_DISCONNECT_PATH, GoogleDisconnectRequest, body, GOOGLE_CALL_TIMEOUT_MS);
  if (r === null) return { ok: false, why: "failed" };
  if (!r.ok) return { ok: false, why: r.kind === "http" && r.status !== 429 && r.status !== 408 ? "failed" : "unknown" };
  const parsed = validate(GoogleDisconnectResponse, r.body);
  return parsed.ok ? { ok: true, google: (parsed.value as GoogleDisconnectResponse).google } : { ok: false, why: "unknown" };
}
