/**
 * Brief 049 ruling 19: the Google port and its live half. Plain `fetch`, an 8 s timeout, `redirect: "error"`, no
 * Google SDK. Read-only by construction: the port reaches exactly the five endpoints in `GOOGLE_ENDPOINTS` with their
 * pinned methods. The token endpoint and revoke are POSTs; every data method is a GET with no body. Nothing here can
 * send, draft, label or change mail, or create, change or delete an event. A test pins all of it.
 *
 * No token, code or verifier is ever put in an error, and Google's own error text is never read beyond its closed
 * `error` code.
 */
import type { GoogleConfig } from "./config";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
export const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Every request the port can make, as `METHOD url` (a message ID is `{id}`). */
export const GOOGLE_ENDPOINTS = [`POST ${TOKEN_URL}`, `POST ${REVOKE_URL}`, `GET ${MESSAGES_URL}`, `GET ${MESSAGES_URL}/{id}`, `GET ${EVENTS_URL}`] as const;

/** Ruling 19 (and ruling 5's Google call timeout). */
export const GOOGLE_CALL_TIMEOUT_MS = 8_000;
/** An answer longer than this is not read (an unknown outcome). */
export const GOOGLE_ANSWER_MAX_CHARS = 5_000_000;
/** The most messages one list asks for, and the most events (ruling 25). */
export const MESSAGES_LIST_MAX = 50;
export const EVENTS_LIST_MAX = 50;

/**
 * The closed class of a failed Google call.
 * - `invalidGrant`: the refresh token is dead (expired, revoked); the connector goes `expired`.
 * - `invalidToken`: revoke's answer for a token that is already gone; counts as revoked.
 * - `auth`: a data call's access token was refused (401).
 * - `notFound`: a message is gone (404).
 * - `refused`: Google answered a 4xx with an error body, or an argument was refused before any request.
 * - `unknown`: timeout, network, 5xx, 429 or an unreadable answer. The outcome is not known.
 */
export type GoogleProblem = "invalidGrant" | "invalidToken" | "auth" | "notFound" | "refused" | "unknown";

/** A failed Google call. `definite` is true when the request certainly did nothing. Carries no secret. */
export class GoogleCallError extends Error {
  constructor(
    readonly problem: GoogleProblem,
    readonly definite: boolean,
  ) {
    super(`google call failed: ${problem}`);
    this.name = "GoogleCallError";
  }
}

export interface GoogleTokens {
  accessToken: string;
  /** Present on a first consent only (`prompt=consent` forces it). */
  refreshToken: string | null;
  /** What was actually granted (granular consent). */
  scope: string[];
  idToken: string | null;
}

export interface GoogleRefreshed {
  accessToken: string;
  /** Null when the answer leaves it out. */
  scope: string[] | null;
}

export interface MessageRef {
  id: string;
  threadId: string;
}

/** One message as `format=full` returns it. `payload` is read defensively by `mail.ts`. */
export interface GmailMessage {
  id: string;
  threadId: string;
  /** Epoch milliseconds, or null. */
  internalDate: number | null;
  labelIds: string[];
  payload: unknown;
}

export interface EventList {
  timeZone: string | null;
  items: unknown[];
}

export interface GooglePort {
  exchangeCode(config: GoogleConfig, x: { code: string; verifier: string; redirectUri: string }): Promise<GoogleTokens>;
  refresh(config: GoogleConfig, refreshToken: string): Promise<GoogleRefreshed>;
  /** Removes the whole grant at Google. */
  revoke(token: string): Promise<void>;
  listMessages(accessToken: string, q: string, max: number): Promise<MessageRef[]>;
  getMessage(accessToken: string, id: string): Promise<GmailMessage>;
  listEvents(accessToken: string, x: { timeMin: string; timeMax: string; max: number }): Promise<EventList>;
}

// ---------------------------------------------------------------------------------------------
// Reading Google's answers. Anything off-shape is an unknown outcome.

const unknown = (): never => {
  throw new GoogleCallError("unknown", false);
};
const refuse = (): never => {
  throw new GoogleCallError("refused", true);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown, max = 4096): string => (typeof v === "string" && v !== "" && v.length <= max ? v : unknown());
const sOrNull = (v: unknown, max = 8192): string | null => (v === undefined || v === null ? null : typeof v === "string" && v.length <= max ? v : unknown());
const scopes = (v: unknown): string[] => (typeof v === "string" ? v.split(" ").filter((x) => x !== "").slice(0, 32) : unknown());

const TOKEN_SHAPE = /^[\x21-\x7e]{1,4096}$/;
const MESSAGE_ID = /^[A-Za-z0-9]{1,64}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ERROR_CODE = /^[a-z_]{1,64}$/;

const clampCount = (n: number, max: number) => (Number.isInteger(n) ? Math.min(Math.max(n, 1), max) : 1);

// ---------------------------------------------------------------------------------------------
// The live port.

