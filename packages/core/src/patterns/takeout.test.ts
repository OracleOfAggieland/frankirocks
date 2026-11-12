import { describe, expect, it } from "vitest";
import { testId } from "../testing/samples";
import { takeoutLateMeetingV1 } from "./takeout";
import { HERO_MEETINGS, HERO_ORDERS, bankRow, heroInput } from "./testing/hero-fixture";
import type { ReceiptRow } from "./types";
import { formatDollars, hasCausalWord, heroOfferLine, spanWords } from "./words";

describe("takeout_late_meeting_v1 on the hero fixture", () => {
  it("$30, $28, $34, $34, $24, $36 gives $186, four of six on late-meeting nights, $126", () => {
    const p = takeoutLateMeetingV1(heroInput());
    expect(p).toMatchObject({ associationOnly: true, status: "eligible", associationUnit: "night", totalCents: 18600, orderCount: 6, lateCents: 12600, lateOrderCount: 4, mostly: true, coveredDates: 21 });
    expect(p.latePurchaseIds).toEqual(HERO_ORDERS.slice(0, 4).map((o) => o.id));
    expect(p.meetingIds).toEqual(HERO_MEETINGS.slice(0, 4).map((m) => m.id).sort());
    expect(p.window.purchaseIds).toEqual(HERO_ORDERS.map((o) => o.id));
    expect(p.window.weekdayCounts).toEqual([3, 3, 3, 3, 3, 3, 3]);
    // Groceries are another category; they're excluded, not counted.
    expect(p.excluded.map((e) => e.reason)).toEqual(["category", "category"]);
  });

  it("words the offer from the numbers, with no causal word", () => {
    const line = heroOfferLine(takeoutLateMeetingV1(heroInput()));
    expect(line).toBe("You've spent $186 on takeout in this window, mostly on nights with meetings after 6. Sources are on the card. Want three quick dinners for those nights, with groceries on your list?");
    expect(hasCausalWord(line!)).toBe(false);
  });

  it("a date-only order on a late-meeting date gives days, not nights", () => {
    const orders = [...HERO_ORDERS.slice(1), bankRow("o1d", "2026-10-06", null, 3000)];
    const p = takeoutLateMeetingV1(heroInput({ purchases: orders }));
    expect(p.associationUnit).toBe("day");
    expect(heroOfferLine(p)).toContain("mostly on days with meetings after 6");
  });

  it("an exact receipt on the same date gives a date-only order its evening instant", () => {
    const dated = bankRow("o1d", "2026-10-06", null, 3000);
    const receipt: ReceiptRow = {
      id: testId("hrc1"),
      rootKey: testId("hrcrk1"),
      receipt: { kind: "receipt", orderKey: null, bankEvidenceId: dated.id, amountCents: 3000, currency: "USD", orderAt: "2026-10-07T00:30:00.000Z", merchantKey: null, match: "exact" },
    };
    const p = takeoutLateMeetingV1(heroInput({ purchases: [...HERO_ORDERS.slice(1), dated], receipts: [receipt] }));
    expect(p.associationUnit).toBe("night");
    expect(p.receiptIds).toEqual([receipt.id]);
    expect(p.rootKeys).toContain(receipt.rootKey);
  });

  it("a receipt never adds an order", () => {
    const receipt: ReceiptRow = {
      id: testId("hrc2"),
      rootKey: testId("hrcrk2"),
      receipt: { kind: "receipt", orderKey: null, bankEvidenceId: null, amountCents: 9900, currency: "USD", orderAt: "2026-10-07T00:30:00.000Z", merchantKey: null, match: "none" },
    };
    expect(takeoutLateMeetingV1(heroInput({ receipts: [receipt] })).totalCents).toBe(18600);
  });

  it("five orders are not enough", () => {
    const p = takeoutLateMeetingV1(heroInput({ purchases: HERO_ORDERS.slice(0, 5) }));
    expect(p.status).toBe("insufficient");
    expect(heroOfferLine(p)).toBeNull();
  });

  it("a posting date never stands in for a purchase time", () => {
    const unknown = { ...HERO_ORDERS[0]!, bank: { ...HERO_ORDERS[0]!.bank, purchaseAt: { instant: null, civilDate: null, zone: null, basis: "unknown" as const, precision: "unknown" as const } } };
    const p = takeoutLateMeetingV1(heroInput({ purchases: [unknown, ...HERO_ORDERS.slice(1), bankRow("o7", "2026-10-23", 19 * 60, 1000)] }));
    expect(p.status).toBe("partial");
    expect(p.mostly).toBe(false);
    expect(p.excluded).toContainEqual({ id: unknown.id, reason: "timeUnknown" });
    expect(heroOfferLine(p)).toBeNull();
  });

  it("a pending purchase on a window date makes the result partial; one its posted row replaces doesn't", () => {
    const pending = { ...bankRow("p1", "2026-10-24", 19 * 60, 5000), bank: { ...bankRow("p1", "2026-10-24", 19 * 60, 5000).bank, pending: true, postedAt: null } };
    expect(takeoutLateMeetingV1(heroInput({ purchases: [...HERO_ORDERS, pending] })).status).toBe("partial");
    const posted = { ...HERO_ORDERS[5]!, bank: { ...HERO_ORDERS[5]!.bank, pendingOfId: pending.id } };
    expect(takeoutLateMeetingV1(heroInput({ purchases: [...HERO_ORDERS.slice(0, 5), posted, pending] })).status).toBe("eligible");
  });

  it("a refund nets whatever its category, once per provider key", () => {
    const refund = (label: string) => ({ ...bankRow(label, "2026-10-23", 12 * 60, -1000, "other"), bank: { ...bankRow(label, "2026-10-23", 12 * 60, -1000, "other").bank, refundOfId: HERO_ORDERS[0]!.id, providerKey: testId("hpk_same") } });
    const p = takeoutLateMeetingV1(heroInput({ purchases: [...HERO_ORDERS, refund("r1"), refund("r2")] }));
    expect(p.totalCents).toBe(17600);
    expect(p.lateRefundIds).toHaveLength(1);
  });

  it("a window that isn't 21 dates is insufficient", () => {
    expect(takeoutLateMeetingV1(heroInput({ window: { fromCivil: "2026-10-05", toCivil: "2026-10-24", zone: "America/Chicago", currency: "USD" } })).status).toBe("insufficient");
  });
});

describe("words", () => {
  it("formats money and spans", () => {
    expect(formatDollars(18600)).toBe("$186");
    expect(formatDollars(18650)).toBe("$186.50");
    expect(formatDollars(118600)).toBe("$1,186");
    expect(spanWords(21)).toBe("three weeks");
    expect(spanWords(10)).toBe("10 days");
  });

  it("finds causal words in any case", () => {
    expect(hasCausalWord("Thanks to the dinners")).toBe(true);
    expect(hasCausalWord("You WON BACK an hour")).toBe(true);
    expect(hasCausalWord("Because")).toBe(true);
    expect(hasCausalWord("$115 less on takeout.")).toBe(false);
  });
});
