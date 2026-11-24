/**
 * The simulated Google (brief 054, R9): a whole `GooglePort` that answers from a demo fixture's own mail and calendar
 * lines, so the real reader, planner, errand runner and trust rule run unchanged above it. It reads the simulator
 * token for the fixture, the world start and the zone, and nothing else: no network, no environment, no clock. It
 * is read-only like the live port: nothing here can send, draft, label or change anything (R9.7).
 *
 * A message is shaped as Gmail's `format=full` answer, so `google/mail.ts` reads the same subject, body, sender,
 * recipients and instant the seed stored, the SENT label on the persona's own mail, the list headers on bulk mail and
 * Gmail's DMARC verdict in `Authentication-Results` (R13.2). An event is shaped as the Calendar API's, holding only
 * the line's last revision, as Google answers one (R9.5).
 */
import type { GoogleConfig } from "../google/config";
import { CALENDAR_SCOPE, GMAIL_SCOPE } from "../google/oauth";
import { EVENTS_LIST_MAX, GoogleCallError, type GmailMessage, type GooglePort, MESSAGES_LIST_MAX } from "../google/port";
import type { CalendarLine, MailLine, SeedFixture } from "../seed/fixture";
import { matchesQuery, parseGmailQuery } from "./gmail-query";
import { type SimLayout, layoutOf } from "./layout";
import { type SimKind, type SimToken, readSimToken, simToken } from "./token";

export interface SimMessage {
  id: string;
  threadId: string;
  line: MailLine;
  internalDate: number;
  labelIds: string[];
  message: GmailMessage;
}

export interface SimEvent {
  id: string;
  line: CalendarLine;
  startMs: number;
  endMs: number;
  item: Record<string, unknown>;
}

/** `line.id` with every character outside Google's event-ID alphabet replaced by `_`. Build check 5 keeps them apart. */
export const simEventId = (lineId: string): string => lineId.replace(/[^A-Za-z0-9_-]/g, "_");

const refuse = (): never => {
  throw new GoogleCallError("refused", true);
};

/** `m` or `t` and four base-36 digits: Gmail's ID shape (`^[A-Za-z0-9]{1,64}$`), and the order of the lines. */
const idOf = (prefix: "m" | "t", index: number) => `${prefix}${index.toString(36).padStart(4, "0")}`;
const domainOf = (address: string) => address.trim().toLowerCase().split("@")[1] ?? "";
const base64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/**
 * A display name a header can carry bare: atext and spaces. Then the stored sender (`Name <address>`) is byte for
 * byte the seed's. Any other name is quoted, as RFC 5322 needs, and `parseAddress` still reads the same name.
 */
const PLAIN_NAME = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~ -]+$/;
const fromHeader = (l: MailLine) => (PLAIN_NAME.test(l.from.name) ? `${l.from.name} <${l.from.address}>` : `"${l.from.name.replace(/["\\]/g, "\\$&")}" <${l.from.address}>`);

function labelsOf(l: MailLine): string[] {
  if (l.fromSelf) return ["SENT"];
  return ["INBOX", ...(l.unread === true ? ["UNREAD"] : []), ...(l.bulk ? ["CATEGORY_UPDATES"] : [])];
}

/** Gmail's own verdict for the From domain. Own mail and `dmarc: "none"` carry none, so they read `unknown`. */
function authResults(l: MailLine): string | null {
  if (l.fromSelf || l.dmarc === "none") return null;
  const domain = domainOf(l.from.address);
  return l.dmarc === "fail" ? `mx.google.com; dmarc=fail (p=REJECT) header.from=${domain}` : `mx.google.com; dmarc=pass (p=NONE) header.from=${domain}`;
}

