/**
 * Brief 049 ruling 20: one Gmail message as the content of one Evidence row. Read defensively and bounded at every
 * step: the MIME tree is walked to a fixed depth and part count, bodies are decoded up to a cap, HTML is reduced to
 * text by `mailText` (no link survives), and every field is cut to its schema bound. A body cut at the bound is
 * marked cut by its parser version.
 *
 * Mail can inform, never instruct: nothing here reads a message's words for anything but storing them as T (or O
 * for the owner's own sent mail), and nothing enqueues extraction.
 */
import { type Hasher, cutAt, linkless, mailTextOf, plainText, visibleText } from "@franki/core";
import type { GmailMessage } from "./port";

/** A stored body is cut at this many characters (Content allows 131,072; the reader reads less). */
export const MAIL_BODY_CHARS = 20_000;
export const MAIL_SUBJECT_CHARS = 1_024;
export const MAIL_SENDER_CHARS = 320;
export const MAIL_RECIPIENTS_MAX = 64;
/** The MIME tree is read to this depth and this many parts. */
const MIME_DEPTH_MAX = 8;
const MIME_PARTS_MAX = 64;
/** At most this many base64url characters of one body are decoded. */
const BODY_DATA_MAX = 600_000;
const HEADER_CHARS = 2_000;
/** `plainText` reads at most this much of a plain body (core's MAIL_HTML_INPUT_MAX); past it the body is cut. */
const MAIL_HTML_INPUT_MAX_CHARS = 400_000;
const HEADERS_MAX = 200;

export const GMAIL_PARSER_VERSION = "gmail-read-v1";
/** The parser version of a row whose body was cut at `MAIL_BODY_CHARS` (no Evidence field says so otherwise). */
export const GMAIL_PARSER_VERSION_CUT = "gmail-read-v1-cut";

