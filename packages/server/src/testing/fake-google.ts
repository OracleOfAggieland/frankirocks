/**
 * Brief 049: a scriptable Google port for tests. No network. Every call is recorded with its method and arguments
 * (never answered from anywhere but the script); errors are queued per method.
 */
import { CALENDAR_SCOPE, GMAIL_SCOPE } from "../google/oauth";
import { GoogleCallError, type EventList, type GmailMessage, type GooglePort, type GoogleRefreshed, type GoogleTokens, type MessageRef } from "../google/port";
import type { Timers } from "../clock/timers";
import { BANK_TEST_KEY } from "./fake-bank";

export const GOOGLE_CLIENT_ID = "1234567890-testclient.apps.googleusercontent.com";
export const GOOGLE_TEST_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: GOOGLE_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: "GOCSPX-testsecret00000000",
  FRANKI_BANK_TOKEN_KEY: BANK_TEST_KEY,
  GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/google/callback",
};
export const REFRESH_TOKEN = "1//0gTESTREFRESHtoken-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
export const ACCESS_TOKEN_G = "ya29.a0TESTaccess-token_0123456789";
export const ACCOUNT_SUB = "109876543210987654321";
export const ACCOUNT_EMAIL = "owner@example.com";
export const ALL_SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email", GMAIL_SCOPE, CALENDAR_SCOPE];
/** Review S1: what Google may also answer when Franki's own Google sign-in already holds them. */
export const SIGN_IN_SCOPES = ["profile", "https://www.googleapis.com/auth/userinfo.profile", "email"];

const b64 = (o: object) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
/** An unsigned ID token shaped like Google's (the code never checks the signature; it came over TLS). */
export function idTokenFor(claims: Record<string, unknown> = {}): string {
  return `${b64({ alg: "RS256", kid: "test" })}.${b64({ iss: "https://accounts.google.com", aud: GOOGLE_CLIENT_ID, sub: ACCOUNT_SUB, email: ACCOUNT_EMAIL, email_verified: true, ...claims })}.c2ln`;
}

type Method = keyof GooglePort;

export interface GoogleCall {
  method: Method;
  args: unknown[];
}

export class FakeGoogle implements GooglePort {
  calls: GoogleCall[] = [];
  tokens: GoogleTokens = { accessToken: ACCESS_TOKEN_G, refreshToken: REFRESH_TOKEN, scope: [...ALL_SCOPES], idToken: idTokenFor() };
  refreshed: GoogleRefreshed = { accessToken: ACCESS_TOKEN_G, scope: null };
  /** Messages by ID, and the IDs a list answers (in order). */
  messages = new Map<string, GmailMessage>();
  listed: MessageRef[] | null = null;
  /** Every event in the window, in start order; `listEvents` answers them a page of `max` at a time. */
  events: { timeZone: string | null; items: unknown[] } = { timeZone: "UTC", items: [] };
  private errors = new Map<Method, (GoogleCallError | Error)[]>();
  /** One-shot work run inside a call before it answers (a disconnect mid-exchange, a forget mid-read). */
  private hooks = new Map<Method, (() => Promise<void>)[]>();

  /** Runs `work` inside the next call of `method`, after it is recorded and before it answers. */
  during(method: Method, work: () => Promise<void>): this {
    this.hooks.set(method, [...(this.hooks.get(method) ?? []), work]);
    return this;
  }

  /** Review T11: every call of a method can take virtual time, to test deadlines and parallel calls. */
  /** Also match `from:`, words and times (see `matchesQuery`). */
  fullQuery = false;
  slow: { timers: Timers; ms: (method: Method, args: unknown[]) => number } | null = null;
  /** Calls in flight now, and the most there ever were at once, per method. */
  inFlight = new Map<Method, number>();
  maxInFlight = new Map<Method, number>();

  private async hook(method: Method, args: unknown[] = []): Promise<void> {
    const next = this.hooks.get(method)?.shift();
    if (next !== undefined) await next();
    const ms = this.slow?.ms(method, args) ?? 0;
    if (ms > 0) {
      const n = (this.inFlight.get(method) ?? 0) + 1;
      this.inFlight.set(method, n);
      this.maxInFlight.set(method, Math.max(n, this.maxInFlight.get(method) ?? 0));
      try {
        await this.slow!.timers.sleep(ms);
      } finally {
        this.inFlight.set(method, (this.inFlight.get(method) ?? 1) - 1);
      }
    }
  }

  failNext(method: Method, error: GoogleCallError | Error): this {
    this.errors.set(method, [...(this.errors.get(method) ?? []), error]);
    return this;
  }

  private take(method: Method, args: unknown[]): void {
    this.calls.push({ method, args });
    const queue = this.errors.get(method);
    const next = queue?.shift();
    if (next !== undefined) throw next;
  }

  count(method: Method): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  async exchangeCode(...args: Parameters<GooglePort["exchangeCode"]>) {
    this.take("exchangeCode", args);
    await this.hook("exchangeCode");
    return { ...this.tokens, scope: [...this.tokens.scope] };
  }
  async refresh(...args: Parameters<GooglePort["refresh"]>) {
    this.take("refresh", args);
    await this.hook("refresh");
    return { ...this.refreshed };
  }
  async revoke(...args: Parameters<GooglePort["revoke"]>) {
    this.take("revoke", args);
    await this.hook("revoke");
  }
  async listMessages(...args: Parameters<GooglePort["listMessages"]>) {
    this.take("listMessages", args);
    await this.hook("listMessages", args);
    const all = this.listed ?? [...this.messages.values()].filter((m) => matchesQuery(m, args[1], this.fullQuery)).map((m) => ({ id: m.id, threadId: m.threadId }));
    return all.slice(0, Math.max(1, args[2]));
  }
  async getMessage(...args: Parameters<GooglePort["getMessage"]>) {
    this.take("getMessage", args);
    await this.hook("getMessage", args);
    const m = this.messages.get(args[1]);
    if (m === undefined) throw new GoogleCallError("notFound", true);
    return structuredClone(m);
  }
  async listEvents(...args: Parameters<GooglePort["listEvents"]>) {
    this.take("listEvents", args);
    await this.hook("listEvents", args);
    const from = args[1].pageToken === undefined ? 0 : Number(args[1].pageToken);
    const max = Math.max(1, args[1].max);
    const items = this.events.items.slice(from, from + max);
    const next = from + max < this.events.items.length ? String(from + max) : null;
    return structuredClone({ timeZone: this.events.timeZone, items, nextPageToken: next } satisfies EventList);
  }
}

