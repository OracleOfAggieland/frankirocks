/**
 * Brief 049 (lane google): the pure parts of a Google connection. No I/O, no clock.
 *
 * - `isConnectedGoogleRow`: ruling 22. A row read from a connected Google account is read only by the errand
 *   helpers' read functions, never by the hero, the compare loop, the moments or the Lab counts.
 * - `gmailQuery`: ruling 23's query, built by code. Every term is cleaned to letters, digits and a few address
 *   characters, then quoted, so a word can't become a Gmail operator. Spam, trash, promotions and social are always
 *   left out.
 * - `mailText`: an HTML body reduced to plain text, bounded before and after, with no regex that can backtrack.
 *   Review D9: every URL-like token in the text it returns is the fixed marker `[link]` (an attribute's tail can
 *   leak past a `>` inside quotes, so links are replaced in the text, not only dropped with their tags), and
 *   invisible and format characters are stripped from everything that leaves this layer.
 * - `freeGaps`: ruling 25's free time, computed by code between the owner's busy events inside named day bounds.
 */
import { addCivilDays, civilDateAt, localMinuteAt } from "../dates";

/** Whether an Evidence row came from a connected Google account (mail or calendar). */
export function isConnectedGoogleRow(e: { source: string; connectorId: string | null }): boolean {
  return (e.source === "gmail" || e.source === "calendar") && e.connectorId !== null;
}

// ---------------------------------------------------------------------------------------------
// Gmail's query

/** Ruling 23: at most this many words. */
export const MAIL_QUERY_WORDS_MAX = 5;
/** One cleaned term is cut to this many characters. */
export const MAIL_TERM_CHARS = 64;
/** Always added: spam, trash, promotions and social are never searched. */
export const MAIL_QUERY_EXCLUDES = ["-in:spam", "-in:trash", "-category:promotions", "-category:social"] as const;

export interface MailQuery {
  /** A name or an address, or null. */
  from: string | null;
  /** Up to five words; more are ignored. */
  words: readonly string[];
  /** Epoch milliseconds, or null. Gmail reads `after:` and `before:` as epoch seconds. */
  afterMs: number | null;
  beforeMs: number | null;
  unread: boolean;
}

/**
 * One term as Gmail will read it: NFKC, only letters, digits, spaces and `@ . _ ' + -`, spaces collapsed, cut, then
 * quoted. Null when nothing is left. A quote, a colon, a brace or a parenthesis can't survive, so no term is an
 * operator and no term ends the quoting early.
 */
export function quotedTerm(raw: string): string | null {
  const clean = raw
    .slice(0, 4 * MAIL_TERM_CHARS)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}@._'+ -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAIL_TERM_CHARS)
    .trim();
  return clean === "" ? null : `"${clean}"`;
}

const epochSeconds = (ms: number | null) => (ms === null ? null : Math.floor(ms / 1000));
const validTime = (ms: number | null) => ms === null || (Number.isSafeInteger(ms) && ms >= 0);

/** Review D12: a time that is not a whole, non-negative number of milliseconds is refused, never ignored. */
export function mailQueryValid(q: MailQuery): boolean {
  return validTime(q.afterMs) && validTime(q.beforeMs);
}

