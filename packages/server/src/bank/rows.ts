/**
 * Brief 046 ruling 4: one bank transaction as one Evidence record. The field choices follow the seed's `buildBank`
 * (packages/server/src/seed/build.ts), with the ruling's differences: deterministic IDs from the connector and the
 * provider's transaction ID, every slice `O`/`S1`, the merchant through `safeName` as a ranged title slice, exact
 * integer cents, ISO currency only, and the provider's own dates.
 *
 * The bank can inform, not instruct: a merchant name is data in a title, never a rule, a preference, an identity
 * fact or a permission. Nothing here enqueues extraction.
 */
import {
  type Evidence,
  type Hasher,
  SAFE_NAME_FALLBACK,
  type Slice,
  bankCategoryOf,
  buildSlice,
  canonicalJSON,
  centsOf,
  isCategoryCode,
  safeName,
  tsFromMs,
  utf8,
} from "@franki/core";
import { cFields } from "../records";
import type { PlaidTransaction } from "./plaid";

export const BANK_PARSER_VERSION = "bank-sync-v1";
/** A title for a merchant whose name does not pass `safeName` (a ruling: "a sender" reads wrong for a shop). */
export const BANK_TITLE_FALLBACK = "a merchant";
/** A date-only provider time is stored at noon UTC, so it falls on its own civil date across the US zones. */
export const DATE_ONLY_HOUR_UTC = 12;

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

export const bankLogicalId = (hasher: Hasher, uid: string, connectorId: string, transactionId: string) =>
  hasher.id(["bank-row", uid, connectorId, transactionId]);
export const bankProviderKey = (hasher: Hasher, connectorId: string, transactionId: string) => hasher.id(["bank-provider", connectorId, transactionId]);
export const bankAccountKey = (hasher: Hasher, connectorId: string, accountId: string) => hasher.id(["bank-account", connectorId, accountId]);
export const bankMerchantKey = (hasher: Hasher, uid: string, merchant: string) => hasher.id(["bank-merchant", uid, merchant.normalize("NFC").trim().toLowerCase()]);