export type GoogleFetch = (
  url: string,
  init: { method: "GET" | "POST"; redirect: "error"; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> } | { ok: boolean; status: number; json(): Promise<unknown> }>;

async function readBody(r: Awaited<ReturnType<GoogleFetch>>): Promise<unknown> {
  if ("text" in r) {
    const text = await r.text();
    if (text.length > GOOGLE_ANSWER_MAX_CHARS) return unknown();
    return text === "" ? {} : (JSON.parse(text) as unknown);
  }
  return r.json();
}

/** The live port. `fetchFn` is for tests; by default it is the global `fetch`, read at call time. */
export function googlePort(fetchFn?: GoogleFetch): GooglePort {
  async function call(method: "GET" | "POST", url: string, headers: Record<string, string>, body: string | undefined, kind: "token" | "revoke" | "data"): Promise<Record<string, unknown>> {
    const f: GoogleFetch = fetchFn ?? (globalThis.fetch as unknown as GoogleFetch);
    let response: Awaited<ReturnType<GoogleFetch>>;
    try {
      response = await f(url, { method, redirect: "error", headers, ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(GOOGLE_CALL_TIMEOUT_MS) });
    } catch {
      throw new GoogleCallError("unknown", false);
    }
    let data: unknown;
    try {
      data = await readBody(response);
    } catch {
      throw new GoogleCallError("unknown", false);
    }
    if (!response.ok) {
      const st = response.status;
      const code = isObj(data) && typeof data.error === "string" && ERROR_CODE.test(data.error) ? data.error : null;
      if (st >= 500 || st === 429 || st < 400) throw new GoogleCallError("unknown", false);
      if (kind === "token" && code === "invalid_grant") throw new GoogleCallError("invalidGrant", true);
      if (kind === "revoke" && code === "invalid_token") throw new GoogleCallError("invalidToken", true);
      if (kind === "data" && st === 401) throw new GoogleCallError("auth", true);
      if (kind === "data" && st === 404) throw new GoogleCallError("notFound", true);
      // Any other 4xx was refused; a token-endpoint 4xx without Google's error body is not known to be one.
      throw new GoogleCallError("refused", kind === "data" || code !== null);
    }
    return isObj(data) ? data : unknown();
  }

  const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
  const formHeaders = { "content-type": "application/x-www-form-urlencoded" };
  const bearer = (accessToken: string) => {
    if (!TOKEN_SHAPE.test(accessToken)) refuse();
    return { authorization: `Bearer ${accessToken}`, accept: "application/json" };
  };

  const port: GooglePort = {
    async exchangeCode(config, x) {
      if (x.code === "" || x.code.length > 512 || x.verifier.length < 43 || x.verifier.length > 128) refuse();
      const data = await call(
        "POST",
        TOKEN_URL,
        formHeaders,
        form({ grant_type: "authorization_code", code: x.code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: x.redirectUri, code_verifier: x.verifier }),
        "token",
      );
      const accessToken = s(data.access_token);
      const refreshToken = sOrNull(data.refresh_token, 4096);
      try {
        return { accessToken, refreshToken, scope: scopes(data.scope), idToken: sOrNull(data.id_token) };
      } catch (error) {
        // Review S9: the exchange worked but its answer can't be read. The fresh grant must not outlive this call.
        try {
          await port.revoke(refreshToken ?? accessToken);
        } catch {
          // Best effort: the caller's outcome is unknown either way.
        }
        throw error;
      }
    },
    async refresh(config, refreshToken) {
      if (!TOKEN_SHAPE.test(refreshToken)) refuse();
      const data = await call("POST", TOKEN_URL, formHeaders, form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret }), "token");
      return { accessToken: s(data.access_token), scope: data.scope === undefined ? null : scopes(data.scope) };
    },
    async revoke(token) {
      if (!TOKEN_SHAPE.test(token)) refuse();
      await call("POST", REVOKE_URL, formHeaders, form({ token }), "revoke");
    },
    async listMessages(accessToken, q, max) {
      const headers = bearer(accessToken);
      if (q.length > 1024) refuse();
      const params = new URLSearchParams({ q, maxResults: String(clampCount(max, MESSAGES_LIST_MAX)) });
      const data = await call("GET", `${MESSAGES_URL}?${params.toString()}`, headers, undefined, "data");
      const list = data.messages === undefined ? [] : Array.isArray(data.messages) ? data.messages : unknown();
      return list.slice(0, MESSAGES_LIST_MAX).map((m) => (isObj(m) && typeof m.id === "string" && MESSAGE_ID.test(m.id) ? { id: m.id, threadId: typeof m.threadId === "string" && MESSAGE_ID.test(m.threadId) ? m.threadId : m.id } : unknown()));
    },
    async getMessage(accessToken, id) {
      const headers = bearer(accessToken);
      if (!MESSAGE_ID.test(id)) refuse();
      const data = await call("GET", `${MESSAGES_URL}/${encodeURIComponent(id)}?format=full`, headers, undefined, "data");
      if (data.id !== id) unknown();
      const internal = typeof data.internalDate === "string" && /^\d{1,15}$/.test(data.internalDate) ? Number(data.internalDate) : null;
      const labels = Array.isArray(data.labelIds) ? data.labelIds.filter((l): l is string => typeof l === "string" && l.length <= 64).slice(0, 64) : [];
      return { id, threadId: typeof data.threadId === "string" && MESSAGE_ID.test(data.threadId) ? data.threadId : id, internalDate: internal, labelIds: labels, payload: data.payload ?? null };
    },
    async listEvents(accessToken, x) {
      const headers = bearer(accessToken);
      if (!RFC3339.test(x.timeMin) || !RFC3339.test(x.timeMax)) refuse();
      const params = new URLSearchParams({ timeMin: x.timeMin, timeMax: x.timeMax, singleEvents: "true", orderBy: "startTime", maxResults: String(clampCount(x.max, EVENTS_LIST_MAX)) });
      const data = await call("GET", `${EVENTS_URL}?${params.toString()}`, headers, undefined, "data");
      const items = data.items === undefined ? [] : Array.isArray(data.items) ? data.items : unknown();
      const zone = typeof data.timeZone === "string" && data.timeZone.length <= 64 ? data.timeZone : null;
      return { timeZone: zone, items: items.slice(0, EVENTS_LIST_MAX) };
    },
  };
  return port;
}

export const liveGoogle: GooglePort = googlePort();
