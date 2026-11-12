/**
 * The hero detector, `takeout_late_meeting_v1` (spec §10 line 305, contracts Money `PatternResult`; design note 022
 * §1). Pure. It finds an association only, never a cause: takeout orders on dates with an evening meeting.
 *
 *   - Bank-anchored posted purchases; receipts enrich and never add (./spend).
 *   - Accepted, confirmed, timed, busy meetings starting at or after 18:00 local.
 *   - A window of 21 dates, at least 14 covered (bank and calendar both), at least 6 orders.
 *   - "Mostly" needs a majority of both count and cents. "Nights" needs an evening local purchase instant on every
 *     late order; otherwise the unit is "days".
 */
import { datesFrom, localAt, weekdayCounts } from "./civil";
import { coversDate, spendRows } from "./spend";
import type { MeetingRow, PatternInput, PatternResult } from "./types";

export const TAKEOUT_LATE_V1 = {
  windowDates: 21,
  minCoveredDates: 14,
  minOrders: 6,
  eveningFromMinute: 18 * 60,
  eveningToMinute: 24 * 60,
  meetingFromMinute: 18 * 60,
  meetingToMinute: 24 * 60,
} as const;

const T = TAKEOUT_LATE_V1;

/** An accepted, confirmed, timed, busy meeting: the only kind that counts. */
export function isLateMeeting(e: MeetingRow, zone: string): boolean {
  const c = e.calendar;
  if (c.status !== "confirmed" || c.selfResponse !== "accepted" || c.allDay || c.transparency !== "opaque") return false;
  const m = localAt(Date.parse(c.start), zone).minute;
  return m >= T.meetingFromMinute && m < T.meetingToMinute;
}

const isEvening = (ms: number, zone: string) => {
  const m = localAt(ms, zone).minute;
  return m >= T.eveningFromMinute && m < T.eveningToMinute;
};

export function takeoutLateMeetingV1(input: PatternInput): PatternResult {
  const w = input.window;
  const dates = datesFrom(w.fromCivil, w.toCivil);
  const covered = (d: string) => coversDate(input.bankCoverage, d, w.zone) && coversDate(input.calendarCoverage, d, w.zone);
  const coveredDates = dates.filter(covered);

  const spend = spendRows(input.purchases, { dates, zone: w.zone, currency: w.currency, categories: ["takeout"], covered, receipts: input.receipts });
  const orders = spend.orders;

  const inWindow = new Set(dates);
  const meetingsOn = new Map<string, string[]>();
  for (const e of input.events) {
    if (!isLateMeeting(e, w.zone)) continue;
    const d = localAt(Date.parse(e.calendar.start), w.zone).date;
    if (inWindow.has(d)) meetingsOn.set(d, [...(meetingsOn.get(d) ?? []), e.id]);
  }
  const late = orders.filter((o) => meetingsOn.has(o.date));

  const totalCents = orders.reduce((a, o) => a + o.cents, 0);
  const lateCents = late.reduce((a, o) => a + o.cents, 0);
  const night = late.length > 0 && late.every((o) => o.instant !== null && isEvening(o.instant, w.zone));

  const insufficient = dates.length !== T.windowDates || coveredDates.length < T.minCoveredDates || orders.length < T.minOrders || totalCents <= 0;
  const status: PatternResult["status"] = insufficient ? "insufficient" : spend.partial ? "partial" : "eligible";
  const majority = late.length * 2 > orders.length && lateCents * 2 > totalCents;

  const lateDates = new Set(late.map((o) => o.date));
  // A meeting held twice under one provider key is one meeting: it is cited once, by its lowest ID (brief 037, 10).
  const providerOf = new Map(input.events.map((e) => [e.id, e.calendar.providerKey]));
  const citedKeys = new Set<string>();
  const meetingIds = [...meetingsOn.entries()]
    .filter(([d]) => lateDates.has(d))
    .flatMap(([, ids]) => ids)
    .sort()
    .filter((id) => {
      const k = providerOf.get(id)!;
      if (citedKeys.has(k)) return false;
      citedKeys.add(k);
      return true;
    });
  const eventKey = new Map(input.events.map((e) => [e.id, e.rootKey]));
  const receiptIds = orders.flatMap((o) => (o.receipt === null ? [] : [o.receipt.id]));
  const rootKeys = [
    ...orders.flatMap((o) => [o.rootKey, ...o.refunds.map((r) => r.rootKey), ...(o.receipt === null ? [] : [o.receipt.rootKey])]),
    ...meetingIds.map((id) => eventKey.get(id)!),
  ];
  const purchaseIds = orders.flatMap((o) => [o.id, ...o.refunds.map((r) => r.id)]);

  return {
    associationOnly: true,
    detectorVersion: "takeout_late_meeting_v1",
    status,
    associationUnit: night ? "night" : "day",
    totalCents,
    orderCount: orders.length,
    lateCents,
    lateOrderCount: late.length,
    mostly: status === "eligible" && majority,
    window: {
      fromCivil: w.fromCivil,
      toCivil: w.toCivil,
      zone: w.zone,
      currency: w.currency,
      coverage: input.bankCoverage,
      purchaseIds: purchaseIds.slice(0, 128),
      valueCents: totalCents,
      weekdayCounts: weekdayCounts(coveredDates),
    },
    coveredDates: coveredDates.length,
    latePurchaseIds: late.map((o) => o.id),
    lateRefundIds: late.flatMap((o) => o.refunds.map((r) => r.id)),
    meetingIds,
    receiptIds,
    rootKeys: [...new Set(rootKeys)].slice(0, 128),
    excluded: spend.excluded.slice(0, 128),
  };
}
