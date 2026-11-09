// Time_Badge text (lab-ui-foundation R16.8). Pure: formats the supplied instant in the supplied zone;
// never reads the clock.

function parts(instantMs: number, zone: string): Intl.DateTimeFormatPart[] {
  const options: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone }).formatToParts(new Date(instantMs));
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).formatToParts(new Date(instantMs));
  }
}

/** "Thu 6:00 PM" for an instant in a zone. */
export function badgeTime(instantMs: number, zone: string): string {
  const p = parts(instantMs, zone);
  const get = (type: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === type)?.value ?? "";
  return `${get("weekday")} ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}
