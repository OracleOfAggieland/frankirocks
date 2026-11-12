/**
 * Civil-date arithmetic for the pattern detectors (pure; time arrives as arguments). A civil date is "YYYY-MM-DD";
 * a weekday is 0 for Sunday to 6 for Saturday.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    formatters.set(zone, f);
  }
  return f;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local date and minute of the day of an instant in `zone`. */
export function localAt(ms: number, zone: string): { date: string; minute: number } {
  const parts = formatter(zone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { date: `${get("year")}-${pad(get("month"))}-${pad(get("day"))}`, minute: (get("hour") % 24) * 60 + get("minute") };
}

const CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Milliseconds of the civil date's UTC midnight, or null when it isn't a real date. */
function utcMidnight(date: string): number | null {
  const m = CIVIL.exec(date);
  if (m === null) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

export const isCivilDate = (date: string): boolean => utcMidnight(date) !== null;

/** The weekday of a civil date, 0 for Sunday. */
export function weekdayOf(date: string): number {
  const ms = utcMidnight(date);
  return ms === null ? -1 : new Date(ms).getUTCDay();
}

export function addDays(date: string, n: number): string {
  const ms = utcMidnight(date);
  if (ms === null) return date;
  return new Date(ms + n * 86_400_000).toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, both inclusive; empty when `to` is before `from` or either isn't a date. */
export function datesFrom(from: string, to: string, max = 400): string[] {
  const a = utcMidnight(from);
  const b = utcMidnight(to);
  if (a === null || b === null || b < a) return [];
  const out: string[] = [];
  for (let d = from; out.length <= max; d = addDays(d, 1)) {
    out.push(d);
    if (d === to) break;
  }
  return out;
}

/** Weekday counts of the dates, Sunday first. */
export function weekdayCounts(dates: readonly string[]): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dates) {
    const w = weekdayOf(d);
    if (w >= 0) out[w]! += 1;
  }
  return out;
}

/**
 * The first instant of a civil date in `zone` (local midnight), or null when the zone skips midnight that day.
 * Found by correcting a UTC guess with the zone's offset twice, then checked.
 */
export function dayStart(date: string, zone: string): number | null {
  const wall = utcMidnight(date);
  if (wall === null) return null;
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const l = localAt(guess, zone);
    const lw = (utcMidnight(l.date) ?? wall) + l.minute * 60_000;
    guess += wall - lw;
  }
  const l = localAt(guess, zone);
  return l.date === date && l.minute === 0 ? guess : null;
}
