/**
 * Brief 049 rulings 15 and 16: the OAuth pieces, as code with no I/O except the random source.
 *
 * - The scopes, pinned by a test: sign-in identity (`openid`, `email`) and two read-only scopes. None can send,
 *   draft, label, or change an event.
 * - A state is 32 random bytes in base64url. Only its SHA-256 is stored, and the comparison is constant-time.
 * - A PKCE verifier is 32 random bytes in base64url (43 characters); its S256 challenge goes to Google.
 * - The redirect URI is the request's already-checked Origin plus `/google/callback`, fixed at start and reused at
 *   the exchange, never rebuilt from the connect request.
 * - Granted scopes are read from the token answer: mail and calendar connect independently, and a scope outside the
 *   list (other than Google's own names for `email`) refuses the whole grant.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
/** Ruling 16. Exactly these four, in this order. */
export const GOOGLE_SCOPES = ["openid", "email", GMAIL_SCOPE, CALENDAR_SCOPE] as const;
/** Names Google may answer for the identity scopes; they grant nothing beyond the address. */
const IDENTITY_SCOPES = new Set(["openid", "email", "https://www.googleapis.com/auth/userinfo.email"]);

/** The page Google sends the browser back to. */
export const CALLBACK_PATH = "/google/callback";
/** Ruling 15: a pending authorization ends 10 minutes after it is issued. */
export const PENDING_TTL_MS = 10 * 60_000;
const SECRET_BYTES = 32;

const b64url = (b: Buffer) => b.toString("base64url");

/** A fresh one-time state (32 random bytes). */
export const newState = () => b64url(randomBytes(SECRET_BYTES));
/** A fresh PKCE verifier (32 random bytes, 43 characters). */
export const newVerifier = () => b64url(randomBytes(SECRET_BYTES));
/** The S256 challenge of a verifier. */
export const challengeOf = (verifier: string) => b64url(createHash("sha256").update(verifier, "ascii").digest());
/** What is stored of a state: its SHA-256, lowercase hex. */
export const stateHash = (state: string) => createHash("sha256").update(state, "utf8").digest("hex");

/** Constant-time: hashes the presented state and compares the two digests byte for byte. */
export function stateMatches(storedHash: string, presented: string): boolean {
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(stateHash(presented), "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

/** The redirect URI for an origin the guard has already checked. */
export const redirectUriFor = (origin: string) => `${origin}${CALLBACK_PATH}`;

export interface AuthorizationInput {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}

/** Google's authorization URL (ruling 15). */
export function authorizationUrl(i: AuthorizationInput): string {
  const q = new URLSearchParams({
    client_id: i.clientId,
    redirect_uri: i.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state: i.state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    code_challenge: i.challenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

export type Granted = { mail: boolean; calendar: boolean } | "unexpected";

/** What a token answer's `scope` granted. A scope outside the list refuses the grant (fails closed). */
export function grantedOf(scope: readonly string[]): Granted {
  for (const s of scope) if (s !== GMAIL_SCOPE && s !== CALENDAR_SCOPE && !IDENTITY_SCOPES.has(s)) return "unexpected";
  return { mail: scope.includes(GMAIL_SCOPE), calendar: scope.includes(CALENDAR_SCOPE) };
}

export interface Identity {
  sub: string;
  email: string | null;
}

const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/**
 * The account in an ID token that came straight from Google's token endpoint over TLS (so its signature is not
 * fetched or checked). Its audience must be this client and its issuer Google. Null for anything off-shape.
 */
export function identityOf(idToken: string | null, clientId: string): Identity | null {
  if (idToken === null || idToken.length > 8192) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1]!)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;
  const c = claims as Record<string, unknown>;
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(clientId) || typeof c.iss !== "string" || !ISSUERS.has(c.iss)) return null;
  if (typeof c.sub !== "string" || !/^[0-9A-Za-z_-]{1,255}$/.test(c.sub)) return null;
  const email = typeof c.email === "string" && c.email_verified === true && c.email.length <= 320 && /^[^\s@<>"]+@[^\s@<>"]+$/.test(c.email) ? c.email : null;
  return { sub: c.sub, email };
}
