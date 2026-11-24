/**
 * The simulated bank (brief 054, R8): a whole `BankPort` that answers from a demo fixture's own bank lines, so the
 * real pull, import and `read_money` run unchanged above it. It reads the simulator token for the fixture, the world
 * start and the zone, and nothing else: no network, no environment, no clock. The `config` argument is ignored.
 *
 * Every row is dated as `seed/build.ts`'s `buildBank` dates it: purchased at the line's instant, posted at 06:00 the
 * next local day (a pending row is not posted yet). So `bankRowContent` stores the same cents, purchase instant,
 * civil date and posting instant as the seeded row the hero reads (R12). No balance is offered (R8.8).
 */
import type { BankConfig } from "../bank/config";
import { BankCallError, type BankPort, type PlaidAccount, type PlaidTransaction, type SyncPage } from "../bank/plaid";
import { localDate } from "../seed/clock";
import { type BankLine, type DemoAccount, type SeedFixture, bankCodeOf } from "../seed/fixture";
import { type SimLayout, layoutOf } from "./layout";
import { readSimToken } from "./token";

/** Transactions per sync page. Smaller than Plaid's 500, so a real persona pages and the pull's paging is exercised. */
export const SIM_SYNC_PAGE = 100;
const CURSOR = /^sim:(\d{1,6})$/;
const POSTED_MINUTE = 6 * 60;

/** `cents / 100`; `centsOf(simAmount(c)) === c` for every integer |c| <= BANK_CENTS_MAX (property 1). */
export const simAmount = (cents: number): number => cents / 100;

const refuse = (): never => {
  throw new BankCallError(null, true);
};

const toPlaidAccount = (a: DemoAccount): PlaidAccount => ({ account_id: a.accountId, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype });

const iso = (ms: number) => new Date(ms).toISOString();

function transactionOf(l: BankLine, layout: SimLayout): PlaidTransaction & { purchaseMs: number } {
  const purchaseMs = layout.at(l.at);
  const pending = l.pending === true;
  const postedMs = layout.at({ day: l.at.day + 1, minute: POSTED_MINUTE });
  const code = bankCodeOf(l);
  return {
    purchaseMs,
    transaction_id: l.id,
    account_id: l.account ?? layout.demo.bank.accounts[0]!.accountId,
    // Plaid's sign, which is also the fixture's: a purchase positive, a refund or deposit negative.
    amount: simAmount(l.amountCents),
    iso_currency_code: "USD",
    authorized_datetime: iso(purchaseMs),
    authorized_date: localDate(purchaseMs, layout.zone),
    // A pending row carries its purchase date and no posting time yet, as Plaid answers one.
    date: pending ? localDate(purchaseMs, layout.zone) : localDate(postedMs, layout.zone),
    datetime: pending ? null : iso(postedMs),
    pending,
    pending_transaction_id: null,
    merchant_name: l.merchant,
    name: l.merchant,
    personal_finance_category: code === null ? null : { detailed: code },
  };
}

/** Every bank line as the provider's transaction, in (purchase instant, line ID) order. */
export function simTransactions(layout: SimLayout): PlaidTransaction[] {
  return layout.fixture.lines
    .filter((l): l is BankLine => l.kind === "bank")
    .map((l) => transactionOf(l, layout))
    .sort((a, b) => a.purchaseMs - b.purchaseMs || (a.transaction_id < b.transaction_id ? -1 : a.transaction_id > b.transaction_id ? 1 : 0))
    .map(({ purchaseMs: _, ...t }) => t);
}

/** The layout a bank token names, or a definite refusal: not a simulator token, not a bank one, or no such fixture. */
function bankLayout(token: string, fixtures: ReadonlyMap<string, SeedFixture> | undefined): SimLayout {
  const t = readSimToken(token);
  if (t === null || t === "malformed" || t.kind !== "bank") return refuse();
  return layoutOf(t, fixtures) ?? refuse();
}

/** The simulated bank over `fixtures` (all registered fixtures by default). */
export function simulatedBank(fixtures?: ReadonlyMap<string, SeedFixture>): BankPort {
  return {
    // A demo visit never reaches these (R14.3): the routes refuse it first. Refuse anyway.
    async linkToken(_config: BankConfig, _clientUserId: string) {
      return refuse();
    },
    async exchange(_config: BankConfig, _publicToken: string) {
      return refuse();
    },
    async accounts(_config, accessToken) {
      const { demo } = bankLayout(accessToken, fixtures);
      return { itemId: demo.bank.itemId, institutionId: demo.bank.institutionId, institutionName: demo.bank.institutionName, accounts: demo.bank.accounts.map(toPlaidAccount) };
    },
    async sync(_config, accessToken, cursor): Promise<SyncPage> {
      const layout = bankLayout(accessToken, fixtures);
      const all = simTransactions(layout);
      let from = 0;
      if (cursor !== null) {
        const m = CURSOR.exec(cursor);
        if (m === null) return refuse();
        from = Number(m[1]);
        if (from > all.length) return refuse();
      }
      const added = all.slice(from, from + SIM_SYNC_PAGE);
      const next = from + added.length;
      const hasMore = next < all.length;
      return {
        added,
        modified: [],
        removed: [],
        accounts: layout.demo.bank.accounts.map(toPlaidAccount),
        nextCursor: `sim:${next}`,
        hasMore,
        updateStatus: hasMore ? "INITIAL_UPDATE_COMPLETE" : "HISTORICAL_UPDATE_COMPLETE",
      };
    },
    // Nothing outside the process holds the connection, so removing it has nothing to undo (R8.7).
    async remove(_config, accessToken) {
      bankLayout(accessToken, fixtures);
    },
  };
}
