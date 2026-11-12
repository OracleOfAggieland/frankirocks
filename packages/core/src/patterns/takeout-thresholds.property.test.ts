// Feature: hero loop and food (brief 022), Property P2: the detector's thresholds hold (spec §10 line 305, contracts
// Money). For any rows, coverage and window:
//   - a window that isn't 21 dates, fewer than 14 covered dates (bank and calendar both, whole local days), or fewer
//     than 6 countable orders (posted, takeout, the window's currency, a reliable purchase date on a covered window
//     date, one per provider key) gives `insufficient`, and no offer line;
//   - "mostly" only with a majority of both count and cents, on an `eligible` result; an offer line only then;
//   - "nights" only with an evening local purchase instant (18:00 to midnight) on every late order, from the bank's
//     own authorized instant or an exact receipt on the same date, never a posting time;
//   - a late order is exactly an order on a date with an accepted, confirmed, busy, timed meeting starting at or
//     after 18:00, and every cited meeting is one.
// The oracle reads local time through Intl directly (testing/arb-patterns.ts).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { takeoutLateMeetingV1 } from "./takeout";
import { oracleLocal, patternCaseArb } from "./testing/arb-patterns";
import type { BankRow, MeetingRow, PatternInput } from "./types";
import { heroOfferLine } from "./words";

const EVENING = (m: number) => m >= 18 * 60 && m < 24 * 60;

function qualifies(e: MeetingRow, zone: string): boolean {
  const c = e.calendar;
  return c.status === "confirmed" && c.selfResponse === "accepted" && !c.allDay && c.transparency === "opaque" && EVENING(oracleLocal(Date.parse(c.start), zone).minute);
}

/** The reliable local date and, when known, evening-ness of a bank row's purchase. */
function purchaseTime(p: BankRow, input: PatternInput): { date: string; instant: number | null } | null {
  const zone = input.window.zone;
  const at = p.bank.purchaseAt;
  if (at.basis === "providerAuthorized" && at.precision === "instant" && at.instant !== null) {
    const ms = Date.parse(at.instant);
    return { date: oracleLocal(ms, zone).date, instant: ms };
  }
  const r = input.receipts.find((x) => x.receipt.match === "exact" && x.receipt.bankEvidenceId === p.id && x.receipt.orderAt !== null);
  if (r !== undefined && at.civilDate !== null && oracleLocal(Date.parse(r.receipt.orderAt!), zone).date === at.civilDate) {
    return { date: at.civilDate, instant: Date.parse(r.receipt.orderAt!) };
  }
  if (at.basis === "providerDate" && at.precision === "day" && at.civilDate !== null) return { date: at.civilDate, instant: null };
  return null;
}

describe("Property P2: the detector's thresholds hold", () => {
  it("coverage, order count, mostly, nights and late meetings", () => {
    fc.assert(
      fc.property(patternCaseArb, ({ input, uncovered, windowDates }) => {
        const out = takeoutLateMeetingV1(input);
        const zone = input.window.zone;
        const line = heroOfferLine(out);
        const inWindow = new Set(windowDates);
        const covered = windowDates.filter((d) => !uncovered.has(d));
        const keys = new Set<string>();
        for (const p of input.purchases) {
          const b = p.bank;
          if (b.refundOfId !== null || b.category !== "takeout" || b.pending || b.removed || b.postedAt === null || b.currency !== "USD" || b.amountCents <= 0) continue;
          const t = purchaseTime(p, input);
          if (t === null || !inWindow.has(t.date) || uncovered.has(t.date)) continue;
          keys.add(b.providerKey);
        }
        if (windowDates.length !== 21 || covered.length < 14 || keys.size < 6) {
          expect(out.status).toBe("insufficient");
          expect(out.mostly).toBe(false);
          expect(line).toBeNull();
          return;
        }
        if (out.status === "insufficient") {
          expect(line).toBeNull();
          return;
        }
        expect(out.coveredDates).toBe(covered.length);
        expect(out.orderCount).toBeGreaterThanOrEqual(6);
        expect(out.orderCount).toBeLessThanOrEqual(keys.size);
        const majority = out.lateOrderCount * 2 > out.orderCount && out.lateCents * 2 > out.totalCents;
        if (out.mostly) {
          expect(majority).toBe(true);
          expect(out.status).toBe("eligible");
        }
        if (out.status === "eligible") expect(out.mostly).toBe(majority);
        if (line !== null) expect(out.status === "eligible" && out.mostly).toBe(true);

        const bank = new Map(input.purchases.map((p) => [p.id, p]));
        const lateDates = new Set(input.events.filter((e) => qualifies(e, zone)).map((e) => oracleLocal(Date.parse(e.calendar.start), zone).date));
        const late = new Set(out.latePurchaseIds);
        for (const id of out.window.purchaseIds) {
          const p = bank.get(id)!;
          if (p.bank.refundOfId !== null) continue;
          const t = purchaseTime(p, input);
          expect(t, `counted ${id} has no reliable purchase date`).not.toBeNull();
          expect(late.has(id), `order ${id} on ${t!.date}`).toBe(lateDates.has(t!.date));
          if (out.associationUnit === "night" && late.has(id)) {
            expect(t!.instant, `night claimed but ${id} has no instant`).not.toBeNull();
            expect(EVENING(oracleLocal(t!.instant!, zone).minute)).toBe(true);
          }
        }
        for (const id of out.meetingIds) expect(qualifies(input.events.find((e) => e.id === id)!, zone)).toBe(true);
        if (line !== null) expect(line.includes("nights")).toBe(out.associationUnit === "night");
      }),
      { numRuns: 1000 },
    );
  });
});
