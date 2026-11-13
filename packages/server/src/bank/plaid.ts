/**
 * Brief 046: the bank port and its live Plaid half. Plain `fetch` with a timeout and `redirect: "error"`, as the
 * Twilio calls do; no Plaid SDK. Read-only by construction: the only product requested is `transactions`, and the
 * port reaches exactly the five paths in `PLAID_PATHS`, none of which can move money. A test pins both.
 *
 * Field names checked against Plaid's API reference (plaid.com/docs/api) on 2026-11-13.
 */
import type { BankConfig } from "./config";

export const PLAID_PATHS = ["/link/token/create", "/item/public_token/exchange", "/accounts/get", "/transactions/sync", "/item/remove"] as const;
export type PlaidPath = (typeof PLAID_PATHS)[number];
/** The only product a link token asks for. Never auth, transfer, payment_initiation or any other. */
export const PLAID_PRODUCTS = ["transactions"] as const;
/** Ruling 8. */
export const DAYS_REQUESTED = 90;
export const SYNC_PAGE_COUNT = 500;
const TIMEOUT_MS = 8000;
const HOSTS = { production: "https://production.plaid.com", sandbox: "https://sandbox.plaid.com" } as const;

export type BankProblemClass = "needsReconnect" | "revoked" | "transient";

/** Plaid's error codes that need the owner to sign in again in Link. */
export const RELINK_CODES = ["ITEM_LOGIN_REQUIRED", "INVALID_CREDENTIALS", "ITEM_LOCKED", "USER_SETUP_REQUIRED", "NO_ACCOUNTS", "ACCESS_NOT_GRANTED"] as const;
/** Plaid's error codes that mean the connection is gone. */
export const REVOKED_CODES = ["USER_PERMISSION_REVOKED", "ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"] as const;
export const MUTATION_DURING_PAGINATION = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";

/** The closed class of one Plaid error code. Everything not listed is transient. */
export function classifyBankError(code: string | null): BankProblemClass {
  if (code !== null && (RELINK_CODES as readonly string[]).includes(code)) return "needsReconnect";
  if (code !== null && (REVOKED_CODES as readonly string[]).includes(code)) return "revoked";
  return "transient";
}

/**
 * A failed bank call. `definite` is true when Plaid answered with an error body, so the request was refused and did
 * nothing; false when the outcome is unknown (timeout, network, 5xx, unreadable answer). Carries no token and no
 * Plaid message.
 */
export class BankCallError extends Error {
  readonly problem: BankProblemClass;
  constructor(readonly code: string | null, readonly definite: boolean) {
    super(`bank call failed${code === null ? "" : `: ${code}`}`);
    this.name = "BankCallError";
    this.problem = classifyBankError(code);
  }
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
}

/** One transaction as `/transactions/sync` returns it; only the fields Franki reads. */
export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code: string | null;
  date: string;
  datetime: string | null;
  authorized_date: string | null;
  authorized_datetime: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
  merchant_name: string | null;
  name: string | null;
  personal_finance_category: { detailed: string | null } | null;
}

export const UPDATE_STATUSES = ["TRANSACTIONS_UPDATE_STATUS_UNKNOWN", "NOT_READY", "INITIAL_UPDATE_COMPLETE", "HISTORICAL_UPDATE_COMPLETE"] as const;
export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

export interface SyncPage {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  accounts: PlaidAccount[];
  nextCursor: string;
  hasMore: boolean;
  updateStatus: UpdateStatus;
}

