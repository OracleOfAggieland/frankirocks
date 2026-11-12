// Feature: hero loop and food (brief 022), Property P1: every number has a source (spec §6 "Code checks every
// number", contracts Money). For any rows, coverage and window, each number in `takeout_late_meeting_v1`'s output
// equals the sum of the rows it cites, to the cent:
//   - every cited ID is an input row of the right kind, cited once;
//   - `totalCents` is the sum of `window.purchaseIds`' amounts and `window.valueCents` equals it;
//   - `orderCount` is the number of originals (rows that refund nothing) in `window.purchaseIds`;
//   - `lateCents` is the sum over `latePurchaseIds` and `lateRefundIds`, and `lateOrderCount` is the count of
//     `latePurchaseIds`, all of them in `window.purchaseIds`;
//   - every refund cited refunds an order cited in the same list;
//   - `rootKeys` holds the root key of every cited row.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { takeoutLateMeetingV1 } from "./takeout";
import { patternCaseArb } from "./testing/arb-patterns";

describe("Property P1: every number in the detector's output has a source", () => {
  it("numbers equal the sums of the rows they cite", () => {
    fc.assert(
      fc.property(patternCaseArb, ({ input }) => {
        const out = takeoutLateMeetingV1(input);
        const bank = new Map(input.purchases.map((p) => [p.id, p]));
        const receipts = new Map(input.receipts.map((r) => [r.id, r]));
        const events = new Map(input.events.map((e) => [e.id, e]));
        const ids = out.window.purchaseIds;
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(bank.has(id), `cited ${id} is not a bank row`).toBe(true);
        const sum = (list: readonly string[]) => list.reduce((a, id) => a + bank.get(id)!.bank.amountCents, 0);
        expect(out.totalCents).toBe(sum(ids));
        expect(out.window.valueCents).toBe(out.totalCents);
        expect(out.orderCount).toBe(ids.filter((id) => bank.get(id)!.bank.refundOfId === null).length);
        const cited = new Set(ids);
        for (const id of [...out.latePurchaseIds, ...out.lateRefundIds]) expect(cited.has(id)).toBe(true);
        for (const id of out.latePurchaseIds) expect(bank.get(id)!.bank.refundOfId).toBeNull();
        expect(out.lateCents).toBe(sum(out.latePurchaseIds) + sum(out.lateRefundIds));
        expect(out.lateOrderCount).toBe(out.latePurchaseIds.length);
        for (const id of ids) {
          const of = bank.get(id)!.bank.refundOfId;
          if (of !== null) expect(cited.has(of), `refund ${id} of an uncited order`).toBe(true);
        }
        const late = new Set(out.latePurchaseIds);
        for (const id of out.lateRefundIds) expect(late.has(bank.get(id)!.bank.refundOfId!)).toBe(true);
        for (const id of out.receiptIds) expect(receipts.has(id)).toBe(true);
        for (const id of out.meetingIds) expect(events.has(id)).toBe(true);
        const keys = new Set(out.rootKeys);
        for (const id of ids) expect(keys.has(bank.get(id)!.rootKey)).toBe(true);
        for (const id of out.receiptIds) expect(keys.has(receipts.get(id)!.rootKey)).toBe(true);
        for (const id of out.meetingIds) expect(keys.has(events.get(id)!.rootKey)).toBe(true);
        expect(out.associationOnly).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});