/** A civil date `YYYY-MM-DD` that is a real date, or null. */
function civil(d: string | null): string | null {
  if (d === null || !CIVIL.test(d)) return null;
  const ms = Date.parse(`${d}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d ? d : null;
}

/** A provider date-time as a TS, or null. */
function instant(dt: string | null): string | null {
  if (dt === null || dt.length > 40) return null;
  const ms = Date.parse(dt);
  return Number.isFinite(ms) && Number.isSafeInteger(ms) ? tsFromMs(ms) : null;
}

const atNoon = (d: string) => tsFromMs(Date.parse(`${d}T${String(DATE_ONLY_HOUR_UTC).padStart(2, "0")}:00:00.000Z`));

export interface BankRowContext {
  uid: string;
  connectorId: string;
  generation: number;
  epoch: number;
  policyRev: number;
  opsNow: number;
  hasher: Hasher;
}

export type SkipReason = "noCurrency" | "badAmount" | "badDate";

/** Everything about a row that is not its eid or its C fields: two rows with equal content are the same revision. */
export interface BankRowContent {
  title: string;
  observation: Extract<Evidence["observation"], { kind: "bank" }>;
  /** Part C follow-up 1: Plaid's detailed category code (its primary is a prefix), or null. Stored as `description`. */
  categoryCode: string | null;
  occurredAt: string;
  assertedAt: string;
}

/** The content of one row, or why it is skipped. `pendingOfId` is resolved by the caller (never guessed). */
export function bankRowContent(t: PlaidTransaction, ctx: BankRowContext, pendingOfId: string | null, removed: boolean): BankRowContent | SkipReason {
  const currency = t.iso_currency_code;
  if (currency === null || !/^[A-Z]{3}$/.test(currency)) return "noCurrency";
  const amountCents = centsOf(t.amount);
  if (amountCents === null) return "badAmount";
  const date = civil(t.date);
  if (date === null) return "badDate";
  const authorizedDate = civil(t.authorized_date);
  const authorizedAt = instant(t.authorized_datetime);
  const purchaseAt =
    authorizedAt !== null
      ? { instant: authorizedAt, civilDate: authorizedDate, zone: null, basis: "providerAuthorized" as const, precision: "instant" as const }
      : { instant: null, civilDate: authorizedDate ?? date, zone: null, basis: "providerDate" as const, precision: "day" as const };
  const postedAt = t.pending ? null : (instant(t.datetime) ?? atNoon(date));
  const occurredAt = purchaseAt.instant ?? atNoon(purchaseAt.civilDate);
  const merchant = t.merchant_name ?? t.name ?? "";
  const named = safeName(merchant);
  const title = named === SAFE_NAME_FALLBACK ? BANK_TITLE_FALLBACK : named;
  const { hasher, connectorId, uid } = ctx;
  const detailed = t.personal_finance_category?.detailed ?? null;
  return {
    title,
    // Validated against a strict pattern before it is stored; anything else stores nothing.
    categoryCode: isCategoryCode(detailed) ? detailed : null,
    occurredAt,
    assertedAt: postedAt ?? occurredAt,
    observation: {
      kind: "bank",
      providerKey: bankProviderKey(hasher, connectorId, t.transaction_id),
      pending: t.pending,
      removed,
      // Plaid's sign: positive is money out, as the hero detector's convention (a refund is negative).
      amountCents,
      currency,
      pendingOfId,
      // Never guessed (ruling 4): a negative row's original is not known for certain.
      refundOfId: null,
      merchantKey: merchant.trim() === "" ? null : bankMerchantKey(hasher, uid, merchant),
      category: bankCategoryOf(detailed),
      purchaseAt,
      postedAt,
      accountKey: bankAccountKey(hasher, connectorId, t.account_id),
    },
  };
}

export const contentKey = (c: BankRowContent) => canonicalJSON(c);
/** The same key read back from a stored row. */
export const storedContentKey = (e: Evidence) =>
  e.observation.kind === "bank"
    ? canonicalJSON({ title: e.title, observation: e.observation, categoryCode: storedCategoryCode(e), occurredAt: e.occurredAt, assertedAt: e.assertedAt })
    : null;

/** The category code a stored bank row carries in `description`, or null (a row stored before follow-up 1 has none). */
export function storedCategoryCode(e: Pick<Evidence, "description">): string | null {
  const d = e.description;
  return d !== null && d.kind === "inline" && isCategoryCode(d.text) ? d.text : null;
}

function typedSlice(eid: string, fieldPath: Slice["fieldPath"], value: unknown, hasher: Hasher): Slice {
  return { eid, fieldPath, start: null, end: null, contentHash: hasher.sha256(utf8(canonicalJSON(value))), class: "O", sens: "S1" };
}

/** The full Evidence record for one revision. `logicalId` and `revisionOf` are the caller's. */
export function bankEvidence(eid: string, logicalId: string, revisionOf: string | null, c: BankRowContent, ctx: BankRowContext): Evidence {
  const { hasher } = ctx;
  const o = c.observation;
  const now = tsFromMs(ctx.opsNow);
  return {
    ...cFields(ctx.uid, now, ctx.epoch, ctx.policyRev),
    logicalId,
    revisionOf,
    sanitizedFrom: null,
    source: "plaid",
    providerKey: o.providerKey,
    providerRevision: null,
    connectorId: ctx.connectorId,
    generation: ctx.generation,
    threadKey: null,
    inReplyToProviderKey: null,
    closureProofs: [],
    kind: "transaction",
    status: "retained",
    isCurrentProvider: true,
    occurredAt: c.occurredAt,
    assertedAt: c.assertedAt,
    receivedAt: now,
    zone: null,
    fieldSlices: [
      buildSlice({ eid, fieldPath: "title", fieldText: c.title, start: 0, end: c.title.length, class: "O", sens: "S1" }, hasher),
      typedSlice(eid, "bank.amount", { amountCents: o.amountCents, currency: o.currency }, hasher),
      typedSlice(eid, "bank.status", { pending: o.pending, removed: o.removed, category: o.category }, hasher),
      typedSlice(eid, "bank.purchaseAt", o.purchaseAt, hasher),
      ...(c.categoryCode === null ? [] : [buildSlice({ eid, fieldPath: "description", fieldText: c.categoryCode, start: 0, end: c.categoryCode.length, class: "O", sens: "S1" }, hasher)]),
    ],
    body: null,
    bodyOwn: null,
    bodyQuoted: null,
    subject: null,
    title: c.title,
    description: c.categoryCode === null ? null : { kind: "inline", text: c.categoryCode },
    text: null,
    sender: null,
    recipient: [],
    observation: o,
    authorId: null,
    senderAddressKey: null,
    recipientAddressKeys: [],
    authorship: "imported",
    delivery: "unknown",
    senderAuth: "unknown",
    identityBinding: "none",
    route: "unknown",
    sessionId: null,
    turnId: null,
    itemIds: [],
    transcriptState: "complete",
    transcriptDeadline: null,
    controlTurn: false,
    extractPacketMode: "source",
    parserVersion: BANK_PARSER_VERSION,
    copyRootKey: null,
    replacedProviderKey: null,
    sanitizeMap: [],
    purgedAt: null,
  };
}
