// The reviewer's inputs for brief 037's money findings, one block per finding.
import { describe, expect, it } from "vitest";
import { takeoutLateMeetingV1 } from "./takeout";
import { HERO_ORDERS, bankRow, heroInput } from "./testing/hero-fixture";
import type { BankRow } from "./types";

const o1 = HERO_ORDERS[0]!;

function refund(label: string, cents: number, extra: Partial<BankRow["bank"]> = {}): BankRow {
  const r = bankRow(label, "2026-10-07", 12 * 60, -cents);
  return { ...r, bank: { ...r.bank, refundOfId: o1.id, ...extra } };
}

describe("finding 7: a pending refund that later posts", () => {
  it("nets once and leaves the result eligible", () => {
    const pending = refund("rp", 500, { pending: true, postedAt: null });
    const posted = refund("rq", 500, { pendingOfId: pending.id });
    const p = takeoutLateMeetingV1(heroInput({ purchases: [...HERO_ORDERS, pending, posted] }));
    expect(p.status).toBe("eligible");
    expect(p.totalCents).toBe(18100);
    expect(p.window.purchaseIds).toContain(posted.id);
    expect(p.window.purchaseIds).not.toContain(pending.id);
  });

  it("a pending refund nothing replaces still makes it partial", () => {
    const pending = refund("rp2", 500, { pending: true, postedAt: null });
    expect(takeoutLateMeetingV1(heroInput({ purchases: [...HERO_ORDERS, pending] })).status).toBe("partial");
  });
});