/** Newest first, ties by ID. IDs follow the line's place among the fixture's mail lines. */
export function simMessages(layout: SimLayout): SimMessage[] {
  const lines = layout.fixture.lines.filter((l): l is MailLine => l.kind === "mail");
  const firstOfThread = new Map<string, number>();
  const indexOfLine = new Map<string, number>();
  lines.forEach((l, i) => {
    if (!firstOfThread.has(l.thread)) firstOfThread.set(l.thread, i);
    if (!indexOfLine.has(l.id)) indexOfLine.set(l.id, i);
  });
  const messageId = (i: number) => `<${idOf("m", i)}@sim.invalid>`;
  const out = lines.map((l, i): SimMessage => {
    const id = idOf("m", i);
    const threadId = idOf("t", firstOfThread.get(l.thread)!);
    const internalDate = layout.at(l.at);
    const labelIds = labelsOf(l);
    const replyTo = l.inReplyTo === undefined ? undefined : indexOfLine.get(l.inReplyTo);
    const auth = authResults(l);
    const domain = domainOf(l.from.address);
    const headers = [
      // Gmail puts its own verdict above everything the message brought with it; `senderAuthOf` reads the first.
      ...(auth === null ? [] : [{ name: "Authentication-Results", value: auth }]),
      { name: "From", value: fromHeader(l) },
      { name: "To", value: l.to.join(", ") },
      { name: "Subject", value: l.subject },
      { name: "Date", value: new Date(internalDate).toUTCString() },
      { name: "Message-ID", value: messageId(i) },
      ...(replyTo === undefined ? [] : [{ name: "In-Reply-To", value: messageId(replyTo) }]),
      ...(l.bulk ? [{ name: "List-Id", value: `<list.${domain}>` }, { name: "List-Unsubscribe", value: `<mailto:unsubscribe@${domain}>` }] : []),
    ];
    const payload = {
      mimeType: "multipart/alternative",
      headers,
      parts: [{ mimeType: "text/plain", body: { data: base64url(l.body), size: Buffer.byteLength(l.body, "utf8") } }],
    };
    return { id, threadId, line: l, internalDate, labelIds, message: { id, threadId, internalDate, labelIds, payload } };
  });
  return out.sort((a, b) => b.internalDate - a.internalDate || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const iso = (ms: number) => new Date(ms).toISOString();

/** The latest revision of each line, cancelled ones left out (Google answers none without showDeleted), in start order. */
export function simEvents(layout: SimLayout): SimEvent[] {
  const email = layout.demo.google.email;
  const out: SimEvent[] = [];
  for (const l of layout.fixture.lines) {
    if (l.kind !== "calendar") continue;
    const r = l.revisions[l.revisions.length - 1];
    if (r === undefined || r.status === "cancelled") continue;
    const startMs = layout.at(r.start);
    const endMs = startMs + r.minutes * 60_000;
    const id = simEventId(l.id);
    const item: Record<string, unknown> = {
      id,
      etag: `"sim-${l.revisions.length}"`,
      status: r.status,
      summary: l.title,
      start: { dateTime: iso(startMs) },
      end: { dateTime: iso(endMs) },
      organizer: { email, self: l.organizerSelf },
      creator: { email, self: l.organizerSelf },
      attendees: r.selfResponse === "none" ? [] : [{ email, self: true, responseStatus: r.selfResponse }],
      ...(r.transparency === "transparent" ? { transparency: "transparent" } : {}),
    };
    out.push({ id, line: l, startMs, endMs, item });
  }
  return out.sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const PAGE = /^(0|[1-9]\d{0,5})$/;
const clampCount = (n: number, max: number) => (Number.isInteger(n) ? Math.min(Math.max(n, 1), max) : 1);

/** The token read and checked for one call: the right kind, and a fixture with a demo profile. Else a refusal. */
function tokenOf(token: string, kinds: readonly SimKind[], fixtures: ReadonlyMap<string, SeedFixture> | undefined): { t: SimToken; layout: SimLayout } {
  const t = readSimToken(token);
  if (t === null || t === "malformed" || !kinds.includes(t.kind)) return refuse();
  const layout = layoutOf(t, fixtures);
  return layout === null ? refuse() : { t, layout };
}

/** The simulated Google over `fixtures` (all registered fixtures by default). */
export function simulatedGoogle(fixtures?: ReadonlyMap<string, SeedFixture>): GooglePort {
  return {
    // A demo visit never reaches it (R14.4): the routes refuse it first. Refuse anyway.
    async exchangeCode(_config: GoogleConfig) {
      return refuse();
    },
    async refresh(_config, refreshToken) {
      const { t } = tokenOf(refreshToken, ["refresh"], fixtures);
      // The access token is a simulator token too, so the data calls, which carry only it, route here (R9.2).
      return { accessToken: simToken({ ...t, kind: "access" }), scope: [GMAIL_SCOPE, CALENDAR_SCOPE] };
    },
    // Nothing outside the process holds the grant, so revoking it has nothing to undo.
    async revoke(token) {
      tokenOf(token, ["refresh", "access"], fixtures);
    },
    async listMessages(accessToken, q, max) {
      const { layout } = tokenOf(accessToken, ["access"], fixtures);
      const terms = parseGmailQuery(q);
      if (terms === null) return refuse();
      return simMessages(layout)
        .filter((m) => matchesQuery(m, terms))
        .slice(0, clampCount(max, MESSAGES_LIST_MAX))
        .map((m) => ({ id: m.id, threadId: m.threadId }));
    },
    async getMessage(accessToken, id) {
      const { layout } = tokenOf(accessToken, ["access"], fixtures);
      const m = simMessages(layout).find((x) => x.id === id);
      if (m === undefined) throw new GoogleCallError("notFound", true);
      return structuredClone(m.message);
    },
    async listEvents(accessToken, x) {
      const { layout } = tokenOf(accessToken, ["access"], fixtures);
      if (!RFC3339.test(x.timeMin) || !RFC3339.test(x.timeMax)) return refuse();
      if (x.pageToken !== undefined && !PAGE.test(x.pageToken)) return refuse();
      const timeMin = Date.parse(x.timeMin);
      const timeMax = Date.parse(x.timeMax);
      const all = simEvents(layout).filter((e) => e.startMs < timeMax && e.endMs > timeMin);
      const from = x.pageToken === undefined ? 0 : Number(x.pageToken);
      const size = clampCount(x.max, EVENTS_LIST_MAX);
      const page = all.slice(from, from + size);
      const next = from + size < all.length ? String(from + size) : null;
      return { timeZone: layout.zone, items: structuredClone(page.map((e) => e.item)), nextPageToken: next };
    },
  };
}
