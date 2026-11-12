// The reviewer's inputs for brief 037's money findings, one block per finding.
import { describe, expect, it } from "vitest";
import { testId } from "../testing/samples";
import { takeoutLateMeetingV1 } from "./takeout";
import { HERO_MEETINGS, HERO_ORDERS, HERO_ZONE, bankRow, heroInput, instantAt } from "./testing/hero-fixture";
import type { BankRow } from "./types";

const iso = (ms: number) => new Date(ms).toISOString();
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

describe("finding 8: an unlinked refund", () => {
  it("a negative takeout row with no link, posted in the window, makes the result partial", () => {
    const loose = bankRow("loose", "2026-10-19", 13 * 60, -3000);
    const p = takeoutLateMeetingV1(heroInput({ purchases: [...HERO_ORDERS, loose] }));
    expect(p.status).toBe("partial");
    expect(p.mostly).toBe(false);
  });

  it("one posted before the window starts can't refund a window order, and changes nothing", () => {
    const early = bankRow("early", "2026-09-28", 13 * 60, -3000);
    const before = { ...early, bank: { ...early.bank, postedAt: iso(instantAt("2026-10-01", 12 * 60, HERO_ZONE)) } };
    expect(takeoutLateMeetingV1(heroInput({ purchases: [...HERO_ORDERS, before] })).status).toBe("eligible");
  });

  it("a negative row in another category changes nothing", () => {
    const grocery = bankRow("gref", "2026-10-19", 13 * 60, -3000, "groceries");
    expect(takeoutLateMeetingV1(heroInput({ purchases: [...HERO_ORDERS, grocery] })).status).toBe("eligible");
  });
});

describe("finding 10: a meeting held twice is cited once", () => {
  it("two rows under one provider key give one cited meeting", () => {
    const m1 = HERO_MEETINGS[0]!;
    const copy = { ...m1, id: testId("he_m1copy"), rootKey: testId("herk_m1copy") };
    const p = takeoutLateMeetingV1(heroInput({ events: [...HERO_MEETINGS, copy] }));
    expect(p.meetingIds).toHaveLength(4);
    expect(p.meetingIds).toContain([m1.id, copy.id].sort()[0]);
  });
});
