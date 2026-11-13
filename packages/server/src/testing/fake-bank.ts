/**
 * Brief 046: a scriptable bank port for tests. No network. Sync answers the scripted pages in order whatever the
 * cursor, so a test can apply the same pull twice; errors are queued per method.
 */
import type { BankConfig } from "../bank/config";
import { BankCallError, type BankPort, type PlaidAccount, type PlaidTransaction, type SyncPage } from "../bank/plaid";

export const BANK_TEST_KEY = Buffer.alloc(32, 7).toString("base64");
export const BANK_ENV = { PLAID_CLIENT_ID: "testclient0000000000000a", PLAID_SECRET: "testsecret00000000000000000000", PLAID_ENV: "sandbox", FRANKI_BANK_TOKEN_KEY: BANK_TEST_KEY };
export const ACCESS_TOKEN = "access-sandbox-6f1c0a2e-0000-4000-8000-1234567890ab";

export function account(id: string, mask = "0000", over: Partial<PlaidAccount> = {}): PlaidAccount {
  return { account_id: id, name: "Everyday Checking", mask, type: "depository", subtype: "checking", ...over };
}

export function txn(id: string, over: Partial<PlaidTransaction> = {}): PlaidTransaction {
  return {
    transaction_id: id,
    account_id: "acc-1",
    amount: 12.34,
    iso_currency_code: "USD",
    date: "2026-11-02",
    datetime: null,
    authorized_date: "2026-11-01",
    authorized_datetime: null,
    pending: false,
    pending_transaction_id: null,
    merchant_name: "Corner Cafe",
    name: "CORNER CAFE 123",
    personal_finance_category: { detailed: "FOOD_AND_DRINK_COFFEE" },
    ...over,
  };
}

export function page(over: Partial<SyncPage> = {}): SyncPage {
  return { added: [], modified: [], removed: [], accounts: [account("acc-1")], nextCursor: "cursor-1", hasMore: false, updateStatus: "HISTORICAL_UPDATE_COMPLETE", ...over };
}

type Method = keyof BankPort;

export class FakeBank implements BankPort {
  calls: { method: Method; token: string | null; cursor?: string | null }[] = [];
  pages: SyncPage[] = [page()];
  item = { itemId: "item-1", institutionId: "ins_1", institutionName: "First Test Bank", accounts: [account("acc-1")] };
  accessToken = ACCESS_TOKEN;
  private errors = new Map<Method, (BankCallError | Error)[]>();
  private pageIndex = 0;

  failNext(method: Method, error: BankCallError | Error): this {
    this.errors.set(method, [...(this.errors.get(method) ?? []), error]);
    return this;
  }

  private take(method: Method) {
    const queue = this.errors.get(method);
    const e = queue?.shift();
    if (e === undefined) return;
    // A failed page restarts the paging from the first page, as Plaid asks after a mutation during pagination.
    if (method === "sync") this.pageIndex = 0;
    throw e;
  }

  async linkToken(_c: BankConfig, _user: string) {
    this.calls.push({ method: "linkToken", token: null });
    this.take("linkToken");
    return { linkToken: "link-sandbox-test-token", expiration: "2026-11-03T16:00:00Z" };
  }
  async exchange(_c: BankConfig, _publicToken: string) {
    this.calls.push({ method: "exchange", token: null });
    this.take("exchange");
    return { accessToken: this.accessToken, itemId: this.item.itemId };
  }
  async accounts(_c: BankConfig, token: string) {
    this.calls.push({ method: "accounts", token });
    this.take("accounts");
    return { itemId: this.item.itemId, institutionId: this.item.institutionId, institutionName: this.item.institutionName, accounts: this.item.accounts };
  }
  async sync(_c: BankConfig, token: string, cursor: string | null) {
    this.calls.push({ method: "sync", token, cursor });
    this.take("sync");
    if (cursor === null) this.pageIndex = 0;
    const p = this.pages[this.pageIndex % this.pages.length]!;
    this.pageIndex = p.hasMore ? this.pageIndex + 1 : 0;
    return p;
  }
  async remove(_c: BankConfig, token: string) {
    this.calls.push({ method: "remove", token });
    this.take("remove");
  }
}

export const plaidError = (code: string, definite = true) => new BankCallError(code, definite);