const headerOf = (m: GmailMessage, name: string): string => {
  const hs = (m.payload as { headers?: { name: string; value: string }[] }).headers ?? [];
  return hs.filter((h) => h.name.toLowerCase() === name).map((h) => h.value).join(", ").toLowerCase();
};
const textOf = (m: GmailMessage): string => {
  const parts = (m.payload as { parts?: { body?: { data?: string } }[] }).parts ?? [];
  return parts.map((p) => (typeof p.body?.data === "string" ? Buffer.from(p.body.data, "base64url").toString("utf8") : "")).join(" ").toLowerCase();
};

/**
 * Review (group 4): enough of Gmail's search for the tests: `in:sent`, `to:`, `from:`, quoted words (subject or
 * body), `is:unread`, `after:`/`before:` (epoch seconds) and the always-added exclusions. A substring match, as loose
 * as Gmail's own can be, so code that trusts the search alone is caught. Without `full`, only the folder, label
 * and recipient filters apply (older tests script one message for any words).
 */
export function matchesQuery(m: GmailMessage, q: string, full = false): boolean {
  const tokens = q.match(/-?[a-z]+:"[^"]*"|-?[a-z]+:\S+|"[^"]*"|\S+/g) ?? [];
  const labels = m.labelIds;
  for (const raw of tokens) {
    const neg = raw.startsWith("-");
    const t = neg ? raw.slice(1) : raw;
    const [op, ...rest] = t.includes(":") && !t.startsWith('"') ? t.split(":") : ["", t];
    const v = rest.join(":").replace(/^"|"$/g, "").toLowerCase();
    let hit: boolean;
    if (op === "in" && v === "sent") hit = labels.includes("SENT");
    else if (op === "in") hit = labels.includes(v.toUpperCase());
    else if (op === "category") hit = labels.includes(`CATEGORY_${v.toUpperCase()}`);
    else if (op === "to") hit = `${headerOf(m, "to")}, ${headerOf(m, "cc")}`.includes(v);
    else if (!full) continue;
    else if (op === "is" && v === "unread") hit = labels.includes("UNREAD");
    else if (op === "from") hit = headerOf(m, "from").includes(v);
    else if (op === "after") hit = (m.internalDate ?? 0) >= Number(v) * 1000;
    else if (op === "before") hit = (m.internalDate ?? 0) < Number(v) * 1000;
    else hit = headerOf(m, "subject").includes(v) || textOf(m).includes(v);
    if (hit === neg) return false;
  }
  return true;
}

const noGoogle = async (): Promise<never> => {
  throw new Error("no Google in tests");
};
/** Brief 049: the default Google port in tests. Every method throws, so an unexpected call fails closed. */
export const throwingGoogle: GooglePort = { exchangeCode: noGoogle, refresh: noGoogle, revoke: noGoogle, listMessages: noGoogle, getMessage: noGoogle, listEvents: noGoogle };

const enc = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** A Gmail `format=full` message with a plain body, an HTML body, or both. */
export function gmailMessage(
  id: string,
  over: { from?: string; to?: string; subject?: string; date?: number; text?: string | null; html?: string | null; threadId?: string; labels?: string[]; inReplyTo?: string; headers?: { name: string; value: string }[] } = {},
): GmailMessage {
  const text = over.text === undefined ? "Hi, the lease renewal is due Friday. Dana" : over.text;
  const html = over.html ?? null;
  const parts = [...(text === null ? [] : [{ mimeType: "text/plain", body: { data: enc(text), size: text.length } }]), ...(html === null ? [] : [{ mimeType: "text/html", body: { data: enc(html), size: html.length } }])];
  const headers = [
    { name: "From", value: over.from ?? "Dana Park <dana@example.org>" },
    { name: "To", value: over.to ?? ACCOUNT_EMAIL },
    { name: "Subject", value: over.subject ?? "Lease renewal" },
    { name: "Message-ID", value: `<${id}@mail.example.org>` },
    ...(over.inReplyTo === undefined ? [] : [{ name: "In-Reply-To", value: over.inReplyTo }]),
    ...(over.headers ?? []),
  ];
  return {
    id,
    threadId: over.threadId ?? id,
    internalDate: over.date ?? Date.UTC(2026, 10, 10, 15, 0),
    labelIds: over.labels ?? ["INBOX", "UNREAD"],
    payload: { mimeType: "multipart/alternative", headers, parts },
  };
}

/** One Calendar API event (`singleEvents=true`). */
export function calendarEvent(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    etag: '"3380000000000000"',
    status: "confirmed",
    updated: "2026-11-10T12:00:00.000Z",
    summary: "Team sync",
    start: { dateTime: "2026-11-16T15:00:00Z" },
    end: { dateTime: "2026-11-16T16:00:00Z" },
    organizer: { email: ACCOUNT_EMAIL, self: true },
    creator: { email: ACCOUNT_EMAIL, self: true },
    attendees: [],
    ...over,
  };
}
