/**
 * Which bank rows count as spending in a window (contracts Money, design note 022 §1 step 3 and 4). Pure. Shared by
 * the detector and the loop, so both windows of a comparison are counted the same way.
 *
 * Bank-anchored: only a posted bank row is an order. A receipt never adds one; an exact receipt only gives a dated
 * bank row its order instant. Purchase time has its own basis: never the posting time and never a mail date.
 */
import type { Cov } from "../schema/primitives";
import { addDays, dayStart, localAt } from "./civil";
import type { BankObs, BankRow, ExcludeReason, ReceiptRow } from "./types";

/** An unknown-time row posted up to this many days after a window makes it partial: it may belong to the window. */
export const POSTING_LAG_DAYS = 5;

export interface CountedOrder {
  id: string;
  rootKey: string;
  date: string;
  /** The local order instant, when the bank or an exact receipt gives one. */
  instant: number | null;
  receipt: ReceiptRow | null;
  /** Net of refunds. */
  cents: number;
  refunds: BankRow[];
}

export interface SpendAsk {
  dates: readonly string[];
  zone: string;
  currency: string;
  categories: readonly BankObs["category"][];
  covered: (date: string) => boolean;
  receipts?: readonly ReceiptRow[];
}

export interface SpendResult {
  orders: CountedOrder[];
  excluded: { id: string; reason: ExcludeReason }[];
  /** True when a row that may belong to the window was left out for time or coverage. */
  partial: boolean;
}

/** True when `cov` spans the whole local day and no missing range touches it. */
export function coversDate(cov: Cov, date: string, zone: string): boolean {
  if (cov.state === "unknown" || cov.from === null || cov.to === null) return false;
  const start = dayStart(date, zone);
  const end = dayStart(addDays(date, 1), zone);
  if (start === null || end === null) return false;
  if (Date.parse(cov.from) > start || Date.parse(cov.to) < end) return false;
  return !cov.missingRanges.some((r) => Date.parse(r.from) < end && Date.parse(r.to) > start);
}

/** The purchase's local date and instant from its own basis, or an exact receipt on its own date; null if unknown. */
export function purchaseTime(row: BankRow, receipts: readonly ReceiptRow[], zone: string): { date: string; instant: number | null; receipt: ReceiptRow | null } | null {
  const at = row.bank.purchaseAt;
  if (at.basis === "providerAuthorized" && at.precision === "instant" && at.instant !== null) {
    const ms = Date.parse(at.instant);
    return { date: localAt(ms, zone).date, instant: ms, receipt: null };
  }
  if (at.civilDate === null) return null;
  const receipt =
    receipts.find((r) => {
      const x = r.receipt;
      if (x.match !== "exact" || x.bankEvidenceId !== row.id || x.orderAt === null) return false;
      if (x.amountCents !== null && x.amountCents !== row.bank.amountCents) return false;
      if (x.currency !== null && x.currency !== row.bank.currency) return false;
      return localAt(Date.parse(x.orderAt), zone).date === at.civilDate;
    }) ?? null;
  if (receipt !== null) return { date: at.civilDate, instant: Date.parse(receipt.receipt.orderAt!), receipt };
  if (at.basis === "providerDate" && at.precision === "day") return { date: at.civilDate, instant: null, receipt: null };
  return null;
}

const byId = (a: BankRow, b: BankRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function spendRows(rows: readonly BankRow[], ask: SpendAsk): SpendResult {
  const excluded: SpendResult["excluded"] = [];
  const dates = new Set(ask.dates);
  const lastDate = ask.dates[ask.dates.length - 1] ?? "";
  const lagEnd = lastDate === "" ? "" : addDays(lastDate, POSTING_LAG_DAYS);
  const categories = new Set(ask.categories);
  const refunds = new Map<string, BankRow[]>();
  const originals: BankRow[] = [];
  let partial = false;

  for (const row of [...rows].sort(byId)) {
    const b = row.bank;
    const reason: ExcludeReason | null = b.pending
      ? "pending"
      : b.removed
        ? "removed"
        : b.postedAt === null
          ? "unposted"
          : !categories.has(b.category)
            ? "category"
            : b.currency !== ask.currency
              ? "currency"
              : null;
    if (reason !== null) {
      excluded.push({ id: row.id, reason });
      continue;
    }
    if (b.refundOfId !== null) {
      if (b.amountCents >= 0) excluded.push({ id: row.id, reason: "amount" });
      else refunds.set(b.refundOfId, [...(refunds.get(b.refundOfId) ?? []), row]);
      continue;
    }
    if (b.amountCents <= 0) {
      excluded.push({ id: row.id, reason: "amount" });
      continue;
    }
    originals.push(row);
  }

  const seen = new Set<string>();
  const orders: CountedOrder[] = [];
  for (const row of originals) {
    if (seen.has(row.bank.providerKey)) {
      excluded.push({ id: row.id, reason: "duplicate" });
      continue;
    }
    seen.add(row.bank.providerKey);
    const t = purchaseTime(row, ask.receipts ?? [], ask.zone);
    if (t === null) {
      excluded.push({ id: row.id, reason: "timeUnknown" });
      const posted = localAt(Date.parse(row.bank.postedAt!), ask.zone).date;
      if (lastDate !== "" && posted >= ask.dates[0]! && posted <= lagEnd) partial = true;
      continue;
    }
    if (!dates.has(t.date)) {
      excluded.push({ id: row.id, reason: "outsideWindow" });
      continue;
    }
    if (!ask.covered(t.date)) {
      excluded.push({ id: row.id, reason: "uncovered" });
      partial = true;
      continue;
    }
    const own = refunds.get(row.id) ?? [];
    const cents = own.reduce((a, r) => a + r.bank.amountCents, row.bank.amountCents);
    if (cents <= 0) {
      excluded.push({ id: row.id, reason: "netZero" });
      continue;
    }
    orders.push({ id: row.id, rootKey: row.rootKey, date: t.date, instant: t.instant, receipt: t.receipt, cents, refunds: own });
  }
  const counted = new Set(orders.map((o) => o.id));
  for (const [of, list] of refunds) {
    if (!counted.has(of)) for (const r of list) excluded.push({ id: r.id, reason: "refundOrphan" });
  }
  return { orders, excluded, partial };
}
