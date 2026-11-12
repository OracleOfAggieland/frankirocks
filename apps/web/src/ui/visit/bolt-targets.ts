// The time bolt's targets (brief 027): the next few labeled times after the visit's world clock, never a free date
// and never backwards. Pure: the world clock and the zone go in; no clock read.
import { COPY } from "../copy";

export interface BoltTarget {
  id: "evening" | "thursday" | "morning" | "week" | "threeWeeks";
  label: string;
  toMs: number;
}

/** How many targets the bolt offers. A ruling: one named constant. */
export const BOLT_TARGETS_MAX = 4;

const DAY_MS = 86_400_000;
const THURSDAY = 4;

interface Civil {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function safeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

function civilAt(ms: number, zone: string): Civil {
  let f = formatters.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    formatters.set(zone, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const y = get("year");
  const m = get("month");
  const d = get("day");
  return { y, m, d, hh: get("hour") % 24, mm: get("minute"), weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** The UTC instant of a local wall time in `zone`. */
export function localInstant(y: number, m: number, d: number, hh: number, mm: number, zone: string): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (ms: number) => {
    const c = civilAt(ms, zone);
    return Date.UTC(c.y, c.m - 1, c.d, c.hh, c.mm) - Math.floor(ms / 60_000) * 60_000;
  };
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}

/** The civil day `n` days after `c`'s, at `hh`:00. */
function dayAt(c: Civil, n: number, hh: number, zone: string): number {
  const day = new Date(Date.UTC(c.y, c.m - 1, c.d + n));
  return localInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, 0, zone);
}

/** "Today", "Tomorrow" or the weekday, for the day of `ms` seen from the world clock's day. */
function dayWord(world: Civil, ms: number, zone: string): string {
  const c = civilAt(ms, zone);
  const diff = Math.round((Date.UTC(c.y, c.m - 1, c.d) - Date.UTC(world.y, world.m - 1, world.d)) / DAY_MS);
  if (diff === 0) return COPY.visit.bolt.today;
  if (diff === 1) return COPY.visit.bolt.tomorrow;
  return COPY.visit.bolt.weekdays[c.weekday]!;
}

/** The first `hh`:00 on the world's day or later (on `weekday`, when given) that is strictly after `worldMs`. */
function nextAt(world: Civil, worldMs: number, hh: number, zone: string, weekday: number | null): number {
  for (let n = 0; n < 15; n++) {
    const t = dayAt(world, n, hh, zone);
    const wd = new Date(Date.UTC(world.y, world.m - 1, world.d + n)).getUTCDay();
    if (t > worldMs && (weekday === null || wd === weekday)) return t;
  }
  return Number.NaN;
}

/**
 * The bolt's targets after `worldMs` in `zone`: the next 6 PM, the next Thursday at 6 PM, tomorrow at 9 AM, a week
 * on and three weeks on. Each is strictly after the world clock; they come sorted, one per instant, at most
 * BOLT_TARGETS_MAX, with "Three weeks on" always kept last (the demo's comparison beat, spec §15).
 */
export function boltTargets(worldMs: number, zone: string): BoltTarget[] {
  if (!Number.isFinite(worldMs)) return [];
  const z = safeZone(zone);
  const world = civilAt(worldMs, z);
  const evening = nextAt(world, worldMs, 18, z, null);
  const thursday = nextAt(world, worldMs, 18, z, THURSDAY);
  const morning = dayAt(world, 1, 9, z);
  const all: BoltTarget[] = [
    { id: "evening", label: `${dayWord(world, evening, z)}, ${COPY.visit.bolt.evening}`, toMs: evening },
    { id: "thursday", label: `${dayWord(world, thursday, z)}, ${COPY.visit.bolt.evening}`, toMs: thursday },
    { id: "morning", label: `${COPY.visit.bolt.tomorrow}, ${COPY.visit.bolt.morning}`, toMs: morning },
    { id: "week", label: COPY.visit.bolt.weekOn, toMs: worldMs + 7 * DAY_MS },
    { id: "threeWeeks", label: COPY.visit.bolt.threeWeeksOn, toMs: worldMs + 21 * DAY_MS },
  ];
  const seen = new Set<number>();
  const forward = all
    .filter((t) => Number.isFinite(t.toMs) && t.toMs > worldMs)
    .sort((a, b) => a.toMs - b.toMs)
    .filter((t) => {
      if (seen.has(t.toMs)) return false;
      seen.add(t.toMs);
      return true;
    });
  const last = forward.find((t) => t.id === "threeWeeks");
  const head = forward.filter((t) => t.id !== "threeWeeks").slice(0, BOLT_TARGETS_MAX - (last === undefined ? 0 : 1));
  return last === undefined ? head : [...head, last];
}