/** The Gmail `q` for one search. Throws RangeError for a query `mailQueryValid` refuses. */
export function gmailQuery(q: MailQuery): string {
  if (!mailQueryValid(q)) throw new RangeError("gmailQuery: afterMs and beforeMs must be whole, non-negative milliseconds");
  const parts: string[] = [];
  const from = q.from === null ? null : quotedTerm(q.from);
  if (from !== null) parts.push(`from:${from}`);
  for (const w of q.words.slice(0, MAIL_QUERY_WORDS_MAX)) {
    const t = quotedTerm(w);
    if (t !== null) parts.push(t);
  }
  const after = epochSeconds(q.afterMs);
  const before = epochSeconds(q.beforeMs);
  if (after !== null) parts.push(`after:${after}`);
  if (before !== null) parts.push(`before:${before}`);
  if (q.unread) parts.push("is:unread");
  parts.push(...MAIL_QUERY_EXCLUDES);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------------------------
// HTML mail to text

/** An HTML body longer than this is cut before it is read at all. */
export const MAIL_HTML_INPUT_MAX = 400_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decodeEntity(_m: string, name: string): string {
  const named = ENTITIES[name.toLowerCase()];
  if (named !== undefined) return named;
  const num = /^#(\d{1,7})$/.exec(name) ?? null;
  const hex = /^#x([0-9a-f]{1,6})$/i.exec(name) ?? null;
  const code = num !== null ? Number(num[1]) : hex !== null ? parseInt(hex[1]!, 16) : null;
  if (code === null || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
  return String.fromCodePoint(code);
}

/** Elements dropped with everything inside them. */
const SKIPPED = new Set(["script", "style", "head", "title", "template", "noscript"]);
/** Tags that end a line. */
const LINE_ENDS = new Set(["br", "/p", "/div", "/li", "/tr", "/h1", "/h2", "/h3", "/h4", "/h5", "/h6", "/blockquote", "/table"]);

/** The first `</name` at or after `from`, matched ASCII case-insensitively on the original string (review D9). */
function closeTagAt(html: string, name: string, from: number): number {
  for (let j = html.indexOf("</", from); j >= 0; j = html.indexOf("</", j + 2)) {
    if (html.slice(j + 2, j + 2 + name.length).toLowerCase() === name) return j;
  }
  return -1;
}

/**
 * Removes tags in one left-to-right pass with `indexOf` only, so the work is linear in the input whatever its shape
 * (no backtracking regex over attacker text). An unclosed tag, comment or skipped element drops the rest, and says
 * so. Names are matched case-insensitively on the original string: lower-casing the whole input first can change
 * its length (`İ`) and shift every offset after it (review D9).
 */
function stripTags(html: string): { text: string; dropped: boolean } {
  const out: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end < 0) return { text: out.join(""), dropped: true };
      out.push(" ");
      i = end + 3;
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) return { text: out.join(""), dropped: true };
    const head = /^(\/?)([a-z0-9]{1,16})/i.exec(html.slice(lt + 1, Math.min(gt, lt + 20)));
    const name = head === null ? "" : `${head[1]}${head[2]!.toLowerCase()}`;
    if (SKIPPED.has(name)) {
      const close = closeTagAt(html, name, gt + 1);
      const closeGt = close < 0 ? -1 : html.indexOf(">", close);
      if (closeGt < 0) return { text: out.join(""), dropped: true };
      out.push(" ");
      i = closeGt + 1;
      continue;
    }
    out.push(LINE_ENDS.has(name) ? "\n" : " ");
    i = gt + 1;
  }
  return { text: out.join(""), dropped: false };
}

