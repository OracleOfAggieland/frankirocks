/**
 * Route errors and their HTTP mapping (design "Routes and error handling"; contracts §6 Error).
 * Error bodies are `{error, retryAfterMs}` only. They never carry Memory content (R28.1).
 */
import type { ErrorCode, WireError } from "@franki/core";
import { ConfigError } from "../config/env";
import { isStoreError } from "../store/errors";

export class RouteError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterMs: number;

  constructor(code: ErrorCode, status: number, retryAfterMs = 0, detail = "") {
    super(`${code}${detail ? `: ${detail}` : ""}`);
    this.name = "RouteError";
    this.code = code;
    this.status = status;
    this.retryAfterMs = Math.max(0, Math.min(5000, Math.trunc(retryAfterMs)));
  }

  get body(): WireError {
    return { error: this.code, retryAfterMs: this.retryAfterMs };
  }
}

export const authError = (detail = "") => new RouteError("AUTH", 401, 0, detail);
export const originError = () => new RouteError("AUTH", 403, 0, "origin");
export const parseError = (detail = "") => new RouteError("PARSE", 400, 0, detail);
export const scopeError = () => new RouteError("SCOPE", 404, 0);
export const staleError = (detail = "") => new RouteError("STALE", 409, 0, detail);
export const hashError = () => new RouteError("HASH", 409, 0);
export const oversizeError = () => new RouteError("LIMIT", 413, 0);
export const inFlightError = () => new RouteError("LIMIT", 429, 1000);
export const barrierError = () => new RouteError("BARRIER", 423, 0);
export const dependencyError = (retryAfterMs = 1000, detail = "") => new RouteError("DEPENDENCY", 503, Math.max(1, retryAfterMs), detail);
export const configError = (status = 500, detail = "") => new RouteError("CONFIG", status, 0, detail);

/**
 * Maps any thrown value to a RouteError. Kernel errors from the Store_Port become PARSE (invalid input or
 * oversize from a request), STALE (a lost compare-and-set the route did not retry) or SCOPE (tenant mismatch).
 * Anything unknown is DEPENDENCY, so a Firestore or OpenAI failure tells the browser to retry.
 */
export function toRouteError(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  if (error instanceof ConfigError) return configError(500, error.detail);
  // Kernel `unsupported` (fixture clock mode, R6.7) is a configuration state this slice cannot serve.
  if (error instanceof Error && (error as { code?: unknown }).code === "unsupported") return configError(500, "unsupported");
  // devAdmit refusing in production (R17.5).
  if (error instanceof Error && error.name === "DevAdmitRefusedError") return configError(500, "devAdmit");
  if (isStoreError(error)) {
    switch (error.code) {
      case "staleRevision":
        return new RouteError("STALE", 409, 250, "staleRevision");
      case "tenantMismatch":
        return scopeError();
      case "oversize":
        return new RouteError("LIMIT", 413, 0, "oversize");
      case "invalidInput":
        return parseError("invalidInput");
    }
  }
  return dependencyError(1000);
}
