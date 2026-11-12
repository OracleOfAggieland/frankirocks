/**
 * The spoken-time resolver (memory-spec §5: "Models never set dates. They emit the words said. A pure resolver
 * computes candidates from speech time, both zones, a social 'today' before 4 AM"). Pure: the words, the instant
 * they were said and the Owner's zone go in; one civil day (and a clock time when one was said) comes out, or null
 * when the words do not name exactly one day this resolver can be sure of ("next Friday", "next week", "in the
 * spring", "Friday or Saturday"). A null keeps the spoken words and the day they were said, so Franki can hedge.
 * The holiday table and recurrence are later work.
 */
import { type Time, tsFromMs } from "./schema/primitives";

export interface ResolvedTime {
  /** ISO local date (`YYYY-MM-DD`) or date-time (`YYYY-MM-DDTHH:mm`) in `zone`. */
  civilStart: string;
  precision: "instant" | "day";
  /** UTC instant of the start: the said time, or local midnight for a day. */
  startMs: number;
  zone: string;
  /** Short English rendering, e.g. "Friday, Nov 7 at 3 PM". */
  label: string;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const COUNTS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** Before this local hour, "today" still means the day that began yesterday (the social day). */
const SOCIAL_DAY_START_HOUR = 4;
/** How far ahead a month and day said without a year may land; past it, the one just gone by is as likely. */
const MAX_DAYS_AHEAD = 270;
const DAY_MS = 86_400_000;

const WEEKDAY = WEEKDAYS.join("|");
const ORDINAL_WORD =
  "(twenty|thirty)?[- ]?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)";
/** Days counted from another day ("a week from Friday", "a week on Friday", "the day before Friday"). */
const COUNTED_FROM = /\b(days?|weeks?) (from|after|before|on)\b/;
/**
 * Day words that do not mean the coming one: counted from another day ("Friday after next", "Friday week", "a week
 * today", "the Monday after Thanksgiving"), pinned to a date ("Friday the 13th") or named for a holiday ("Black
 * Friday"). The holiday table is later work.
 */
const OTHER_WEEKDAY = new RegExp(
  [
    `\\bafter next\\b|\\b(${WEEKDAY}) next\\b`,
    `\\b(${WEEKDAY}|today|tomorrow) week\\b|\\bweeks? (${WEEKDAY}|today|tomorrow)\\b`,
    `\\bthe (${WEEKDAY}) (after|before)\\b|\\b(${WEEKDAY}) (after|before) (christmas|thanksgiving|easter|halloween)\\b`,
    `\\b(${WEEKDAY}),? (the (\\d{1,2}(st|nd|rd|th)?|${ORDINAL_WORD})|\\d{1,2}(st|nd|rd|th))\\b`,
    `\\b(black|good|cyber|easter|palm|ash|holy|maundy|shrove|fat|giving|bowl) (${WEEKDAY})\\b`,
  ].join("|"),
);

interface Civil {
  y: number;
  m: number;
  d: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsAt(ms: number, zone: string): Civil & { hh: number; mm: number } {
  let f = formatters.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    formatters.set(zone, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour") % 24, mm: get("minute") };
}

function addDays(c: Civil, n: number): Civil {
  const t = new Date(Date.UTC(c.y, c.m - 1, c.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const weekdayOf = (c: Civil) => new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay();
const pad = (n: number) => String(n).padStart(2, "0");
const realDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const before = (a: Civil, b: Civil) => Date.UTC(a.y, a.m - 1, a.d) < Date.UTC(b.y, b.m - 1, b.d);
const daysFrom = (a: Civil, b: Civil) => (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS;

/** How far `zone`'s clock is ahead of UTC at an instant, in ms. */
function offsetAt(ms: number, zone: string): number {
  const p = partsAt(ms, zone);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - Math.floor(ms / 60_000) * 60_000;
}

/** The instants that may read as a local wall time: one per offset `zone` uses within a day of it. */
function candidates(wall: number, zone: string): number[] {
  const offsets = new Set([wall - DAY_MS, wall, wall + DAY_MS].map((ms) => offsetAt(ms, zone)));
  return [...offsets].map((o) => wall - o);
}

/** The UTC instant of a local clock time in `zone`, or null when DST skips it (no instant) or repeats it (two). */
function zonedToUtc(c: Civil, hh: number, mm: number, zone: string): number | null {
  const wall = Date.UTC(c.y, c.m - 1, c.d, hh, mm);
  const exact = candidates(wall, zone).filter((ms) => ms + offsetAt(ms, zone) === wall);
  return exact.length === 1 ? exact[0]! : null;
}

/** The first instant of a civil day in `zone`: local midnight, or the end of a DST gap that skips it. */
function dayStartUtc(c: Civil, zone: string): number | null {
  const starts = candidates(Date.UTC(c.y, c.m - 1, c.d), zone).filter((ms) => {
    const p = partsAt(ms, zone);
    return p.y === c.y && p.m === c.m && p.d === c.d;
  });
  return starts.length === 0 ? null : Math.min(...starts);
}

type DayHit = { day: Civil; evening: boolean };

/** Every day expression in the words, resolved against the social reference day. */
function dayHits(words: string, ref: Civil, refHourEvening: boolean, monthFirst: boolean): DayHit[] | null {
  const hits: DayHit[] = [];
  const add = (day: Civil, evening = false) => hits.push({ day, evening });
  // Ranges and relative weeks this resolver will not pick a day for.
  if (/\bnext (week|month|year|weekend)\b|\b(this|next|last) (spring|summer|fall|autumn|winter)\b|\bweekend\b|\bsometime\b|\bor\b/.test(words)) return null;
  if (/\bnext (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(words)) return null;
  if (/\b(last|yesterday|ago)\b/.test(words)) return null;
  // "The day after tomorrow" is the one counted day resolved here.
  if (COUNTED_FROM.test(words.replace(/\bday after tomorrow\b/g, "")) || OTHER_WEEKDAY.test(words)) return null;

  if (/\bday after tomorrow\b/.test(words)) add(addDays(ref, 2));
  else if (/\b(tomorrow|tmrw|tomorrow's)\b/.test(words)) add(addDays(ref, 1), /\b(night|evening)\b/.test(words));
  if (/\btonight\b/.test(words)) add(ref, true);
  if (/\btoday\b|\bthis (morning|afternoon|evening)\b/.test(words)) add(ref, /\bthis evening\b/.test(words) || refHourEvening);

  const inN = /\bin (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2}) (day|days|week|weeks)\b/.exec(words);
  if (inN !== null) {
    const n = COUNTS[inN[1]!] ?? Number(inN[1]);
    add(addDays(ref, inN[2]!.startsWith("week") ? 7 * n : n));
  }

  const weekdays: { target: number; lead: string | undefined }[] = [];
  for (const m of words.matchAll(/\b(this |on |by |until |til )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(s)?\b/g)) {
    // "On Fridays" is a habit, not a day.
    if (m[3] !== undefined) return null;
    weekdays.push({ target: WEEKDAYS.indexOf(m[2]!), lead: m[1] });
  }

  // "Half an hour" written "1/2 hour" is no date.
  if (/\b\d{1,2}\/\d{1,2} ?(an? )?(hours?|hrs?|minutes?|mins?)\b/.test(words)) return null;
  const monthNames = Object.keys(MONTHS).join("|");
  const monthDay = new RegExp(`\\b(${monthNames})\\.? (\\d{1,2})(st|nd|rd|th)?(,? (\\d{4}))?\\b`, "g");
  const dayOfMonth = new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)? of (${monthNames})(,? (\\d{4}))?\\b`, "g");
  const monthDays: { m: number; d: number; y: number | null }[] = [];
  for (const m of words.matchAll(monthDay)) monthDays.push({ m: MONTHS[m[1]!]!, d: Number(m[2]), y: m[5] === undefined ? null : Number(m[5]) });
  for (const m of words.matchAll(dayOfMonth)) monthDays.push({ m: MONTHS[m[3]!]!, d: Number(m[1]), y: m[5] === undefined ? null : Number(m[5]) });
  const slashDates = [...words.matchAll(/\b(\d{1,2})\/(\d{1,2})(\/(\d{2}|\d{4}))?\b/g)];
  // "3/4" is March 4 in the US and 3 April in most other places, so slash dates resolve only in American zones.
  if (slashDates.length > 0 && !monthFirst) return null;
  for (const m of slashDates) {
    const y = m[4] === undefined ? null : m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
    monthDays.push({ m: Number(m[1]), d: Number(m[2]), y });
  }
  const dates: Civil[] = [];
  for (const md of monthDays) {
    if (md.m < 1 || md.m > 12) return null;
    let y = md.y ?? ref.y;
    if (!realDay(y, md.m, md.d)) return null;
    if (md.y === null) {
      // Without a year, the next one on or after the reference day, unless that is most of a year out: "November 2"
      // said on November 6 is as likely the one just gone by.
      if (before({ y, m: md.m, d: md.d }, ref)) y += 1;
      if (daysFrom(ref, { y, m: md.m, d: md.d }) > MAX_DAYS_AHEAD) return null;
    }
    if (!realDay(y, md.m, md.d)) return null;
    dates.push({ y, m: md.m, d: md.d });
  }
  if (dates.length > 0) {
    // A weekday said with a date only names the date's own weekday ("Friday, November 13"); any other weekday makes
    // it two days.
    if (weekdays.some((w) => dates.some((d) => weekdayOf(d) !== w.target))) return null;
    for (const d of dates) add(d);
    return hits;
  }
  for (const w of weekdays) {
    const delta = (w.target - weekdayOf(ref) + 7) % 7;
    // "Friday" said on a Friday could be today or a week out, so only "this Friday" or "today" names today.
    if (delta === 0 && w.lead !== "this " && !/\b(today|tonight)\b/.test(words)) return null;
    add(addDays(ref, delta));
  }
  return hits;
}

/** The clock time in the words, if exactly one is said; null hours when none. Hours default to daytime. */
function clockTime(words: string, evening: boolean, morning: boolean): { hh: number; mm: number } | null | "ambiguous" {
  // Midnight ends one day and starts the next, so the words do not say which day it falls on.
  if (/\bmidnight\b/.test(words)) return "ambiguous";
  const night = /\b(evening|night|tonight|dinner)\b/.test(words);
  const found: { hh: number; mm: number }[] = [];
  if (/\bnoon\b|\bmidday\b/.test(words)) found.push({ hh: 12, mm: 0 });
  const re = /\b(at |by |around |from )?(\d{1,2})(:(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)?(?=[\s,.!?]|$)/g;
  for (const m of words.matchAll(re)) {
    const lead = m[1];
    const minutes = m[4];
    const suffix = m[5]?.replace(/\./g, "");
    // A bare number is a time only after "at"/"by"/"around"/"from", or with minutes or a suffix.
    if (lead === undefined && minutes === undefined && suffix === undefined) continue;
    let hh = Number(m[2]);
    const mm = minutes === undefined ? 0 : Number(minutes);
    if (hh > 23 || mm > 59) return "ambiguous";
    if (suffix === "pm") {
      if (hh < 12) hh += 12;
    } else if (suffix === "am") {
      // "Tonight at 1 AM" is after midnight, so on the next day.
      if (night) return "ambiguous";
      if (hh === 12) hh = 0;
    } else if (hh >= 1 && hh <= 12) {
      // No AM/PM: evening words make it PM, morning words AM; otherwise 1–6 is afternoon and 7–11 morning. At night a
      // bare 12 may be midnight, and morning and evening words together do not say which half of the day.
      if (evening && (hh === 12 || morning)) return "ambiguous";
      if (evening) hh += 12;
      else if (!morning && hh <= 6) hh += 12;
    }
    found.push({ hh, mm });
  }
  const distinct = new Set(found.map((f) => `${f.hh}:${f.mm}`));
  if (distinct.size > 1) return "ambiguous";
  return found[0] ?? null;
}

function label(day: Civil, time: { hh: number; mm: number } | null, refYear: number): string {
  const base = `${WEEKDAY_NAMES[weekdayOf(day)]}, ${MONTH_NAMES[day.m - 1]} ${day.d}${day.y === refYear ? "" : `, ${day.y}`}`;
  if (time === null) return base;
  const h12 = time.hh % 12 === 0 ? 12 : time.hh % 12;
  const clock = time.hh === 12 && time.mm === 0 ? "noon" : `${h12}${time.mm === 0 ? "" : `:${pad(time.mm)}`} ${time.hh < 12 ? "AM" : "PM"}`;
  return `${base} at ${clock}`;
}

const TIME_WORDS = new RegExp(
  `\\b(${[...WEEKDAYS.map((w) => `${w}s?`), ...Object.keys(MONTHS)].join("|")}|today|tonight|tomorrow|tmrw|yesterday|morning|afternoon|evening|night|noon|midnight|weekends?|weeks?|months?|years?|days?|spring|summer|fall|autumn|winter|soon|later|ago|am|pm|a\\.m|p\\.m|o'?clock|christmas|thanksgiving|easter|halloween)\\b|\\d`,
);

/** Whether spoken words name a time at all ("Friday at 3", "in March", "next spring"; not "in college"). */
export function looksLikeTime(spoken: string): boolean {
  return TIME_WORDS.test(spoken.normalize("NFKC").toLowerCase());
}

/**
 * Resolves spoken time words said at `spokenAtMs` in `zone`, or null when they do not name exactly one day, or name
 * a clock time that DST skips or repeats.
 */
export function resolveSpoken(spoken: string, spokenAtMs: number, zone: string): ResolvedTime | null {
  const words = spoken.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  if (words === "") return null;
  const now = partsAt(spokenAtMs, zone);
  const today: Civil = { y: now.y, m: now.m, d: now.d };
  const smallHours = now.hh < SOCIAL_DAY_START_HOUR;
  // Before 4 AM, "today" and "tonight" could mean the day that is ending or the one that is starting.
  if (smallHours && /\b(today|tonight)\b|\bthis (morning|afternoon|evening)\b/.test(words)) return null;
  const ref = smallHours ? addDays(today, -1) : today;
  // Said after 5 PM, "today at 9" is 9 PM, but "this morning at 9" is still 9 AM.
  const lateDefault = now.hh >= 17 && !/\b(morning|afternoon|breakfast|lunch)\b/.test(words);
  const hits = dayHits(words, ref, lateDefault, zone.startsWith("America/"));
  if (hits === null || hits.length === 0) return null;
  const days = new Set(hits.map((h) => `${h.day.y}-${h.day.m}-${h.day.d}`));
  if (days.size !== 1) return null;
  const day = hits[0]!.day;
  const evening = hits.some((h) => h.evening) || /\b(evening|night|tonight|dinner)\b/.test(words);
  const morning = /\b(morning|breakfast)\b/.test(words);
  const time = clockTime(words, evening, morning);
  if (time === "ambiguous") return null;
  const startMs = time === null ? dayStartUtc(day, zone) : zonedToUtc(day, time.hh, time.mm, zone);
  if (startMs === null) return null;
  const civilDate = `${day.y}-${pad(day.m)}-${pad(day.d)}`;
  return {
    civilStart: time === null ? civilDate : `${civilDate}T${pad(time.hh)}:${pad(time.mm)}`,
    precision: time === null ? "day" : "instant",
    startMs,
    zone,
    label: label(day, time, ref.y),
  };
}

/** The Memory `time` row for a resolved spoken time (no end, no recurrence). */
export function timeRow(r: ResolvedTime): Time {
  return {
    start: tsFromMs(r.startMs),
    end: null,
    zone: r.zone,
    civilStart: r.civilStart,
    civilEnd: null,
    precision: r.precision,
    rrule: null,
    dtstart: null,
    originalCivilStart: null,
    recurrence: null,
  };
}

/** "2026-11-05": the civil date an instant falls on in `zone`. */
export function civilDateAt(ms: number, zone: string): string {
  const p = partsAt(ms, zone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** "Wednesday, Nov 5": the civil day an instant falls on in `zone`, for lines that keep unresolved words. */
export function spokenOnLabel(spokenAtMs: number, zone: string): string {
  const p = partsAt(spokenAtMs, zone);
  return label({ y: p.y, m: p.m, d: p.d }, null, p.y);
}

// ---------------------------------------------------------------------------------------------
// Brief 023 (lane seed, F6): local wall times for derive and delivery.

/**
 * The instant of a local wall minute (0 to 1439) on a civil date (`YYYY-MM-DD`) in `zone`, or null for a date that
 * is not one. A minute DST skips is shifted forward by the gap; a repeated minute takes the first
 * instant (design note 023 gap 6).
 */
export function localMinuteAt(civilDate: string, minute: number, zone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civilDate);
  if (m === null || !Number.isInteger(minute) || minute < 0 || minute > 1439) return null;
  const c: Civil = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (!realDay(c.y, c.m, c.d)) return null;
  const wall = Date.UTC(c.y, c.m - 1, c.d, Math.floor(minute / 60), minute % 60);
  const exact = candidates(wall, zone).filter((ms) => ms + offsetAt(ms, zone) === wall);
  if (exact.length > 0) return Math.min(...exact);
  // Inside a gap: read with the offset from before the gap, the wall time lands after it, shifted forward by the gap.
  const after = candidates(wall, zone).filter((ms) => ms + offsetAt(ms, zone) > wall);
  return after.length === 0 ? null : Math.min(...after);
}

/** The local wall minute (0 to 1439) of an instant in `zone`. */
export function localMinuteOf(ms: number, zone: string): number {
  const p = partsAt(ms, zone);
  return p.hh * 60 + p.mm;
}

/** The civil date `n` days after `civilDate` (`YYYY-MM-DD`). */
export function addCivilDays(civilDate: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civilDate);
  if (m === null) return civilDate;
  const c = addDays({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }, n);
  return `${c.y}-${pad(c.m)}-${pad(c.d)}`;
}

// ---------------------------------------------------------------------------------------------
// Brief 039: a period has an end.

export type PeriodKind = "week" | "month" | "year" | "day";

export interface ResolvedPeriod {
  /** The last instant of the period, in UTC ms: the next millisecond is outside it. */
  endMs: number;
  /** The civil date (`YYYY-MM-DD`) the period ends on, in `zone`. */
  civilEnd: string;
  /** What the period was: a week, a month (with its number), a year, or a span of days ending on a day. */
  kind: PeriodKind;
  month: number | null;
  year: number;
  zone: string;
}

/** The most days and weeks "for N days" and "for N weeks" may say. */
export const PERIOD_MAX_DAYS = MAX_DAYS_AHEAD;

const PERIOD_THIS = /^(?:for )?this (week|month|year)$/;
const PERIOD_MONTH = new RegExp(`^(?:for|in) (${Object.keys(MONTHS).join("|")})$`);
const PERIOD_COUNT = new RegExp(`^for ([0-9]{1,3}|${Object.keys(COUNTS).join("|")}) (days?|weeks?)$`);
const PERIOD_UNTIL = /^until (.+)$/;

/** The last instant of a civil day in `zone`: the next day's first instant, less 1 ms. */
function dayEndUtc(c: Civil, zone: string): number | null {
  for (let n = 1; n <= 3; n++) {
    const start = dayStartUtc(addDays(c, n), zone);
    if (start !== null) return start - 1;
  }
  return null;
}

/**
 * The end of a period said at `spokenAtMs` in `zone`, from a closed list of phrases (brief 039): "this week" (weeks
 * run Monday to Sunday), "this month", "this year" (each with an optional leading "for"), "for <month>" and
 * "in <month>" (the month while it lasts, else its next coming), "until <a day resolveSpoken reads>" (that day
 * included), "for N days" and "for N weeks" (today is the first day; N up to 270 days). Periods read the calendar
 * day, not the social day. Anything else is null: no end.
 */
export function resolvePeriod(spoken: string, spokenAtMs: number, zone: string): ResolvedPeriod | null {
  const words = spoken.normalize("NFKC").toLowerCase().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ").trim();
  if (words === "") return null;
  const now = partsAt(spokenAtMs, zone);
  const today: Civil = { y: now.y, m: now.m, d: now.d };
  let last: Civil | null = null;
  let kind: PeriodKind = "day";
  let month: number | null = null;
  const t = PERIOD_THIS.exec(words);
  const m = PERIOD_MONTH.exec(words);
  const n = PERIOD_COUNT.exec(words);
  const u = PERIOD_UNTIL.exec(words);
  if (t !== null) {
    kind = t[1] as PeriodKind;
    if (kind === "week") last = addDays(today, (7 - weekdayOf(today)) % 7);
    else if (kind === "year") last = { y: today.y, m: 12, d: 31 };
    else last = addDays({ y: today.m === 12 ? today.y + 1 : today.y, m: today.m === 12 ? 1 : today.m + 1, d: 1 }, -1);
  } else if (m !== null) {
    kind = "month";
    month = MONTHS[m[1]!]!;
    const y = month >= today.m ? today.y : today.y + 1;
    last = addDays({ y: month === 12 ? y + 1 : y, m: month === 12 ? 1 : month + 1, d: 1 }, -1);
  } else if (n !== null) {
    const count = /^\d+$/.test(n[1]!) ? Number(n[1]) : COUNTS[n[1]!]!;
    const days = n[2]!.startsWith("week") ? count * 7 : count;
    if (count < 1 || days > PERIOD_MAX_DAYS) return null;
    last = addDays(today, days - 1);
  } else if (u !== null) {
    const r = resolveSpoken(u[1]!, spokenAtMs, zone);
    if (r === null) return null;
    const [y, mo, d] = r.civilStart.slice(0, 10).split("-").map(Number) as [number, number, number];
    last = { y, m: mo, d };
    if (before(last, today)) return null;
  } else {
    return null;
  }
  if (kind === "month" && month === null) month = last.m;
  const endMs = dayEndUtc(last, zone);
  if (endMs === null) return null;
  return { endMs, civilEnd: `${last.y}-${pad(last.m)}-${pad(last.d)}`, kind, month, year: last.y, zone };
}
