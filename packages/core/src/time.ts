/**
 * Civil-time formatting from a supplied instant (pure; no clock reads). Used for `core/counters.day` and the Head
 * `now` section, which state absolute dates in an IANA zone (R26.7).
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" });
    formatters.set(zone, f);
  }
  return f;
}

export interface CivilDay {
  /** `YYYY-MM-DD` in the zone. */
  date: string;
  /** English weekday name, e.g. "Tuesday". */
  weekday: string;
}

/** The civil date and weekday of `ms` (integer milliseconds) in `zone`. */
export function civilDay(ms: number, zone: string): CivilDay {
  const parts = partsFormatter(zone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday") };
}
