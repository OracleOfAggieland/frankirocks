/**
 * The Browser_Client's only way to call the Web_App routes (R9.4, R10.1). Every call except `/api/health` carries
 * the signed-in user's Firebase ID token as `Authorization: Bearer`. While signed out the client sends nothing to
 * any `/api/` route except `/api/health`, and returns `signedOut` without touching the network.
 *
 * The browser sets `Origin` itself on same-origin POSTs, which the Route_Guard checks (R10.3).
 */
import { MemoryResponse, type MemoryView, validate } from "@franki/core";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const HEALTH_PATH = "/api/health";

export interface ApiClientDeps {
  /** The current ID token, or null while signed out. */
  getToken: () => Promise<string | null>;
  fetch: FetchLike;
}

export interface ApiCallOptions {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | null | undefined>;
  /** Abort and return `timeout` after this many ms (setTimeout; no clock read). */
  timeoutMs?: number;
}

export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; kind: "signedOut" }
  | { ok: false; kind: "timeout" }
  | { ok: false; kind: "network" }
  /** The route answered with an error status; `error` is the contracts §6 ErrorCode when the body has one. */
  | { ok: false; kind: "http"; status: number; error: string | null; retryAfterMs: number };

export interface ApiClient {
  call<T>(path: string, options?: ApiCallOptions): Promise<ApiResult<T>>;
}

function withQuery(path: string, query: ApiCallOptions["query"]): string {
  if (query === undefined) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== null && v !== undefined) params.set(k, v);
  const qs = params.toString();
  return qs === "" ? path : `${path}?${qs}`;
}

function errorFields(body: unknown): { error: string | null; retryAfterMs: number } {
  const b = body as { error?: unknown; retryAfterMs?: unknown } | null;
  return {
    error: typeof b?.error === "string" ? b.error : null,
    retryAfterMs: typeof b?.retryAfterMs === "number" && Number.isFinite(b.retryAfterMs) ? b.retryAfterMs : 0,
  };
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  return {
    async call<T>(path: string, options: ApiCallOptions = {}): Promise<ApiResult<T>> {
      if (!path.startsWith("/api/")) throw new Error("ApiClient only calls /api/ routes");
      const route = path.split("?")[0];
      const headers: Record<string, string> = {};
      if (route !== HEALTH_PATH) {
        const token = await deps.getToken();
        if (token === null || token === "") return { ok: false, kind: "signedOut" };
        headers.authorization = `Bearer ${token}`;
      }
      const method = options.method ?? (options.body === undefined ? "GET" : "POST");
      if (options.body !== undefined) headers["content-type"] = "application/json";

      const controller = new AbortController();
      let timedOut = false;
      const timer =
        options.timeoutMs === undefined
          ? null
          : setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, options.timeoutMs);
      try {
        const response = await deps.fetch(withQuery(path, options.query), {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        if (!response.ok) return { ok: false, kind: "http", status: response.status, ...errorFields(body) };
        return { ok: true, status: response.status, body: body as T };
      } catch {
        return timedOut ? { ok: false, kind: "timeout" } : { ok: false, kind: "network" };
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// GET /api/memory (brief 020): what the screen may show about memory.

/** The route's budget is 3 s (contracts §6); the client waits a little longer. */
export const MEMORY_TIMEOUT_MS = 4_000;

export type MemoryRead = { ok: true; body: MemoryResponse } | { ok: false; why: "signedOut" | "failed" };

/** One read of a view, validated against the closed response. Anything else is a failure, shown as nothing. */
export async function readMemory(api: ApiClient, view: MemoryView, opts: { id?: string | null; cursor?: string | null } = {}): Promise<MemoryRead> {
  const r = await api.call<unknown>("/api/memory", { method: "GET", query: { view, id: opts.id ?? null, cursor: opts.cursor ?? null }, timeoutMs: MEMORY_TIMEOUT_MS });
  if (!r.ok) return { ok: false, why: r.kind === "signedOut" ? "signedOut" : "failed" };
  const parsed = validate(MemoryResponse, r.body);
  return parsed.ok ? { ok: true, body: parsed.value as MemoryResponse } : { ok: false, why: "failed" };
}
