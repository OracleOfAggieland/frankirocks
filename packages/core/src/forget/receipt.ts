/**
 * The forget receipt and the scope card's data, pure (contracts §1 ledger `forgetReceipt`; spec §8; brief 021).
 * Data only: counts and neutral, typed labels. No words: copy lives in `apps/web/src/ui/copy.ts` when the screen
 * work lands. `blockedAt` stays null until resume (reserved) sets it, and `cleanupCompleteAt` until purge does, so
 * nothing built here reports a forget as done.
 */
import type { ID, MemoryKind, SC } from "../schema/primitives";
import type { Ledger } from "../schema/records";
import type { InstallPlan } from "./install";

export type ForgetReceiptPayload = Extract<Ledger, { kind: "forgetReceipt" }>["payload"];

/** Contracts §1: `touched` holds at most 32 rows, `retainedRuleIds` at most 32. */
const TOUCHED_MAX = 32;
const RETAINED_MAX = 32;

export function receiptPayload(opId: ID, plan: InstallPlan | null, scopePending: boolean): ForgetReceiptPayload {
  return {
    opId,
    blockedAt: null,
    cleanupCompleteAt: null,
    retainedRuleIds: (plan?.retainedRuleIds ?? []).slice(0, RETAINED_MAX),
    scopePending,
    touched: (plan?.touched ?? []).slice(0, TOUCHED_MAX).map((t): { collection: SC; count: number } => ({ collection: t.collection, count: t.count })),
    // Withdrawal of non-target outputs is closure's (reserved); install withdraws nothing.
    withdrawnCount: 0,
  };
}

/** What the receipt says, as data: what was blocked, cleaned, touched, and what withdrew. */
export interface ReceiptSummary {
  blocked: number;
  cleaned: number;
  touched: { collection: SC; count: number }[];
  withdrawn: number;
  keptRules: number;
  pendingRules: number;
}

export function receiptSummary(plan: InstallPlan): ReceiptSummary {
  const count = (c: SC) => plan.touched.find((t) => t.collection === c)?.count ?? 0;
  return {
    blocked: count("blocks") + count("overlays"),
    cleaned: plan.sanitizedEids.length,
    touched: plan.touched,
    withdrawn: 0,
    keptRules: plan.retainedRuleIds.length - plan.pendingRuleIds.length,
    pendingRules: plan.pendingRuleIds.length,
  };
}

/** One option on the scope card: no content, only what kind of thing and when it was said. */
export interface ScopeOption {
  ordinal: number;
  optionId: ID;
  kind: MemoryKind;
  /** YYYY-MM-DD. */
  saidOn: string;
}

export type ScopeReason = "which" | "vague" | "fragment" | "incomplete" | "none" | "invalid" | "protectedRule";

export interface ScopeCard {
  opId: ID;
  reason: ScopeReason;
  options: ScopeOption[];
}

/** Contracts §5 ForgetResolveV1: a clarification offers 1 to 4 options. */
export const SCOPE_OPTIONS_MAX = 4;
