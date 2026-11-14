/**
 * Route_Guard (R10.1–R10.7; KV10). Runs before any route logic or Store_Port call:
 *   1. verifies the Firebase ID token from `Authorization: Bearer`, with the revocation check (401 AUTH);
 *   2. for non-GET requests, requires an `Origin` header that exactly matches an allowed origin (403 AUTH).
 *      With bearer tokens and no cookies, this exact check is the CSRF check (contract question 11);
 *   3. caps the body at 128 KiB, or 256 KiB for SDP (413 LIMIT).
 * The only tenant passed on is the verified token's `uid` (R10.5).
 */
import { authError, dependencyError, originError, oversizeError } from "../routes/errors";

/** Verifies an ID token, including revocation. Throws on any invalid, expired or revoked token. */
export interface TokenVerifier {
  verify(idToken: string): Promise<{ uid: string }>;
}

/** The custom domain first, then App Hosting's own URL for the same backend, which stays reachable. */
export const ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:3000",
  "https://frankirocks.com",
  "https://franki-web--frankirocks.us-central1.hosted.app",
];

export const BODY_CAP_BYTES = 131_072;
export const SDP_BODY_CAP_BYTES = 262_144;

export interface GuardInput {
  method: string;
  header(name: string): string | null;
  /** The raw request body (empty for GET). */
  bodyText: string;
  bodyCap: number;
}

const BEARER = /^Bearer ([^\s]+)$/;

/**
 * Admin SDK error codes (node_modules/firebase-admin/lib/auth/error.js) that mean the caller's token is the
 * problem: expired, revoked, not a valid Firebase ID token, malformed (`argument-error`, which the token
 * verifier raises for an unparseable JWT or a bad claim), or its user is disabled or gone.
 * Every other code, such as `auth/internal-error` or a credential or network error, is our infrastructure.
 */
export const TOKEN_FAILURE_CODES: ReadonlySet<string> = new Set([
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/invalid-id-token",
  "auth/argument-error",
  "auth/user-disabled",
  "auth/user-not-found",
]);

const CODE_SHAPE = /^[a-z]+\/[a-z0-9-]{1,64}$/;

function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && CODE_SHAPE.test(code) ? code : "unknown";
}

/** Logs one line with the failing error code only. The token and the error message are never logged. */
export type GuardLog = (event: string, fields: Record<string, string>) => void;

/** Returns the verified uid, or throws a RouteError with the guard's status. */
export async function guardRequest(
  input: GuardInput,
  verifier: TokenVerifier,
  origins: readonly string[] = ALLOWED_ORIGINS,
  log?: GuardLog,
): Promise<string> {
  const match = BEARER.exec(input.header("authorization") ?? "");
  if (match === null) throw authError("no bearer token");
  let uid: string;
  try {
    ({ uid } = await verifier.verify(match[1]!));
  } catch (error) {
    const code = errorCode(error);
    if (TOKEN_FAILURE_CODES.has(code)) throw authError("token rejected");
    // Not the token's fault (auth/internal-error, credentials, network, anything unknown): tell the client to retry.
    log?.("auth.verifier", { code });
    throw dependencyError(1000, "token verifier");
  }
  if (typeof uid !== "string" || uid.length === 0 || uid.length > 128 || uid.includes("/")) throw authError("bad uid");

  if (input.method.toUpperCase() !== "GET") {
    const origin = input.header("origin");
    if (origin === null || !origins.includes(origin)) throw originError();
  }

  if (utf8Length(input.bodyText) > input.bodyCap) throw oversizeError();
  return uid;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
