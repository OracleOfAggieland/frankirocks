/**
 * Route errors and their HTTP mapping (design "Routes and error handling"; contracts §6 Error).
 * Error bodies are `{error, retryAfterMs}` only. They never carry Memory content (R28.1).
 */
import type { ErrorCode, WireError } from "@franki/core";
import { APIError as OpenAIAPIError } from "openai";
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

/** How much of an infrastructure error's message the `route.dependency` log line keeps. */
export const DEPENDENCY_MESSAGE_CAP = 200;

/** gRPC status names by number. Firestore (google-gax) errors carry the number as `code`, such as 10 for ABORTED. */
const GRPC_STATUS = [
  "OK",
  "CANCELLED",
  "UNKNOWN",
  "INVALID_ARGUMENT",
  "DEADLINE_EXCEEDED",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "FAILED_PRECONDITION",
  "ABORTED",
  "OUT_OF_RANGE",
  "UNIMPLEMENTED",
  "INTERNAL",
  "UNAVAILABLE",
  "DATA_LOSS",
  "UNAUTHENTICATED",
] as const;

function errorCode(error: Error): string | null {
  const code = (error as { code?: unknown }).code;
  if (typeof code === "number" && Number.isInteger(code)) return GRPC_STATUS[code] ?? String(code);
  // String codes are identifiers (`auth/internal-error`, `rate_limit_exceeded`); anything else is dropped.
  if (typeof code === "string" && /^[A-Za-z0-9_./-]{1,64}$/.test(code)) return code;
  return null;
}

/**
 * Error types whose message can hold user content, so only their `code` is logged:
 * - OpenAI API errors: a 400 message can quote the rejected input value, which may be transcript or Memory text.
 * - SyntaxError: Node's JSON.parse message quotes the start of the text it failed on, which may be model output.
 */
function messageMayHoldContent(error: Error): boolean {
  return error instanceof OpenAIAPIError || error instanceof SyntaxError;
}

/**
 * The fields of the `route.dependency` log line (IDs and times only, never content). Adds the error's `code`
 * when it has one and the first 200 characters of its message, except for the types above.
 */
export function dependencyLogFields(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { error: "unknown" };
  const fields: Record<string, string> = { error: error.name };
  const code = errorCode(error);
  if (code !== null) fields.code = code;
  if (!messageMayHoldContent(error) && error.message !== "") fields.message = error.message.slice(0, DEPENDENCY_MESSAGE_CAP);
  return fields;
}