export interface BankPort {
  linkToken(config: BankConfig, clientUserId: string): Promise<{ linkToken: string; expiration: string }>;
  exchange(config: BankConfig, publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  accounts(config: BankConfig, accessToken: string): Promise<{ itemId: string; institutionId: string | null; institutionName: string | null; accounts: PlaidAccount[] }>;
  sync(config: BankConfig, accessToken: string, cursor: string | null): Promise<SyncPage>;
  remove(config: BankConfig, accessToken: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Reading Plaid's answers. Anything off-shape is an unknown outcome (`definite: false`).

const bad = (): never => {
  throw new BankCallError(null, false);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sOrNull = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : bad());
const s = (v: unknown): string => (typeof v === "string" && v !== "" ? v : bad());
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : bad());

function account(v: unknown): PlaidAccount {
  if (!isObj(v)) return bad();
  return { account_id: s(v.account_id), name: typeof v.name === "string" ? v.name : "", mask: sOrNull(v.mask), type: typeof v.type === "string" ? v.type : "other", subtype: sOrNull(v.subtype) };
}

function transaction(v: unknown): PlaidTransaction {
  if (!isObj(v)) return bad();
  const pfc = isObj(v.personal_finance_category) ? { detailed: sOrNull(v.personal_finance_category.detailed) } : null;
  return {
    transaction_id: s(v.transaction_id),
    account_id: s(v.account_id),
    amount: typeof v.amount === "number" ? v.amount : bad(),
    iso_currency_code: sOrNull(v.iso_currency_code),
    date: s(v.date),
    datetime: sOrNull(v.datetime),
    authorized_date: sOrNull(v.authorized_date),
    authorized_datetime: sOrNull(v.authorized_datetime),
    pending: v.pending === true,
    pending_transaction_id: sOrNull(v.pending_transaction_id),
    merchant_name: sOrNull(v.merchant_name),
    name: sOrNull(v.name),
    personal_finance_category: pfc,
  };
}

function syncPage(v: Record<string, unknown>): SyncPage {
  const status = v.transactions_update_status;
  return {
    added: list(v.added).map(transaction),
    modified: list(v.modified).map(transaction),
    removed: list(v.removed).map((r) => (isObj(r) ? { transaction_id: s(r.transaction_id) } : bad())),
    accounts: list(v.accounts).map(account),
    nextCursor: s(v.next_cursor),
    hasMore: typeof v.has_more === "boolean" ? v.has_more : bad(),
    updateStatus: (UPDATE_STATUSES as readonly unknown[]).includes(status) ? (status as UpdateStatus) : "TRANSACTIONS_UPDATE_STATUS_UNKNOWN",
  };
}

// ---------------------------------------------------------------------------------------------
// The live port.

export type FetchLike = (url: string, init: { method: "POST"; redirect: "error"; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The live port. `fetchFn` is for tests; by default it is the global `fetch`, read at call time. */
export function plaidPort(fetchFn?: FetchLike): BankPort {
  async function post(config: BankConfig, path: PlaidPath, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const f: FetchLike = fetchFn ?? (globalThis.fetch as unknown as FetchLike);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await f(`${HOSTS[config.environment]}${path}`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: config.clientId, secret: config.secret, ...body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BankCallError(null, false);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new BankCallError(null, false);
    }
    if (!response.ok) {
      const code = isObj(data) && typeof data.error_code === "string" && /^[A-Z0-9_]{1,64}$/.test(data.error_code) ? data.error_code : null;
      // A 4xx with Plaid's error body was refused; a 5xx or an unreadable answer may have done something.
      throw new BankCallError(code, response.status >= 400 && response.status < 500 && code !== null);
    }
    return isObj(data) ? data : bad();
  }

  return {
    async linkToken(config, clientUserId) {
      const data = await post(config, "/link/token/create", {
        client_name: "Franki",
        products: [...PLAID_PRODUCTS],
        country_codes: ["US"],
        language: "en",
        user: { client_user_id: clientUserId },
        transactions: { days_requested: DAYS_REQUESTED },
      });
      return { linkToken: s(data.link_token), expiration: s(data.expiration) };
    },
    async exchange(config, publicToken) {
      const data = await post(config, "/item/public_token/exchange", { public_token: publicToken });
      return { accessToken: s(data.access_token), itemId: s(data.item_id) };
    },
    async accounts(config, accessToken) {
      const data = await post(config, "/accounts/get", { access_token: accessToken });
      const item = isObj(data.item) ? data.item : bad();
      return {
        itemId: s(item.item_id),
        institutionId: sOrNull(item.institution_id),
        institutionName: sOrNull(item.institution_name),
        accounts: list(data.accounts).map(account),
      };
    },
    async sync(config, accessToken, cursor) {
      const data = await post(config, "/transactions/sync", { access_token: accessToken, count: SYNC_PAGE_COUNT, ...(cursor === null ? {} : { cursor }) });
      return syncPage(data);
    },
    async remove(config, accessToken) {
      await post(config, "/item/remove", { access_token: accessToken });
    },
  };
}

export const livePlaid: BankPort = plaidPort();
