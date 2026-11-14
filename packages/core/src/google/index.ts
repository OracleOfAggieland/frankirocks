/**
 * Brief 049 (lane google): the pure parts of a Google connection. No I/O, no clock.
 *
 * - `isConnectedGoogleRow`: ruling 22. A row read from a connected Google account is read only by the errand
 *   helpers' read functions, never by the hero, the compare loop, the moments or the Lab counts.
 * - `gmailQuery`: ruling 23's query, built by code. Every term is cleaned to letters, digits and a few address
 *   characters, then quoted, so a word can't become a Gmail operator. Spam, trash, promotions and social are always
 *   left out.
 * - `mailText`: an HTML body reduced to plain text, bounded before and after, with no regex that can backtrack.
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

const epochSeconds = (ms: number | null) => (ms === null || !Number.isSafeInteger(ms) || ms < 0 ? null : Math.floor(ms / 1000));

/** The Gmail `q` for one search. */
export function gmailQuery(q: MailQuery): string {
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

/**
 * Removes tags in one left-to-right pass with `indexOf` only, so the work is linear in the input whatever its shape
 * (no backtracking regex over attacker text). An unclosed tag, comment or skipped element drops the rest.
 */
function stripTags(html: string): string {
  const lower = html.toLowerCase();
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
      if (end < 0) break;
      out.push(" ");
      i = end + 3;
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) break;
    const head = /^(\/?)([a-z0-9]{1,16})/.exec(lower.slice(lt + 1, Math.min(gt, lt + 20)));
    const name = head === null ? "" : `${head[1]}${head[2]}`;
    if (SKIPPED.has(name)) {
      const close = lower.indexOf(`</${name}`, gt + 1);
      const closeGt = close < 0 ? -1 : html.indexOf(">", close);
      if (closeGt < 0) break;
      out.push(" ");
      i = closeGt + 1;
      continue;
    }
    out.push(LINE_ENDS.has(name) ? "\n" : " ");
    i = gt + 1;
  }
  return out.join("");
}

/**
 * Plain text from an HTML body, at most `maxChars` long. Scripts, styles and comments are dropped with their
 * contents; block ends become line breaks; every other tag is removed; a few entities are decoded; control
 * characters become spaces. Links keep only their text: an `href` never survives.
 */
export function mailText(html: string, maxChars: number): string {
  const text = stripTags(html.slice(0, MAIL_HTML_INPUT_MAX)).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8}|#39);/gi, decodeEntity);
  return plainText(text, maxChars);
}

/** A plain-text body tidied and bounded the same way. */
export function plainText(text: string, maxChars: number): string {
  return text
    .slice(0, MAIL_HTML_INPUT_MAX)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
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
  /** Cancelled, declined or transparent: it does not block time. */
  free: boolean;
}

export interface DayBounds {
  /** Local minutes from midnight, 0 to 1440, start before end. */
  startMinute: number;
  endMinute: number;
}

/** The default day the owner can be booked in: 9:00 to 18:00 local. A named constant, not a model's guess. */
export const DEFAULT_DAY_BOUNDS: DayBounds = { startMinute: 9 * 60, endMinute: 18 * 60 };

const instantOf = (day: string, minute: number, zone: string) => (minute >= 1440 ? localMinuteAt(addCivilDays(day, 1), minute - 1440, zone) : localMinuteAt(day, minute, zone));

/**
 * Gaps of at least `minutes` between busy events, inside the day bounds of each civil day in `zone` that the window
 * touches, clipped to the window. All-day events and free events don't block. Pure; the window must be at most
 * `FREE_TIME_DAYS_MAX` days, or the answer is empty.
 */
export function freeGaps(events: readonly BusyEvent[], window: { fromMs: number; toMs: number }, zone: string, bounds: DayBounds, minutes: number): { startMs: number; endMs: number }[] {
  const { fromMs, toMs } = window;
  if (!(toMs > fromMs) || toMs - fromMs > FREE_TIME_DAYS_MAX * 86_400_000 || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return [];
  if (!(bounds.startMinute >= 0 && bounds.endMinute <= 1440 && bounds.startMinute < bounds.endMinute)) return [];
  const busy = events
    .filter((e) => !e.free && !e.allDay && e.endMs > e.startMs)
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
