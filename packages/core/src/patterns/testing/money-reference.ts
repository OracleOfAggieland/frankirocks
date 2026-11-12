/**
 * A small, slow, plain reference for the hero detector's money (brief 037, property 3), and a generator of the bank
 * rows that tripped it: pending rows with their posted rows, pending and posted refunds, unlinked negative rows and
 * duplicates. The reference reads the raw rows with nothing from the product but the row types; local times come
 * from Intl (./arb-patterns' oracle helpers).
 *
 * The window is the hero's 21 dates in one zone, with bank and calendar coverage complete, and every purchase has
 * an authorized instant, so the reference needs no receipt or coverage logic.
 */
import fc from "fast-check";
import { testId } from "../../testing/samples";
import type { BankObs, BankRow, MeetingRow } from "../types";
import { coverageFor, instantAt, oracleDates, oracleLocal, plusDays } from "./arb-patterns";

export const REF_ZONE = "America/Chicago";
export const REF_FROM = "2026-10-05";
export const REF_TO = "2026-10-25";
const iso = (ms: number) => new Date(ms).toISOString();

export type RowKind = "order" | "pendingThenPosted" | "lonePending" | "refund" | "pendingRefundThenPosted" | "lonePendingRefund" | "unlinkedNegative" | "duplicate" | "groceries";

export interface RowSpec {
  kind: RowKind;
  offset: number;
  minute: number;
  cents: number;
}

export const rowSpecArb: fc.Arbitrary<RowSpec> = fc.record({
  kind: fc.constantFrom<RowKind>("order", "order", "order", "order", "order", "order", "pendingThenPosted", "lonePending", "refund", "pendingRefundThenPosted", "lonePendingRefund", "unlinkedNegative", "duplicate", "groceries"),
  offset: fc.integer({ min: -3, max: 22 }),
  minute: fc.oneof({ weight: 3, arbitrary: fc.integer({ min: 18 * 60, max: 1439 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 1439 }) }),
  cents: fc.integer({ min: 100, max: 5000 }),
});

export interface MeetingSpec {
  offset: number;
  minute: number;
  copies: number;
}

export const meetingSpecArb: fc.Arbitrary<MeetingSpec> = fc.record({
  offset: fc.integer({ min: 0, max: 20 }),
  minute: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 18 * 60, max: 1439 }) }, { weight: 1, arbitrary: fc.integer({ min: 9 * 60, max: 17 * 60 }) }),
  copies: fc.constantFrom(1, 1, 1, 2),
});

let serial = 0;

function bank(id: string, providerKey: string, cents: number, at: number, category: BankObs["category"], extra: Partial<BankObs> = {}): BankRow {
  return {
    id,
    rootKey: testId(`mrk_${id.slice(1, 14)}`),
    bank: {
      kind: "bank",
      providerKey,
      pending: false,
      removed: false,
      amountCents: cents,
      currency: "USD",
      pendingOfId: null,
      refundOfId: null,
      merchantKey: null,
      category,
      purchaseAt: { instant: iso(at), civilDate: null, zone: REF_ZONE, basis: "providerAuthorized", precision: "instant" },
      postedAt: iso(at + 2 * 86_400_000),
      accountKey: testId("macct"),
      ...extra,
    },
  };
}

/** Bank rows for the specs. A refund or a duplicate attaches to the order built just before it, if there is one. */
export function buildRefRows(specs: readonly RowSpec[]): BankRow[] {
  const rows: BankRow[] = [];
  let last: BankRow | null = null;
  for (const s of specs) {
    const at = instantAt(plusDays(REF_FROM, s.offset), s.minute, REF_ZONE);
    const id = (p: string) => testId(`m${p}${serial++}`);
    const pk = () => testId(`mpk${serial++}`);
    const back = Math.max(1, Math.floor(s.cents / 3));
    switch (s.kind) {
      case "order":
      case "groceries": {
        const r = bank(id("o"), pk(), s.cents, at, s.kind === "order" ? "takeout" : "groceries");
        rows.push(r);
        last = r;
        break;
      }
      case "pendingThenPosted": {
        const p = bank(id("p"), pk(), s.cents, at, "takeout", { pending: true, postedAt: null });
        const q = bank(id("q"), pk(), s.cents, at, "takeout", { pendingOfId: p.id });
        rows.push(p, q);
        last = q;
        break;
      }
      case "lonePending":
        rows.push(bank(id("l"), pk(), s.cents, at, "takeout", { pending: true, postedAt: null }));
        break;
      case "refund":
        if (last !== null) rows.push(bank(id("r"), pk(), -back, Date.parse(last.bank.purchaseAt.instant!) + 86_400_000, "takeout", { refundOfId: last.id }));
        break;
      case "pendingRefundThenPosted":
        if (last !== null) {
          const t = Date.parse(last.bank.purchaseAt.instant!) + 86_400_000;
          const p = bank(id("rp"), pk(), -back, t, "takeout", { refundOfId: last.id, pending: true, postedAt: null });
          rows.push(p, bank(id("rq"), pk(), -back, t, "takeout", { refundOfId: last.id, pendingOfId: p.id }));
        }
        break;
      case "lonePendingRefund":
        if (last !== null) rows.push(bank(id("rl"), pk(), -back, Date.parse(last.bank.purchaseAt.instant!) + 86_400_000, "takeout", { refundOfId: last.id, pending: true, postedAt: null }));
        break;
      case "unlinkedNegative":
        rows.push(bank(id("n"), pk(), -back, at, "takeout", { postedAt: iso(at + 86_400_000) }));
        break;
      case "duplicate":
        if (last !== null) rows.push({ ...last, id: id("d"), rootKey: testId(`mrkd${serial++}`) });
        break;
    }
  }
  return rows;
}

