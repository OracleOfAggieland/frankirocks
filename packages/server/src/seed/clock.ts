/**
 * The clone's clock (brief 019 task 6; spec §15): a clone starts on a Friday at 08:40 in the visitor's zone, and
 * every seeded date is relative to it. Pure: instants go in, instants come out; nothing reads the wall clock.
 */
import type { RelTime } from "./fixture";

/** The clone's world clock starts on this weekday (0 is Sunday) at this local minute. */
export const CLONE_WEEKDAY = 5;
export const CLONE_MINUTE = 8 * 60 + 40;

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function wallParts(ms: number, zone: string): { y: number; m: number; d: number; hh: number; mm: number } {
  let f = formatters.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(zone, f);
  }
  const p = f.formatToParts(new Date(ms));
  const n = (t: Intl.DateTimeFormatPartTypes) => Number(p.find((x) => x.type === t)?.value);
  return { y: n("year"), m: n("month"), d: n("day"), hh: n("hour"), mm: n("minute") };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local civil date (`YYYY-MM-DD`) of an instant. */
export function localDate(ms: number, zone: string): string {
  const p = wallParts(ms, zone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** The local minute of the day of an instant. */
export function localMinute(ms: number, zone: string): number {
  const p = wallParts(ms, zone);
  return p.hh * 60 + p.mm;
}

/** A civil date moved by whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 is Sunday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The instant of a local date and minute in `zone`. A minute that a DST change skips moves forward to the first
 * minute that exists; a repeated one takes the earlier instant. Seed times avoid both, so this only matters for
 * zones the seed was not written against.
 */
export function localInstant(date: string, minute: number, zone: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  for (let shift = 0; shift <= 180; shift += 30) {
    const wanted = minute + shift;
    const wall = Date.UTC(y, m - 1, d, 0, 0) + wanted * 60_000;
    const hits = [-1, 0, 1]
      .map((k) => {
        const probe = wall + k * DAY_MS / 2;
        const p = wallParts(probe, zone);
        const offset = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - Math.floor(probe / 60_000) * 60_000;
        return wall - offset;
      })
      .filter((ms, i, all) => all.indexOf(ms) === i)
      .filter((ms) => {
        const p = wallParts(ms, zone);
        return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) === wall;
      })
      .sort((a, b) => a - b);
    if (hits.length > 0) return hits[0]!;
  }
  throw new RangeError(`no local instant for ${date} minute ${minute} in ${zone}`);
}

/** The clone's world start: the latest local Friday 08:40 at or before `opsNow`. */
export function cloneWorldStart(opsNow: number, zone: string): number {
  const today = localDate(opsNow, zone);
  const back = (weekdayOf(today) - CLONE_WEEKDAY + 7) % 7;
  let friday = addDays(today, -back);
  let start = localInstant(friday, CLONE_MINUTE, zone);
  if (start > opsNow) {
    friday = addDays(friday, -7);
    start = localInstant(friday, CLONE_MINUTE, zone);
  }
  return start;
}

/** The instant of a relative time, against the clone's Friday (a local date). */
export function relInstant(friday: string, t: RelTime, zone: string): number {
  return localInstant(addDays(friday, t.day), t.minute, zone);
}
