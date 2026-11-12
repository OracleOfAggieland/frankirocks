/**
 * The Browser_Client's only way to call the Web_App routes (R9.4, R10.1). Every call except `/api/health` carries
 * the signed-in user's Firebase ID token as `Authorization: Bearer`. While signed out the client sends nothing to
 * any `/api/` route except `/api/health`, and returns `signedOut` without touching the network.
 *
 * The browser sets `Origin` itself on same-origin POSTs, which the Route_Guard checks (R10.3).
 */
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
        let token: string | null;
        try {
          token = await deps.getToken();
        } catch {
          // A token step that rejects (a failed refresh) is a network failure, never a thrown call (B1).
          return { ok: false, kind: "network" };
        }
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