export function buildRefMeetings(specs: readonly MeetingSpec[]): MeetingRow[] {
  return specs.flatMap((s) => {
    const start = instantAt(plusDays(REF_FROM, s.offset), s.minute, REF_ZONE);
    const providerKey = testId(`mek${serial++}`);
    return Array.from({ length: s.copies }, () => {
      const id = testId(`me${serial++}`);
      return {
        id,
        rootKey: testId(`merk${serial++}`),
        calendar: {
          kind: "calendar" as const,
          providerKey,
          calendarKey: testId("mcal"),
          seriesKey: null,
          originalStart: null,
          start: iso(start),
          end: iso(start + 3_600_000),
          zone: REF_ZONE,
          allDay: false,
          status: "confirmed" as const,
          selfResponse: "accepted" as const,
          transparency: "opaque" as const,
          organizerSelf: false,
          creatorSelf: false,
          organizerId: null,
          attendeeIds: [],
          scheduleRev: 0,
        },
      };
    });
  });
}

export const REF_COVERAGE = coverageFor(REF_FROM, REF_TO, REF_ZONE, []);

export interface RefResult {
  /** Counted orders: id and net cents. */
  orders: { id: string; cents: number; date: string; minute: number }[];
  /** Ids cited for the window: each counted order and its netted refunds. */
  cited: string[];
  totalCents: number;
  lateIds: string[];
  lateCents: number;
  /** Meetings cited: on the date of a late order, once per provider key. */
  meetingIds: string[];
  partial: boolean;
  /** True when every late order is in the evening. */
  nights: boolean;
}

/** The plain reading of the rows. */
export function referenceMoney(rows: readonly BankRow[], meetings: readonly MeetingRow[]): RefResult {
  const dates = new Set(oracleDates(REF_FROM, REF_TO));
  const local = (s: string) => oracleLocal(Date.parse(s), REF_ZONE);
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const replaced = new Set(rows.filter((r) => !r.bank.pending && r.bank.pendingOfId !== null).map((r) => r.bank.pendingOfId));
  const takeoutUsd = (r: BankRow) => r.bank.category === "takeout" && r.bank.currency === "USD" && !r.bank.removed;
  const settled = (r: BankRow) => !r.bank.pending && r.bank.postedAt !== null;

  // Refunds that net: settled, negative, linked, first of their provider key.
  const refundKeys = new Set<string>();
  const netting: BankRow[] = [];
  for (const r of sorted) {
    if (r.bank.removed || r.bank.refundOfId === null || r.bank.amountCents >= 0 || !settled(r) || r.bank.currency !== "USD") continue;
    if (refundKeys.has(r.bank.providerKey)) continue;
    refundKeys.add(r.bank.providerKey);
    netting.push(r);
  }

  // Purchases: settled, positive, takeout, first of their provider key; then in the window and net positive.
  const keys = new Set<string>();
  const orders: RefResult["orders"] = [];
  const cited: string[] = [];
  for (const r of sorted) {
    if (!takeoutUsd(r) || r.bank.refundOfId !== null || r.bank.amountCents <= 0 || !settled(r)) continue;
    if (keys.has(r.bank.providerKey)) continue;
    keys.add(r.bank.providerKey);
    const l = local(r.bank.purchaseAt.instant!);
    if (!dates.has(l.date)) continue;
    const own = netting.filter((x) => x.bank.refundOfId === r.id);
    const cents = own.reduce((a, x) => a + x.bank.amountCents, r.bank.amountCents);
    if (cents <= 0) continue;
    orders.push({ id: r.id, cents, date: l.date, minute: l.minute });
    cited.push(r.id, ...own.map((x) => x.id));
  }
  const counted = new Set(orders.map((o) => o.id));

  let partial = false;
  for (const r of rows) {
    if (!takeoutUsd(r)) continue;
    // A purchase not yet settled, that no posted row replaces, dated in the window.
    if (r.bank.refundOfId === null && r.bank.amountCents > 0 && !settled(r) && !replaced.has(r.id) && dates.has(local(r.bank.purchaseAt.instant!).date)) partial = true;
    // A refund of a counted order that can't be netted yet, and that no posted refund replaces.
    if (r.bank.refundOfId !== null && r.bank.amountCents < 0 && !settled(r) && !replaced.has(r.id) && counted.has(r.bank.refundOfId)) partial = true;
    // A negative row with no link, posted on or after the window's first date: it may refund a counted order.
    if (r.bank.refundOfId === null && r.bank.amountCents < 0 && settled(r) && local(r.bank.postedAt!).date >= REF_FROM) partial = true;
  }

  const lateDates = new Set<string>();
  const meetingByKey = new Map<string, string>();
  const evening = (m: MeetingRow) => local(m.calendar.start).minute >= 18 * 60;
  const meetingDates = new Set(meetings.filter(evening).map((m) => local(m.calendar.start).date));
  const late = orders.filter((o) => meetingDates.has(o.date));
  for (const o of late) lateDates.add(o.date);
  for (const m of [...meetings].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!evening(m) || !lateDates.has(local(m.calendar.start).date)) continue;
    if (!meetingByKey.has(m.calendar.providerKey)) meetingByKey.set(m.calendar.providerKey, m.id);
  }
  return {
    orders,
    cited,
    totalCents: orders.reduce((a, o) => a + o.cents, 0),
    lateIds: late.map((o) => o.id),
    lateCents: late.reduce((a, o) => a + o.cents, 0),
    meetingIds: [...meetingByKey.values()].sort(),
    partial,
    nights: late.length > 0 && late.every((o) => o.minute >= 18 * 60),
  };
}