/** What every URL-like token becomes in text this layer returns (review D9). */
export const LINK_MARKER = "[link]";
/** A scheme and `//`, `www.`, or a scheme that needs no slashes; the URL runs to whitespace, a quote or a bracket. */
const URL_RUN = /(?:[a-z][a-z0-9+.-]{0,30}:\/\/|www\.|(?:mailto|javascript|vbscript|data|tel|sms):)[^\s"'<>]*/gi;
/** A bare host with a path (`evil.example/login`), checked per whitespace-free token of bounded length. */
const HOST_PATH = /^[(\[{]?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*\/\S*$/i;
const HOST_PATH_TOKEN_MAX = 512;

/**
 * Every URL-like token replaced with `[link]`: anything with a scheme (`https://`, `mailto:`, `javascript:`), a
 * `www.` host, or a bare host followed by a path. A bare `name.tld` with no scheme and no path is left as it is
 * (it can't be told apart from ordinary words like file names), and so is an email address.
 */
export function linkless(text: string): string {
  return text.replace(URL_RUN, LINK_MARKER).replace(/\S+/g, (tok) => (tok.length <= HOST_PATH_TOKEN_MAX && HOST_PATH.test(tok) ? LINK_MARKER : tok));
}

/**
 * Format and invisible characters (Unicode Cf: the tag block, bidi controls, joiners, the soft hyphen, the BOM) and
 * the line and paragraph separators each become a space, so nothing hidden survives and no two words run together.
 */
const INVISIBLE = /\p{Cf}/gu;
const SEPARATORS = /[\u2028\u2029]/g;

/** A one-line field (a subject, a title, a name) as this layer lets it leave: no invisible characters, one line. */
export function visibleText(s: string): string {
  return s.replace(INVISIBLE, " ").replace(SEPARATORS, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/** `s` cut to at most `n` UTF-16 units, never between the two halves of a surrogate pair (review D8). */
export function cutAt(s: string, n: number): string {
  if (s.length <= n) return s;
  const end = n > 0 && s.charCodeAt(n - 1) >= 0xd800 && s.charCodeAt(n - 1) <= 0xdbff ? n - 1 : n;
  return s.slice(0, Math.max(0, end));
}

/**
 * Plain text from an HTML body, at most `maxChars` long, and whether part of it was dropped (an unclosed tag,
 * comment or skipped element, or an input past `MAIL_HTML_INPUT_MAX`). Scripts, styles and comments are dropped with
 * their contents; block ends become line breaks; every other tag is removed; a few entities are decoded; control and
 * invisible characters go; every URL-like token is `[link]` (`linkless`).
 */
export function mailTextOf(html: string, maxChars: number): { text: string; dropped: boolean } {
  const stripped = stripTags(html.slice(0, MAIL_HTML_INPUT_MAX));
  const text = stripped.text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8}|#39);/gi, decodeEntity);
  return { text: plainText(text, maxChars), dropped: stripped.dropped || html.length > MAIL_HTML_INPUT_MAX };
}

/** `mailTextOf`'s text. */
export function mailText(html: string, maxChars: number): string {
  return mailTextOf(html, maxChars).text;
}

/** A plain-text body tidied and bounded the same way. */
export function plainText(text: string, maxChars: number): string {
  const tidy = linkless(
    text
      .slice(0, MAIL_HTML_INPUT_MAX)
      .replace(/\r\n?/g, "\n")
      .replace(INVISIBLE, " ")
      .replace(SEPARATORS, " ")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cutAt(tidy, maxChars);
}

// ---------------------------------------------------------------------------------------------
// Free time

/** Ruling 25: a window is at most this many days. */
export const FREE_TIME_DAYS_MAX = 14;
/** At most this many gaps are answered. */
export const FREE_GAPS_MAX = 24;

export interface BusyEvent {
  startMs: number;
  endMs: number;
  allDay: boolean;
  /** Cancelled, declined or transparent: it does not block time. An opaque all-day event blocks its whole span. */
  free: boolean;
}

export interface DayBounds {
  /** Local minutes from midnight, 0 to 1440, start before end. */
  startMinute: number;
  endMinute: number;
}

/**
 * Review D10: whether a free-time ask can be answered at all. A length that is not a whole number of minutes, is not
 * positive, or is longer than the day bounds allow is `invalid`, never an empty "no gaps" answer.
 */
export function freeTimeAsk(minutes: number, bounds: DayBounds): "ok" | "invalid" {
  if (!(Number.isInteger(bounds.startMinute) && Number.isInteger(bounds.endMinute) && bounds.startMinute >= 0 && bounds.endMinute <= 1440 && bounds.startMinute < bounds.endMinute)) return "invalid";
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= bounds.endMinute - bounds.startMinute ? "ok" : "invalid";
}

/** The default day the owner can be booked in: 9:00 to 18:00 local. A named constant, not a model's guess. */
export const DEFAULT_DAY_BOUNDS: DayBounds = { startMinute: 9 * 60, endMinute: 18 * 60 };

const instantOf = (day: string, minute: number, zone: string) => (minute >= 1440 ? localMinuteAt(addCivilDays(day, 1), minute - 1440, zone) : localMinuteAt(day, minute, zone));

/**
 * Gaps of at least `minutes` between busy events, inside the day bounds of each civil day in `zone` that the window
 * touches, clipped to the window. Free events don't block; an opaque all-day event does (review D10). Pure; the window must be at most
 * `FREE_TIME_DAYS_MAX` days, or the answer is empty.
 */
export function freeGaps(events: readonly BusyEvent[], window: { fromMs: number; toMs: number }, zone: string, bounds: DayBounds, minutes: number): { startMs: number; endMs: number }[] {
  const { fromMs, toMs } = window;
  if (!(toMs > fromMs) || toMs - fromMs > FREE_TIME_DAYS_MAX * 86_400_000 || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return [];
  if (!(bounds.startMinute >= 0 && bounds.endMinute <= 1440 && bounds.startMinute < bounds.endMinute)) return [];
  const busy = events
    .filter((e) => !e.free && e.endMs > e.startMs)
    .map((e) => ({ s: e.startMs, e: e.endMs }))
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const need = minutes * 60_000;
  const out: { startMs: number; endMs: number }[] = [];
  const last = civilDateAt(toMs - 1, zone);
  for (let day = civilDateAt(fromMs, zone), n = 0; day <= last && n <= FREE_TIME_DAYS_MAX + 1; day = addCivilDays(day, 1), n++) {
    const ds = instantOf(day, bounds.startMinute, zone);
    const de = instantOf(day, bounds.endMinute, zone);
    if (ds === null || de === null) continue;
    let cursor = Math.max(ds, fromMs);
    const end = Math.min(de, toMs);
    for (const b of busy) {
      if (b.e <= cursor) continue;
      if (b.s >= end) break;
      if (b.s - cursor >= need) out.push({ startMs: cursor, endMs: b.s });
      cursor = Math.max(cursor, b.e);
      if (out.length >= FREE_GAPS_MAX) return out;
    }
    if (end - cursor >= need) out.push({ startMs: cursor, endMs: end });
    if (out.length >= FREE_GAPS_MAX) return out;
  }
  return out;
}
