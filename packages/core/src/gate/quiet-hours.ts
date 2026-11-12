/** Quiet hours, 21:30 to 08:00 in the world zone (spec §5 "Delivery"). Pure: the instant is an argument. */

export const QUIET_START_MINUTE = 21 * 60 + 30;
export const QUIET_END_MINUTE = 8 * 60;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes after local midnight of `ms` in `zone`, or null for a zone Intl does not know. */
export function localMinute(ms: number, zone: string): number | null {
  let f = formatters.get(zone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch {
      return null;
    }
    formatters.set(zone, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return (hour % 24) * 60 + minute;
}

/** True inside quiet hours. An unknown zone counts as quiet (fails quiet). */
export function inQuietHours(ms: number, zone: string): boolean {
  const m = localMinute(ms, zone);
  if (m === null) return true;
  return m >= QUIET_START_MINUTE || m < QUIET_END_MINUTE;
}
