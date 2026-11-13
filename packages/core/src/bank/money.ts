/**
 * Brief 046 part C: the pure money read. What a spending question's shape resolves to, which rows count, and the
 * lines code says from them. Integer cents only, USD only. No I/O and no clock: `nowMs` and `zone` are arguments.
 *
 * Always: every figure carries the rows behind it, a total is the sum of its own rows' cents, and nothing here gives
 * advice or names a cause. Never: a model's number, a float, a guessed refund original, or a row's text as an
 * instruction (a merchant's title is shown as a name and nothing else).
 */
import { addCivilDays, civilDateAt } from "../dates";
import { tokenize } from "../text";

// ---------------------------------------------------------------------------------------------
// The provider's category code

/** Plaid's detailed code as stored on a bank row's `description` (follow-up 1). Anything else stores nothing. */
export const BANK_CATEGORY_CODE = /^[A-Z0-9_]{1,64}$/;
export const isCategoryCode = (v: unknown): v is string => typeof v === "string" && BANK_CATEGORY_CODE.test(v);

/**
 * Plaid's primary categories, PFCv1 and PFCv2 together (pfc-taxonomy-all.csv, checked 2026-11-13). A detailed code is
 * its primary plus `_` plus the rest, and primaries hold underscores, so the primary is the longest one that prefixes.
 */
export const PFC_PRIMARIES = [
  "INCOME",
  "LOAN_DISBURSEMENTS",
  "LOAN_PAYMENTS",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "TRANSPORTATION",
  "TRAVEL",
  "RENT_AND_UTILITIES",
  "OTHER",
] as const;
export type PfcPrimary = (typeof PFC_PRIMARIES)[number];

export function primaryOf(code: string | null): PfcPrimary | null {
  if (code === null || !isCategoryCode(code)) return null;
  let best: PfcPrimary | null = null;
  for (const p of PFC_PRIMARIES) if ((code === p || code.startsWith(`${p}_`)) && (best === null || p.length > best.length)) best = p;
  return best;
}

/** The spending groups a question may name. `foodAndDrink` names all four food groups at once. */
export const MONEY_GROUPS = [
  "foodAndDrink",
  "groceries",
  "restaurants",
  "fastFood",
  "otherFoodAndDrink",
  "transportation",
  "shopping",
  "entertainment",
  "travel",
  "billsAndUtilities",
  "medical",
  "personalCare",
  "home",
  "services",
  "fees",
  "loanPayments",
  "giving",
  "government",
  "other",
  "uncategorized",
] as const;
export type MoneyGroup = (typeof MONEY_GROUPS)[number];
/** A row's own group: every group but the `foodAndDrink` umbrella. */
export type RowGroup = Exclude<MoneyGroup, "foodAndDrink">;

/**
 * The primary category to its group, in one table. Food and drink is split by its detailed code below; government
 * donations are `giving`. The four kinds that are not spending have no group (see `codeKind`).
 */
export const MONEY_GROUP_TABLE = {
  INCOME: null,
  LOAN_DISBURSEMENTS: null,
  LOAN_PAYMENTS: "loanPayments",
  TRANSFER_IN: null,
  TRANSFER_OUT: null,
  BANK_FEES: "fees",
  ENTERTAINMENT: "entertainment",
  FOOD_AND_DRINK: "otherFoodAndDrink",
  GENERAL_MERCHANDISE: "shopping",
  HOME_IMPROVEMENT: "home",
  MEDICAL: "medical",
  PERSONAL_CARE: "personalCare",
  GENERAL_SERVICES: "services",
  GOVERNMENT_AND_NON_PROFIT: "government",
  TRANSPORTATION: "transportation",
  TRAVEL: "travel",
  RENT_AND_UTILITIES: "billsAndUtilities",
  OTHER: "other",
} as const satisfies Record<PfcPrimary, RowGroup | null>;

/** Detailed codes whose group differs from their primary's. */
export const MONEY_DETAILED_GROUPS: Readonly<Record<string, RowGroup>> = {
  FOOD_AND_DRINK_GROCERIES: "groceries",
  FOOD_AND_DRINK_RESTAURANT: "restaurants",
  FOOD_AND_DRINK_COFFEE: "restaurants",
  FOOD_AND_DRINK_FAST_FOOD: "fastFood",
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: "giving",
};

/**
 * What a row is, from its code alone: money moving between the owner's own accounts (transfers, and loan money in,
 * which PFCv1 files under TRANSFER_IN), a credit-card payment, income, or ordinary money in or out.
 */
