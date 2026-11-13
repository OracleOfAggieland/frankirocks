// The bank sheet's words for what the server answered (brief 046 part B). Pure: formats the supplied instant in the
// supplied zone; never reads the clock. No amounts or balances are ever formatted here.
import type { BankView } from "@franki/core";
import { COPY } from "../copy";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (f === undefined) {
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true };
    try {
      f = new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone });
    } catch {
      f = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
    }
    formatters.set(zone, f);
  }
  return f;
}

/** "Nov 13, 2:05 PM" for a server TS in a zone, or null for a value that is not a time. */
export function bankTime(ts: string, zone: string): string | null {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const p = formatter(zone).formatToParts(ms);
  const get = (type: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

/** The bank's own name, or a plain stand-in when the server gave none. */
export function bankName(b: BankView): string {
  return b.institutionName ?? COPY.bank.unnamed;
}

/** One line under the bank's name: needs a new sign-in, importing, when it was last read, or not read yet. */
export function bankLine(b: BankView, zone: string): string {
  if (b.needsReconnect) return COPY.bank.needsReconnect;
  if (b.importing) return COPY.bank.importing;
  const when = b.lastSyncedAt === null ? null : bankTime(b.lastSyncedAt, zone);
  return when === null ? COPY.bank.notRead : COPY.bank.lastRead(when);
}