export interface MailContent {
  subject: string | null;
  body: string | null;
  /** Review D8: the body was cut at its bound, a part was too big or held elsewhere, or HTML was dropped unclosed. */
  bodyCut: boolean;
  /** The From header as stored (`Name <address>`), cleaned and cut. */
  sender: string | null;
  senderName: string | null;
  senderAddress: string | null;
  recipient: string[];
  occurredAtMs: number;
  /** The owner's own sent mail: Gmail's SENT label only, never a From header that merely names the owner. */
  fromSelf: boolean;
  bulk: boolean;
  unread: boolean;
  threadId: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Review D9: a header leaves with no invisible character (`visibleText`). */
const clean = (s: string) => visibleText(s);
/** Review D8: never between the halves of a surrogate pair. */
const cut = (s: string, n: number) => cutAt(s, n);

/** RFC 2047 encoded words in UTF-8 (B and Q); any other charset is left as it is. */
function decodeWords(v: string): string {
  return v.replace(/=\?utf-8\?([bq])\?([^?\s]{0,1000})\?=/gi, (whole, enc: string, text: string) => {
    try {
      if (enc.toLowerCase() === "b") return Buffer.from(text, "base64").toString("utf8");
      return Buffer.from(text.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
    } catch {
      return whole;
    }
  });
}

function headersOf(payload: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const list = Array.isArray(payload.headers) ? payload.headers.slice(0, HEADERS_MAX) : [];
  for (const h of list) {
    if (!isObj(h) || typeof h.name !== "string" || typeof h.value !== "string") continue;
    const name = h.name.toLowerCase();
    if (!out.has(name)) out.set(name, clean(decodeWords(cut(h.value, HEADER_CHARS))));
  }
  return out;
}

/**
 * One part's body. Review D8: a body past the bound is decoded up to it and marked cut; a body Gmail holds elsewhere
 * (an `attachmentId` with no `data`) or one that isn't base64url is left out and marked, never silently null.
 */
function decodeData(v: unknown): { text: string | null; cut: boolean } {
  if (!isObj(v)) return { text: null, cut: false };
  if (typeof v.data !== "string") return { text: null, cut: typeof v.attachmentId === "string" || (typeof v.size === "number" && v.size > 0) };
  if (!/^[A-Za-z0-9_\-=+/]*$/.test(v.data.slice(0, BODY_DATA_MAX + 4))) return { text: null, cut: true };
  const over = v.data.length > BODY_DATA_MAX;
  // A multiple of four characters, so the cut is on a whole base64 group; a split UTF-8 sequence at the end decodes
  // to U+FFFD, which the cut then removes.
  const data = over ? v.data.slice(0, BODY_DATA_MAX - (BODY_DATA_MAX % 4)) : v.data;
  const text = Buffer.from(data, "base64url").toString("utf8");
  return { text: over ? text.replace(/\ufffd+$/, "") : text, cut: over };
}

/** The first text/plain and the first text/html body in the tree, walked breadth-first and bounded. */
function bodiesOf(payload: Record<string, unknown>): { text: string | null; html: string | null; cut: boolean } {
  let text: string | null = null;
  let html: string | null = null;
  let partCut = false;
  let seen = 0;
  let level: unknown[] = [payload];
  for (let depth = 0; depth < MIME_DEPTH_MAX && level.length > 0 && (text === null || html === null); depth++) {
    const next: unknown[] = [];
    for (const p of level) {
      if (++seen > MIME_PARTS_MAX || !isObj(p)) continue;
      const mime = typeof p.mimeType === "string" ? p.mimeType.toLowerCase() : "";
      // An attachment is never read.
      if (typeof p.filename === "string" && p.filename !== "") continue;
      if (mime === "text/plain" && text === null) {
        const d = decodeData(p.body);
        text = d.text;
        partCut ||= d.cut;
      } else if (mime === "text/html" && html === null) {
        const d = decodeData(p.body);
        html = d.text;
        partCut ||= d.cut;
      }
      else if (mime.startsWith("multipart/") && Array.isArray(p.parts)) next.push(...p.parts.slice(0, MIME_PARTS_MAX));
    }
    level = next;
  }
  return { text, html, cut: partCut };
}

/**
 * Review D4: where the owner's own words end in a sent message. The first line that starts quoted or forwarded
 * text: a `>` quote, "On ... wrote:" (on one line or two), a forwarded or original-message rule, "Begin forwarded
 * message:", or a "From:" header line (an Outlook block). When in doubt it splits, since what follows is read as T.
 */
export function splitQuoted(body: string): { own: string | null; quoted: string | null } {
  const lines = body.split("\n");
  const starts = (i: number): boolean => {
    const l = lines[i]!.trim();
    if (l.startsWith(">")) return true;
    if (/^-{2,}\s*(forwarded message|original message)/i.test(l) || /^begin forwarded message:?$/i.test(l)) return true;
    if (/^from:\s/i.test(l)) return true;
    if (/^on\s.{0,400}wrote:$/i.test(l)) return true;
    if (/^on\s/i.test(l) && i + 1 < lines.length && /^.{0,200}wrote:$/i.test(lines[i + 1]!.trim())) return true;
    return false;
  };
  for (let i = 0; i < lines.length; i++) {
    if (!starts(i)) continue;
    const own = lines.slice(0, i).join("\n").trim();
    const quoted = lines.slice(i).join("\n").trim();
    return { own: own === "" ? null : own, quoted: quoted === "" ? null : quoted };
  }
  return { own: body, quoted: null };
}

/** `Name <address>` or a bare address, from a bounded header. */
export function parseAddress(v: string): { name: string | null; address: string | null } {
  const s = cut(v, 400);
  const angle = /^(.*?)<([^<>\s]{3,254})>\s*$/.exec(s);
  if (angle !== null) {
    const name = angle[1]!.replace(/^[\s"']+|[\s"']+$/g, "");
    return { name: name === "" ? null : name, address: /@/.test(angle[2]!) ? angle[2]!.toLowerCase() : null };
  }
  const bare = /^\s*([^\s<>,;"@]+@[^\s<>,;"@]+)\s*$/.exec(s);
  return { name: null, address: bare === null ? null : bare[1]!.toLowerCase() };
}

function recipientsOf(h: Map<string, string>): string[] {
  const all = `${h.get("to") ?? ""},${h.get("cc") ?? ""}`;
  const found = all.match(/[^\s<>,;"@]{1,64}@[^\s<>,;"@]{1,190}/g) ?? [];
  return [...new Set(found.map((a) => a.toLowerCase()))].slice(0, MAIL_RECIPIENTS_MAX);
}

const BULK_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];

/** The content of one message, or null when it can't be stored (no date, or nothing to store). */
export function mailContent(m: GmailMessage): MailContent | null {
  const payload = isObj(m.payload) ? m.payload : {};
  const h = headersOf(payload);
  const dateHeader = h.get("date");
  const parsedDate = dateHeader === undefined ? Number.NaN : Date.parse(dateHeader);
  const occurredAtMs = m.internalDate !== null && Number.isSafeInteger(m.internalDate) ? m.internalDate : Number.isFinite(parsedDate) ? parsedDate : null;
  if (occurredAtMs === null || occurredAtMs < 0) return null;
  const { text, html, cut: partCut } = bodiesOf(payload);
  const fromHtml = text === null && html !== null ? mailTextOf(html, MAIL_BODY_CHARS + 1) : null;
  const raw = text !== null ? plainText(text, MAIL_BODY_CHARS + 1) : fromHtml !== null ? fromHtml.text : "";
  const inputCut = (text ?? "").length > MAIL_HTML_INPUT_MAX_CHARS || fromHtml?.dropped === true;
  const bodyCut = raw.length > MAIL_BODY_CHARS || partCut || inputCut;
  const body = raw === "" ? null : cut(raw, MAIL_BODY_CHARS);
  // Review D9: a subject leaves with no link.
  const subjectRaw = linkless(h.get("subject") ?? "").trim();
  const subject = subjectRaw === "" ? null : cut(subjectRaw, MAIL_SUBJECT_CHARS);
  const fromRaw = h.get("from") ?? "";
  const sender = fromRaw === "" ? null : cut(fromRaw, MAIL_SENDER_CHARS);
  const from = parseAddress(fromRaw);
  if (subject === null && body === null && sender === null) return null;
  return {
    subject,
    body,
    bodyCut,
    sender,
    senderName: from.name,
    senderAddress: from.address,
    recipient: recipientsOf(h),
    occurredAtMs,
    fromSelf: m.labelIds.includes("SENT"),
    bulk: h.has("list-id") || h.has("list-unsubscribe") || m.labelIds.some((l) => BULK_LABELS.includes(l)),
    unread: m.labelIds.includes("UNREAD"),
    threadId: m.threadId,
  };
}

export const gmailProviderKey = (hasher: Hasher, connectorId: string, messageId: string) => hasher.id(["gmail-message", connectorId, messageId]);
export const gmailLogicalId = (hasher: Hasher, uid: string, connectorId: string, messageId: string) => hasher.id(["gmail-row", uid, connectorId, messageId]);
export const gmailThreadKey = (hasher: Hasher, connectorId: string, threadId: string) => hasher.id(["gmail-thread", connectorId, threadId]);
/** One address's key for one owner, the same for a sender and a recipient, so "senders the owner has mailed" can be read. */
export const mailAddressKey = (hasher: Hasher, uid: string, address: string) => hasher.id(["mail-address", uid, address.trim().toLowerCase()]);
