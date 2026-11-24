/**
 * Route_Guard (R10.1–R10.7; KV10). Runs before any route logic or Store_Port call:
 *   1. verifies the Firebase ID token from `Authorization: Bearer`, with the revocation check (401 AUTH);
 *   2. for non-GET requests, requires an `Origin` header that exactly matches an allowed origin (403 AUTH).
 *      With bearer tokens and no cookies, this exact check is the CSRF check (contract question 11);
 *   3. caps the body at 128 KiB, or 256 KiB for SDP (413 LIMIT).
 * The only tenant passed on is the verified token's `uid` (R10.5).
 * Brief 054: it also passes on whether that token came from Firebase anonymous sign-in, and refuses such a token
 * while the demo switch is off, straight after the token check, so a refusal reads and writes nothing (R15.3, R15.4).
 */
import { authError, dependencyError, originError, oversizeError } from "../routes/errors";

/** Verifies an ID token, including revocation. Throws on any invalid, expired or revoked token. */
export interface TokenVerifier {
  /**
   * Brief 054: `anonymous` is true exactly when the verified token's `firebase.sign_in_provider` is "anonymous".
   * Optional so the verifiers older tests build keep working; absent reads false (R4.6).
   */
  verify(idToken: string): Promise<{ uid: string; anonymous?: boolean }>;
}

/** What the Route_Guard passes on: the verified tenant and whether its token is a demo visitor's. */
export interface GuardResult {
  uid: string;
  anonymous: boolean;
}

/** Brief 054: `demoOn` is the demo switch. An anonymous token is let through only when it is exactly true. */
export interface GuardOptions {
  demoOn?: boolean;
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

/**
 * Returns the verified uid, or throws a RouteError with the guard's status. The demo switch counts as off here, so
 * an anonymous token is refused: a caller that wants demo visitors uses `guardRequestFull` with the real switch, as
 * `runRoute` does, and gets the anonymous flag with it. A signed-in token is answered as it was before brief 054.
 */
export async function guardRequest(
  input: GuardInput,
  verifier: TokenVerifier,
  origins: readonly string[] = ALLOWED_ORIGINS,
  log?: GuardLog,
): Promise<string> {
  return (await guardRequestFull(input, verifier, origins, log, { demoOn: false })).uid;
}

/** The guard's steps in order, returning the uid and the anonymous flag, or throwing a RouteError. */
export async function guardRequestFull(
  input: GuardInput,
  verifier: TokenVerifier,
  origins: readonly string[] = ALLOWED_ORIGINS,
  log?: GuardLog,
  opts?: GuardOptions,
): Promise<GuardResult> {
  const match = BEARER.exec(input.header("authorization") ?? "");
  if (match === null) throw authError("no bearer token");
  let uid: string;
  let anonymous: boolean;
  try {
    const r = await verifier.verify(match[1]!);
    uid = r.uid;
    // Only the verified token decides this; nothing else in the request is read for it (R4.4).
    anonymous = r.anonymous === true;
  } catch (error) {
    const code = errorCode(error);
    if (TOKEN_FAILURE_CODES.has(code)) throw authError("token rejected");
    // Not the token's fault (auth/internal-error, credentials, network, anything unknown): tell the client to retry.
    log?.("auth.verifier", { code });
    throw dependencyError(1000, "token verifier");
  }
  if (typeof uid !== "string" || uid.length === 0 || uid.length > 128 || uid.includes("/")) throw authError("bad uid");
  // The same closed answer as a rejected token, so a probe can't tell the demo is there but off (R15.3).
  if (anonymous && opts?.demoOn !== true) throw authError("demo off");

  if (input.method.toUpperCase() !== "GET") {
    const origin = input.header("origin");
    if (origin === null || !origins.includes(origin)) throw originError();
  }

  if (utf8Length(input.bodyText) > input.bodyCap) throw oversizeError();
  return { uid, anonymous };
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
