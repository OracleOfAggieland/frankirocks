/**
 * Brief 049 part C, review fixes E3 and E5: the calendar tools' windows and every time the planner or the owner
 * sees, worked out by code. Pure: the instant `nowMs` (the ops clock, for a real calendar) and one zone (the
 * calendar's own) go in.
 *
 *   - A period keeps its own start and end ("in December" is Dec 1 to Dec 31; "this week" Monday to Sunday;
 *     "until Friday" now to the end of Friday); a day phrase is that day; a phrase with a clock time ("Thursday at
 *     9") is that time for `minutes` (an hour by default).
 *   - A window longer than `CALENDAR_DAYS_MAX` days is clipped to its first 14, with `clipped` set.
 *   - An optional part of day (morning, afternoon, evening), given or said in the phrase, narrows each day's bounds.
 *   - For free time, the window starts no earlier than now (`fromNow`), so no gap is already past.
 *   - `errandLocalTime` renders an instant as local text ("Thu, Nov 5, 1:00 PM"), so no model converts a time.
 */
import { addCivilDays, civilDateAt, localMinuteAt, resolvePeriod, resolveSpoken } from "../dates";
import type { DayBounds } from "../google/index";

export const CALENDAR_DAYS_MAX = 14;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const PARTS_OF_DAY = ["morning", "afternoon", "evening"] as const;
export type PartOfDay = (typeof PARTS_OF_DAY)[number];
/** Each part of day as local minutes: 8 to 12, 12 to 17, 17 to 21. */
export const PART_BOUNDS: Record<PartOfDay, DayBounds> = {
  morning: { startMinute: 8 * 60, endMinute: 12 * 60 },
  afternoon: { startMinute: 12 * 60, endMinute: 17 * 60 },
  evening: { startMinute: 17 * 60, endMinute: 21 * 60 },
};

export interface CalendarWindow {
  fromMs: number;
  toMs: number;
  /** The phrase named more than 14 days; this window is its first 14. */
  clipped: boolean;
  part: PartOfDay | null;
  /** A clock time was said ("at 9"): the window is that time on. */
  timed: boolean;
}

/** The part of day a phrase names, if exactly one. */
export function partOfDayIn(words: string): PartOfDay | null {
  const w = words.toLowerCase();
  const found = PARTS_OF_DAY.filter((p) => new RegExp(`\\b${p}\\b`).test(w));
  if (/\btonight\b/.test(w) && !found.includes("evening")) found.push("evening");
  return found.length === 1 ? found[0]! : null;
}

const MONDAY_FIRST = (civil: string): number => (new Date(`${civil}T00:00:00Z`).getUTCDay() + 6) % 7;

/** The start of a resolved period, from its phrase: the period's own first day (or now for "until"). */
function periodStart(words: string, kind: string, endCivil: string, nowMs: number, zone: string): number | null {
  const today = civilDateAt(nowMs, zone);
  if (/^until\b/.test(words)) return nowMs;
  if (kind === "week") return localMinuteAt(addCivilDays(today, -MONDAY_FIRST(today)), 0, zone);
  if (kind === "month") return localMinuteAt(`${endCivil.slice(0, 7)}-01`, 0, zone);
  if (kind === "year") return localMinuteAt(`${endCivil.slice(0, 4)}-01-01`, 0, zone);
  return localMinuteAt(today, 0, zone);
}

/**
 * The window a calendar phrase names, in `zone`, or null when code can't place it. `minutes`: how long a timed ask
 * is ("at 9 for 45 minutes"). `fromNow`: free time, which never looks at time already past.
 */
export function calendarWindow(when: string, nowMs: number, zone: string, x: { part?: PartOfDay | null; minutes?: number; fromNow?: boolean } = {}): CalendarWindow | null {
  const words = when.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  if (words === "") return null;
  const part = x.part ?? partOfDayIn(words);
  let fromMs: number | null = null;
  let toMs: number | null = null;
  let timed = false;
  const bare = words.replace(/\b(in the )?(morning|afternoon|evening)\b/g, "").replace(/\s+/g, " ").trim();
  const period = resolvePeriod(bare === "" ? words : bare, nowMs, zone);
  if (period !== null) {
    fromMs = periodStart(bare, period.kind, period.civilEnd, nowMs, zone);
    toMs = period.endMs + 1;
  } else {
    const day = resolveSpoken(words, nowMs, zone);
    if (day === null) return null;
    if (day.precision === "instant") {
      timed = true;
      fromMs = day.startMs;
      toMs = day.startMs + (x.minutes !== undefined && x.minutes > 0 ? x.minutes * 60_000 : HOUR_MS);
    } else {
      const date = civilDateAt(day.startMs, zone);
      fromMs = localMinuteAt(date, 0, zone);
      toMs = localMinuteAt(addCivilDays(date, 1), 0, zone);
    }
  }
  if (fromMs === null || toMs === null || toMs <= fromMs) return null;
  let clipped = false;
  if (toMs - fromMs > CALENDAR_DAYS_MAX * DAY_MS) {
    toMs = fromMs + CALENDAR_DAYS_MAX * DAY_MS;
    clipped = true;
  }
  if (x.fromNow === true) fromMs = Math.max(fromMs, nowMs);
  return { fromMs, toMs, clipped, part: timed ? null : part, timed };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${zone}|${withTime}`;
  let f = formatters.get(key);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", withTime ? { timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { timeZone: zone, weekday: "short", month: "short", day: "numeric" });
    formatters.set(key, f);
  }
  return f;
}

/** "Thu, Nov 5, 1:00 PM" (or "Thu, Nov 5" for a day) in `zone`. Empty for an instant that isn't one. */
export function errandLocalTime(ms: number, zone: string, withTime = true): string {
  if (!Number.isFinite(ms)) return "";
  return formatter(zone, withTime).format(new Date(ms)).replace(/ /g, " ");
}
