// Feature: review of the hero and food (brief 037), Property 3: the detector against a reference.
// A small, plain reference in the test folder (patterns/testing/money-reference.ts) computes the orders, the totals
// and the late nights from the raw rows. For generated rows that include pending rows with their posted rows,
// pending and posted refunds, unlinked negative rows and duplicates (and meetings, some held twice under one
// provider key), the detector's cited set, counts, cents and status equal the reference's.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { takeoutLateMeetingV1 } from "./takeout";
import { REF_COVERAGE, REF_FROM, REF_TO, REF_ZONE, buildRefMeetings, buildRefRows, meetingSpecArb, referenceMoney, rowSpecArb } from "./testing/money-reference";

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("Property 3: the detector against a reference", () => {
  it("cited set, counts, cents and status equal the reference's", () => {
    fc.assert(
      fc.property(fc.array(rowSpecArb, { minLength: 0, maxLength: 24 }), fc.array(meetingSpecArb, { maxLength: 12 }), (rowSpecs, meetingSpecs) => {
        const purchases = buildRefRows(rowSpecs);
        const events = buildRefMeetings(meetingSpecs);
        const ref = referenceMoney(purchases, events);
        const p = takeoutLateMeetingV1({
          purchases,
          receipts: [],
          events,
          bankCoverage: REF_COVERAGE,
          calendarCoverage: REF_COVERAGE,
          window: { fromCivil: REF_FROM, toCivil: REF_TO, zone: REF_ZONE, currency: "USD" },
        });
        expect(p.orderCount).toBe(ref.orders.length);
        expect(p.totalCents).toBe(ref.totalCents);
        expect(p.lateOrderCount).toBe(ref.lateIds.length);
        expect(p.lateCents).toBe(ref.lateCents);
        expect(sorted(p.window.purchaseIds)).toEqual(sorted(ref.cited));
        expect(sorted(p.latePurchaseIds)).toEqual(sorted(ref.lateIds));
        expect(sorted(p.meetingIds)).toEqual(ref.meetingIds);
        expect(p.associationUnit).toBe(ref.nights ? "night" : "day");
        const want = ref.orders.length < 6 || ref.totalCents <= 0 ? "insufficient" : ref.partial ? "partial" : "eligible";
        expect(p.status).toBe(want);
      }),
      { numRuns: 1000 },
    );
  });
});
