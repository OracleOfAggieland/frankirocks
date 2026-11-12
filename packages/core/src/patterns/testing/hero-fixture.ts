/**
 * The hero fixture (spec §10 line 305): $30, $28, $34, $34, $24, $36 = $186 of takeout over 21 dates in Chicago,
 * four of six on late-meeting nights for $126, each with an evening purchase time; then $71 over the same three
 * weeks after "yes". Pure data for tests and the seed.
 */
import type { Cov } from "../../schema/primitives";
import { testId } from "../../testing/samples";
import type { BankObs, BankRow, CalendarObs, MeetingRow, PatternInput, ReceiptRow } from "../types";
import { coverageFor, instantAt } from "./arb-patterns";

export { instantAt };

export const HERO_ZONE = "America/Chicago";
export const HERO_WINDOW = { fromCivil: "2026-10-05", toCivil: "2026-10-25", zone: HERO_ZONE, currency: "USD" } as const;
/** The world time the owner says "yes": Oct 26 at 19:00 Chicago. */
export const HERO_ACCEPTED_AT = instantAt("2026-10-26", 19 * 60, HERO_ZONE);

const iso = (ms: number) => new Date(ms).toISOString();

export function bankRow(label: string, date: string, minute: number | null, cents: number, category: BankObs["category"] = "takeout"): BankRow {
  const at = minute === null ? null : instantAt(date, minute, HERO_ZONE);
  return {
    id: testId(`hb_${label}`),
    rootKey: testId(`hrk_${label}`),
    bank: {
      kind: "bank",
      providerKey: testId(`hpk_${label}`),
      pending: false,
      removed: false,
      amountCents: cents,
      currency: "USD",
      pendingOfId: null,
      refundOfId: null,
      merchantKey: null,
      category,
      purchaseAt: at === null ? { instant: null, civilDate: date, zone: HERO_ZONE, basis: "providerDate", precision: "day" } : { instant: iso(at), civilDate: null, zone: HERO_ZONE, basis: "providerAuthorized", precision: "instant" },
      postedAt: iso(instantAt(date, 12 * 60, HERO_ZONE) + 2 * 86_400_000),
      accountKey: testId("hacct"),
    },
  };
}

export function meeting(label: string, date: string, minute: number, overrides: Partial<CalendarObs> = {}): MeetingRow {
  const start = instantAt(date, minute, HERO_ZONE);
  return {
    id: testId(`he_${label}`),
    rootKey: testId(`herk_${label}`),
    calendar: {
      kind: "calendar",
      providerKey: testId(`hek_${label}`),
      calendarKey: testId("hcal"),
      seriesKey: null,
      originalStart: null,
      start: iso(start),
      end: iso(start + 3_600_000),
      zone: HERO_ZONE,
      allDay: false,
      status: "confirmed",
      selfResponse: "accepted",
      transparency: "opaque",
      organizerSelf: false,
      creatorSelf: false,
      organizerId: null,
      attendeeIds: [],
      scheduleRev: 0,
      ...overrides,
    },
  };
}

/** Six takeout orders: four on late-meeting nights ($30, $28, $34, $34), two not ($24 at lunch, $36 on a free night). */
export const HERO_ORDERS: BankRow[] = [
  bankRow("o1", "2026-10-06", 19 * 60 + 30, 3000),
  bankRow("o2", "2026-10-08", 20 * 60, 2800),
  bankRow("o3", "2026-10-13", 19 * 60 + 45, 3400),
  bankRow("o4", "2026-10-15", 20 * 60 + 15, 3400),
  bankRow("o5", "2026-10-19", 12 * 60 + 30, 2400),
  bankRow("o6", "2026-10-22", 19 * 60 + 10, 3600),
];

export const HERO_MEETINGS: MeetingRow[] = [
  meeting("m1", "2026-10-06", 18 * 60),
  meeting("m2", "2026-10-08", 18 * 60 + 30),
  meeting("m3", "2026-10-13", 18 * 60),
  meeting("m4", "2026-10-15", 18 * 60 + 30),
  // Not counted: declined, tentative, before 18:00, all-day.
  meeting("m5", "2026-10-22", 18 * 60, { selfResponse: "declined" }),
  meeting("m6", "2026-10-19", 18 * 60, { status: "tentative" }),
  meeting("m7", "2026-10-20", 17 * 60),
  meeting("m8", "2026-10-21", 0, { allDay: true }),
];

/** Groceries in the baseline window, for total food spend. */
export const HERO_BASELINE_GROCERIES: BankRow[] = [bankRow("g1", "2026-10-10", null, 6000, "groceries"), bankRow("g2", "2026-10-17", null, 6000, "groceries")];

/** Three weeks on: $71 of takeout, and more groceries. */
export const HERO_AFTER_ORDERS: BankRow[] = [bankRow("a1", "2026-10-30", 19 * 60, 2500), bankRow("a2", "2026-11-05", 20 * 60, 2200), bankRow("a3", "2026-11-12", 19 * 60 + 30, 2400)];
export const HERO_AFTER_GROCERIES: BankRow[] = [bankRow("ag1", "2026-10-28", null, 8000, "groceries"), bankRow("ag2", "2026-11-08", null, 8000, "groceries")];

export const HERO_COVERAGE: Cov = coverageFor("2026-10-01", "2026-11-30", HERO_ZONE, []);

export function heroInput(overrides: Partial<PatternInput> = {}): PatternInput {
  return {
    purchases: [...HERO_ORDERS, ...HERO_BASELINE_GROCERIES],
    receipts: [] as ReceiptRow[],
    events: HERO_MEETINGS,
    bankCoverage: HERO_COVERAGE,
    calendarCoverage: HERO_COVERAGE,
    window: { ...HERO_WINDOW },
    ...overrides,
  };
}
