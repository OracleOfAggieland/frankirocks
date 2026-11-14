/**
 * Brief 049 rulings 20 and 25: one Calendar API event (primary calendar, `singleEvents=true`) as the content of one
 * Evidence row. The provider's typed fields are read by code; the title is data. An all-day event's dates are read
 * in the calendar's own time zone. An event's title is O only when the owner both organizes and created it
 * (review D4); otherwise T.
 */
import { type Hasher, isZone, linkless, localMinuteAt, visibleText } from "@franki/core";

export const EVENT_TITLE_CHARS = 1_024;
const EVENT_ID = /^[A-Za-z0-9_-]{1,1024}$/;

export interface EventContent {
  eventId: string;
  etag: string | null;
  title: string | null;
  startMs: number;
  endMs: number;
  zone: string;
  allDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  selfResponse: "accepted" | "tentative" | "declined" | "needsAction" | "none";
  transparency: "opaque" | "transparent";
  organizerSelf: boolean;
  /** Review D4: read from Google's `creator.self`, never copied from the organizer. */
  creatorSelf: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Review D9: a title leaves with no invisible character and no link. */
const clean = (s: string) => linkless(visibleText(s)).trim();

/** The calendar's zone when it is a real IANA zone, else UTC. */
export const calendarZone = (z: string | null) => (z !== null && isZone(z) ? z : "UTC");

function instantOf(v: unknown, zone: string): { ms: number; allDay: boolean } | null {
  if (!isObj(v)) return null;
  if (typeof v.dateTime === "string" && v.dateTime.length <= 40) {
    const ms = Date.parse(v.dateTime);
    return Number.isSafeInteger(ms) ? { ms, allDay: false } : null;
  }
  if (typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date)) {
    const ms = localMinuteAt(v.date, 0, zone);
    return ms === null ? null : { ms, allDay: true };
  }
  return null;
}

const STATUSES = ["confirmed", "tentative", "cancelled"] as const;
const RESPONSES: Record<string, EventContent["selfResponse"]> = { accepted: "accepted", tentative: "tentative", declined: "declined", needsAction: "needsAction" };

/** The content of one event, or null when it can't be read (no ID, no times, an end before its start). */
export function eventContent(item: unknown, calendarTimeZone: string): EventContent | null {
  if (!isObj(item) || typeof item.id !== "string" || !EVENT_ID.test(item.id)) return null;
  const start = instantOf(item.start, calendarTimeZone);
  const end = instantOf(item.end, calendarTimeZone);
  if (start === null || end === null || end.ms < start.ms) return null;
  const status = (STATUSES as readonly unknown[]).includes(item.status) ? (item.status as EventContent["status"]) : "confirmed";
  const attendees = Array.isArray(item.attendees) ? item.attendees.slice(0, 200) : [];
  const self = attendees.find((a) => isObj(a) && a.self === true);
  const selfResponse = isObj(self) && typeof self.responseStatus === "string" ? (RESPONSES[self.responseStatus] ?? "none") : "none";
  const summary = typeof item.summary === "string" ? clean(item.summary.slice(0, 4 * EVENT_TITLE_CHARS)).slice(0, EVENT_TITLE_CHARS) : "";
  return {
    eventId: item.id,
    etag: typeof item.etag === "string" ? item.etag.slice(0, 128) : null,
    title: summary === "" ? null : summary,
    startMs: start.ms,
    endMs: end.ms,
    zone: calendarTimeZone,
    allDay: start.allDay,
    status,
    selfResponse,
    transparency: item.transparency === "transparent" ? "transparent" : "opaque",
    organizerSelf: isObj(item.organizer) && item.organizer.self === true,
    creatorSelf: isObj(item.creator) && item.creator.self === true,
  };
}

export const calendarProviderKey = (hasher: Hasher, connectorId: string, eventId: string) => hasher.id(["gcal-event", connectorId, eventId]);
export const calendarLogicalId = (hasher: Hasher, uid: string, connectorId: string, eventId: string) => hasher.id(["gcal-row", uid, connectorId, eventId]);
export const calendarKeyOf = (hasher: Hasher, connectorId: string) => hasher.id(["gcal-calendar", connectorId, "primary"]);
