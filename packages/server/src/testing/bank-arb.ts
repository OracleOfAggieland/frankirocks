/** Brief 046: generators for bank pulls, and a view of what a pull leaves in the store. */
import { type Connector, canonicalJSON } from "@franki/core";
import fc from "fast-check";
import type { PlaidTransaction, SyncPage } from "../bank/plaid";
import { UPDATE_STATUSES } from "../bank/plaid";
import { listTenantRows } from "../seed/clear";
import type { StorePort } from "../store/port";
import { account, txn } from "./fake-bank";
import { OWNER } from "./bank-rig";

export const POOL = ["t1", "t2", "t3", "t4", "t5", "t6"] as const;

/** A whole number of cents as Plaid's JSON carries it: a decimal with at most two places. */
export const amountOf = (cents: number) =>
  Number(`${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`);

export const arbTxn: fc.Arbitrary<PlaidTransaction> = fc
  .record({
    id: fc.constantFrom(...POOL),
    cents: fc.integer({ min: -50_000, max: 50_000 }),
    pending: fc.boolean(),
    pendingOf: fc.option(fc.constantFrom(...POOL), { nil: null }),
    currency: fc.constantFrom<string | null>("USD", "USD", "USD", "CAD", null),
    authorized: fc.boolean(),
    // Part C follow-up 1: codes the money read must tell apart, and a malformed one that stores nothing.
    category: fc.constantFrom<string | null>(
      "FOOD_AND_DRINK_FAST_FOOD",
      "FOOD_AND_DRINK_GROCERIES",
      "FOOD_AND_DRINK_RESTAURANT",
      "GENERAL_MERCHANDISE_OTHER",
      "TRANSFER_IN_ACCOUNT_TRANSFER",
      "TRANSFER_OUT_SAVINGS",
      "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      "INCOME_SALARY",
      "not a code",
      null,
    ),
    merchant: fc.constantFrom<string | null>("Corner Cafe", "Burger Barn", "AMZN Mktp US*2K4", null),
    day: fc.integer({ min: 1, max: 28 }),
    account: fc.constantFrom("acc-1", "acc-2"),
  })
  .map((r) => {
    const date = `2026-10-${String(r.day).padStart(2, "0")}`;
    return txn(r.id, {
      amount: amountOf(r.cents),
      pending: r.pending,
      pending_transaction_id: r.pending ? null : r.pendingOf,
      iso_currency_code: r.currency,
      date,
      authorized_date: date,
      authorized_datetime: r.authorized ? `${date}T18:30:00Z` : null,
      personal_finance_category: r.category === null ? null : { detailed: r.category },
      merchant_name: r.merchant,
      account_id: r.account,
    });
  });

/** One pull: one to three pages, `has_more` on all but the last. */
export const arbPull = (label: string): fc.Arbitrary<SyncPage[]> =>
  fc
    .record({
      pages: fc.array(
        fc.record({
          added: fc.array(arbTxn, { maxLength: 4 }),
          modified: fc.array(arbTxn, { maxLength: 2 }),
          removed: fc.array(fc.constantFrom(...POOL), { maxLength: 2 }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
      status: fc.constantFrom(...UPDATE_STATUSES),
    })
    .map(({ pages, status }) =>
      pages.map((p, i) => ({
        added: p.added,
        modified: p.modified,
        removed: p.removed.map((transaction_id) => ({ transaction_id })),
        accounts: [account(i % 2 === 0 ? "acc-1" : "acc-2", i % 2 === 0 ? "0000" : "1111")],
        nextCursor: `${label}-${i}`,
        hasMore: i < pages.length - 1,
        updateStatus: status,
      })),
    );

/** Every Evidence row as stored (path to canonical JSON, revs included). */
export async function evidenceState(store: StorePort): Promise<Map<string, string>> {
  const rows = await listTenantRows(store, OWNER);
  return new Map(rows.filter((r) => r.path.includes("/evidence/")).map((r) => [r.path, canonicalJSON(r.data)]));
}

/** The parts of a connector a pull publishes (the sealed token only as present or not: each seal has a fresh IV). */
export const published = (c: Connector | null) =>
  c === null
    ? null
    : canonicalJSON({
        cursor: c.cursor,
        coverage: c.coverage,
        state: c.state,
        bank: c.bank === null ? null : { ...c.bank, token: c.bank.token !== null },
        lastSuccessAt: c.lastSuccessAt,
        lastError: c.lastError,
      });