export type CodeKind = "transfer" | "cardPayment" | "income" | "ordinary";
export function codeKind(code: string | null): CodeKind {
  const p = primaryOf(code);
  if (p === "TRANSFER_IN" || p === "TRANSFER_OUT" || p === "LOAN_DISBURSEMENTS") return "transfer";
  if (code === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return "cardPayment";
  if (p === "INCOME") return "income";
  return "ordinary";
}

/** An ordinary row's group. No code is `uncategorized`; a well-formed code with no known primary is `other`. */
export function groupOf(code: string | null): RowGroup {
  if (code === null || !isCategoryCode(code)) return "uncategorized";
  if (Object.prototype.hasOwnProperty.call(MONEY_DETAILED_GROUPS, code)) return MONEY_DETAILED_GROUPS[code]!;
  const p = primaryOf(code);
  return p === null ? "other" : (MONEY_GROUP_TABLE[p] ?? "other");
}

const FOOD: ReadonlySet<RowGroup> = new Set(["groceries", "restaurants", "fastFood", "otherFoodAndDrink"]);
export const groupMatches = (asked: MoneyGroup | null, row: RowGroup) => asked === null || asked === row || (asked === "foodAndDrink" && FOOD.has(row));

// ---------------------------------------------------------------------------------------------
// The period

export const MONEY_PERIODS = ["this_week", "last_week", "this_month", "last_month", "last_7_days", "last_30_days", "last_90_days"] as const;
export type MoneyPeriod = (typeof MONEY_PERIODS)[number];

/** Monday is 1 and Sunday 7 (ISO), from the civil date alone. */
function isoWeekday(civil: string): number {
  const [y, m, d] = civil.split("-").map(Number) as [number, number, number];
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The first and last civil date of a period, said at `nowMs` in `zone` (the ops clock in the owner's zone). */
export function moneyPeriod(period: MoneyPeriod, nowMs: number, zone: string): { from: string; to: string } {
  const today = civilDateAt(nowMs, zone);
  const monday = addCivilDays(today, 1 - isoWeekday(today));
  const firstOfMonth = `${today.slice(0, 8)}01`;
  switch (period) {
    case "this_week":
      return { from: monday, to: today };
    case "last_week":
      return { from: addCivilDays(monday, -7), to: addCivilDays(monday, -1) };
    case "this_month":
      return { from: firstOfMonth, to: today };
    case "last_month": {
      const last = addCivilDays(firstOfMonth, -1);
      return { from: `${last.slice(0, 8)}01`, to: last };
    }
    case "last_7_days":
      return { from: addCivilDays(today, -6), to: today };
    case "last_30_days":
      return { from: addCivilDays(today, -29), to: today };
    case "last_90_days":
      return { from: addCivilDays(today, -89), to: today };
    default:
      period satisfies never;
      return { from: today, to: today };
  }
}

// ---------------------------------------------------------------------------------------------
// The answer

/** The only currency totalled. Rows in any other are left out and counted, never converted. */
export const MONEY_CURRENCY = "USD";
/** Contracts' `W` caps: a note cites at most 128 root keys and 256 dependencies. One row is one of each. */
export const MONEY_NOTE_ROWS_MAX = 128;
/** The result holds at most four notes, so a period splits into at most four parts. */
export const MONEY_PARTS_MAX = 4;
export const MONEY_TOP_MERCHANTS = 5;
export const MONEY_MERCHANT_CHARS = 64;

/** One current, eligible bank row, as the read hands it over. */
export interface MoneyRow {
  eid: string;
  /** The root key of the row's title slice: its lineage. */
  rootKey: string;
  title: string;
  merchantKey: string | null;
  amountCents: number;
  currency: string;
  pending: boolean;
  code: string | null;
  /** The row's civil date, or null when it has none. */
  day: string | null;
}

export interface MoneyQuestion {
  period: MoneyPeriod;
  group: MoneyGroup | null;
  merchant: string | null;
}

/** A figure and the rows behind it. */
export interface Figure {
  cents: number;
  count: number;
  eids: string[];
}

export interface MoneyPart {
  from: string;
  to: string;
  spent: Figure;
  merchants: { name: string; cents: number; count: number }[];
  moneyBack: Figure;
  pending: string[];
  otherCurrency: string[];
  /** Rows with no date: left out, counted in the first part only. */
  unknownTime: string[];
  /** Every row this part cites (its note's lineage). */
  cited: { eid: string; rootKey: string }[];
}

export type MoneyFacts = { kind: "answered"; from: string; to: string; parts: MoneyPart[] } | { kind: "narrow"; from: string; to: string } | { kind: "unclear" };

/** What a row is for this question. Not in the period, group or merchant: null. */
type Role = "spent" | "moneyBack" | "pending" | "otherCurrency" | "unknownTime";

/** The merchant's words, as tokens, when every one is in the owner's own words; else null. */
export function merchantTerms(merchant: string | null, ownerText: string): string[] | null | "unclear" {
  if (merchant === null) return null;
  const terms = tokenize(merchant.slice(0, MONEY_MERCHANT_CHARS)).filter((t) => t.length >= 2);
  if (terms.length === 0) return "unclear";
  const owner = new Set(tokenize(ownerText));
  return terms.every((t) => owner.has(t)) ? terms : "unclear";
}

function roleOf(r: MoneyRow, q: MoneyQuestion, range: { from: string; to: string }, terms: string[] | null): Role | null {
  const kind = codeKind(r.code);
  if (kind !== "ordinary") return null;
  if (!groupMatches(q.group, groupOf(r.code))) return null;
  if (terms !== null) {
    const words = new Set(tokenize(r.title));
    if (!terms.every((t) => words.has(t))) return null;
  }
  if (r.day === null) return "unknownTime";
  if (r.day < range.from || r.day > range.to) return null;
  if (r.currency !== MONEY_CURRENCY) return "otherCurrency";
  if (r.pending) return "pending";
  if (r.amountCents > 0) return "spent";
  if (r.amountCents < 0) return "moneyBack";
  return null;
}

const empty = (): Figure => ({ cents: 0, count: 0, eids: [] });

function partOf(from: string, to: string, rows: readonly { r: MoneyRow; role: Role }[]): MoneyPart {
  const part: MoneyPart = { from, to, spent: empty(), merchants: [], moneyBack: empty(), pending: [], otherCurrency: [], unknownTime: [], cited: [] };
  const byMerchant = new Map<string, { name: string; cents: number; count: number }>();
  for (const { r, role } of rows) {
    part.cited.push({ eid: r.eid, rootKey: r.rootKey });
    if (role === "spent") {
      part.spent.cents += r.amountCents;
      part.spent.count++;
      part.spent.eids.push(r.eid);
      const key = r.merchantKey ?? `title:${r.title}`;
      const m = byMerchant.get(key) ?? { name: r.title, cents: 0, count: 0 };
      m.cents += r.amountCents;
      m.count++;
      byMerchant.set(key, m);
    } else if (role === "moneyBack") {
      part.moneyBack.cents += -r.amountCents;
      part.moneyBack.count++;
      part.moneyBack.eids.push(r.eid);
    } else if (role === "pending") part.pending.push(r.eid);
    else if (role === "otherCurrency") part.otherCurrency.push(r.eid);
    else part.unknownTime.push(r.eid);
  }
  part.merchants = [...byMerchant.values()].sort((a, b) => b.cents - a.cents || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, MONEY_TOP_MERCHANTS);
  return part;
}

/**
 * The answer to one question over the given rows. Rows outside the period, group or merchant are not cited. With
 * more than a note can cite, the period splits into consecutive weeks packed into at most four parts; past that, or
 * with one week too big, `narrow` and no total.
 */
export function moneyAnswer(rows: readonly MoneyRow[], q: MoneyQuestion, nowMs: number, zone: string, ownerText: string): MoneyFacts {
  const terms = merchantTerms(q.merchant, ownerText);
  if (terms === "unclear") return { kind: "unclear" };
  const range = moneyPeriod(q.period, nowMs, zone);
  const seen = new Set<string>();
  const kept: { r: MoneyRow; role: Role }[] = [];
  for (const r of rows) {
    if (seen.has(r.eid)) continue;
    seen.add(r.eid);
    const role = roleOf(r, q, range, terms);
    if (role !== null) kept.push({ r, role });
  }
  kept.sort((a, b) => ((a.r.day ?? "") < (b.r.day ?? "") ? -1 : (a.r.day ?? "") > (b.r.day ?? "") ? 1 : a.r.eid < b.r.eid ? -1 : a.r.eid > b.r.eid ? 1 : 0));
  const undated = kept.filter((k) => k.role === "unknownTime");
  const dated = kept.filter((k) => k.role !== "unknownTime");
  if (kept.length <= MONEY_NOTE_ROWS_MAX) return { kind: "answered", from: range.from, to: range.to, parts: [partOf(range.from, range.to, [...undated, ...dated])] };

  // Weeks from the period's first day, packed greedily into parts that each fit one note.
  const weeks: { from: string; to: string; rows: typeof kept }[] = [];
  for (let from = range.from; from <= range.to; from = addCivilDays(from, 7)) {
    const end = addCivilDays(from, 6);
    const to = end > range.to ? range.to : end;
    weeks.push({ from, to, rows: dated.filter((k) => k.r.day! >= from && k.r.day! <= to) });
  }
  weeks[0]!.rows = [...undated, ...weeks[0]!.rows];
  const parts: { from: string; to: string; rows: typeof kept }[] = [];
  for (const w of weeks) {
    if (w.rows.length > MONEY_NOTE_ROWS_MAX) return { kind: "narrow", from: range.from, to: range.to };
    const last = parts[parts.length - 1];
    if (last !== undefined && last.rows.length + w.rows.length <= MONEY_NOTE_ROWS_MAX) {
      last.to = w.to;
      last.rows = [...last.rows, ...w.rows];
    } else parts.push({ from: w.from, to: w.to, rows: [...w.rows] });
  }
  if (parts.length > MONEY_PARTS_MAX) return { kind: "narrow", from: range.from, to: range.to };
  return { kind: "answered", from: range.from, to: range.to, parts: parts.map((p) => partOf(p.from, p.to, p.rows)) };
}

// ---------------------------------------------------------------------------------------------
// Lines (spoken grade; the model may only word them)

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `2026-11-03` as "November 3". */
export function dayLabel(civil: string): string {
  const [, m, d] = civil.split("-").map(Number) as [number, number, number];
  return `${MONTH_NAMES[m - 1]} ${d}`;
}

/** Integer cents as dollars, "$1,234.56". Exact: no float is formed. */
export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How old the bank read is, in words; null when the bank was never read. */
export function freshnessLine(lastSuccessMs: number | null, nowMs: number): string {
  if (lastSuccessMs === null) return "The bank hasn't been read yet.";
  const mins = Math.max(0, Math.floor((nowMs - lastSuccessMs) / 60_000));
  if (mins < 2) return "The bank was read just now.";
  if (mins < 120) return `The bank was last read ${mins} minutes ago.`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `The bank was last read ${hours} hours ago.`;
  return `The bank was last read ${Math.floor(hours / 24)} days ago.`;
}

/** One part's line: its dates, what was spent, the top merchants, money back and what was left out. */
export function partLine(p: MoneyPart, extra: readonly string[] = []): string {
  const out: string[] = [];
  const span = p.from === p.to ? `On ${dayLabel(p.from)}` : `From ${dayLabel(p.from)} to ${dayLabel(p.to)}`;
  out.push(p.spent.count === 0 ? `${span}: no spending found.` : `${span}: ${dollars(p.spent.cents)} spent across ${plural(p.spent.count, "purchase", "purchases")}.`);
  if (p.merchants.length > 0) out.push(`Top: ${p.merchants.map((m) => `${m.name} ${dollars(m.cents)}`).join("; ")}.`);
  if (p.moneyBack.count > 0) out.push(`Money back: ${dollars(p.moneyBack.cents)} across ${plural(p.moneyBack.count, "refund or credit", "refunds or credits")}.`);
  const left: string[] = [];
  if (p.pending.length > 0) left.push(`${plural(p.pending.length, "pending charge", "pending charges")}`);
  if (p.otherCurrency.length > 0) left.push(`${plural(p.otherCurrency.length, "charge", "charges")} in another currency`);
  if (p.unknownTime.length > 0) left.push(`${plural(p.unknownTime.length, "charge", "charges")} with no date`);
  if (left.length > 0) out.push(`Not counted: ${left.join(", ")}.`);
  out.push(...extra);
  return out.join(" ").slice(0, 1024);
}

/** Lines with no amount and no digit, for every answer that holds no total. */
export const MONEY_LINES = {
  noBank: "No bank is connected, so there's no spending to read. A bank can be connected from the bank control on the screen.",
  importing: "The bank is still being read for the first time. Ask again in a little while.",
  narrow: "That's more purchases than one answer can show. Ask about one week, one kind of spending, or one merchant.",
  unclear: "I couldn't tell which merchant you meant. Say the merchant's name and ask again.",
  held: "Your spending is private, so I'll keep it for when it's just us.",
  notAsked: "I only read spending when you ask about it.",
  lost: "That spending question didn't finish. Please ask it again.",
} as const;

export const MONEY_NO_BANK_CARD = { title: "Connect a bank", lines: ["A bank can be connected from the bank control on the screen. Franki can read it and can't move money."] } as const;

/**
 * The words that make a spending question asked (the Gate's aliases for a money note): the owner's own words this
 * turn must hold one of them. Every one is two or more characters and not a function word.
 */
export const MONEY_ALIASES = [
  "spend",
  "spent",
  "spending",
  "money",
  "paid",
  "pay",
  "cost",
  "costs",
  "bought",
  "buy",
  "purchase",
  "purchases",
  "charges",
  "charged",
  "transactions",
  "bank",
  "expenses",
  "groceries",
  "budget",
] as const;
