/**
 * Brief 046 (lane plaid): the pure parts of a bank row. Amounts in integer cents and the four food categories.
 * No I/O and no clock.
 */

/** The largest amount kept, in cents (one hundred billion dollars). Anything larger is refused, not rounded. */
export const BANK_CENTS_MAX = 10_000_000_000_000;

/**
 * A provider amount as integer cents, same sign, or null when it is not a whole number of cents. Reads the number's
 * own shortest decimal form, so 0.29 is 29 and never 28.999…; a third decimal, an exponent form or a value past
 * `BANK_CENTS_MAX` is refused.
 */
export function centsOf(amount: unknown): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const text = String(amount);
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (m === null) return null;
  const whole = Number(m[2]);
  const frac = Number((m[3] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents) || cents > BANK_CENTS_MAX) return null;
  return m[1] === "-" ? -cents || 0 : cents;
}

/**
 * Whether an Evidence row came from a connected bank (ruling 5): such rows are read only by the bank's own money
 * read, never by the hero, the compare loop or the moments. The persona's rows have `source: "fixture"` and no
 * connector.
 */
export function isConnectedBankRow(e: { source: string; connectorId: string | null }): boolean {
  return e.source === "plaid" && e.connectorId !== null;
}

export const BANK_CATEGORIES =["takeout", "groceries", "restaurant", "other"] as const;
export type BankCategory = (typeof BANK_CATEGORIES)[number];

/**
 * The provider's detailed personal-finance category to the four food categories. Checked against Plaid's taxonomy
 * (pfc-taxonomy-all.csv, PFCv1 and PFCv2 share these FOOD_AND_DRINK codes) on 2026-11-13. Plaid has no delivery
 * code, so takeout is fast food only; bars are inside RESTAURANT. Everything else is `other`.
 */
export const BANK_CATEGORY_TABLE: Readonly<Record<string, BankCategory>> = {
  FOOD_AND_DRINK_GROCERIES: "groceries",
  FOOD_AND_DRINK_RESTAURANT: "restaurant",
  FOOD_AND_DRINK_COFFEE: "restaurant",
  FOOD_AND_DRINK_FAST_FOOD: "takeout",
};

export function bankCategoryOf(detailed: unknown): BankCategory {
  if (typeof detailed !== "string") return "other";
  return Object.prototype.hasOwnProperty.call(BANK_CATEGORY_TABLE, detailed) ? BANK_CATEGORY_TABLE[detailed]! : "other";
}

// Part C: the money read.
export * from "./money";
