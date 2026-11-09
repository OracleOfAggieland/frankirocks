// Maps a contracts §1 `forgetReceipt` payload to Receipt props (lab-ui-foundation R16.6, R16.7;
// design contract question 7). Pure. Only kinds and counts cross over, never item text.
// `scopePending` adds no line: per contracts §8 it is handled by an ask card.
import type { ReceiptKind, ReceiptProps } from "./surface-props";

/** The `forgetReceipt` fields this mapping reads. */
export interface ForgetReceiptPayload {
  blockedAt: unknown | null;
  cleanupCompleteAt: unknown | null;
  retainedRuleIds: readonly string[];
  scopePending: boolean;
  touched: readonly { collection: string; count: number }[];
}

/** The fixed client map from store collection (SC) to a plain kind label. */
export const COLLECTION_KIND: Readonly<Record<string, ReceiptKind>> = {
  turns: "conversation turns",
  sessions: "conversation turns",
  memories: "memories",
  evidence: "sources",
  chunks: "sources",
};

export const KIND_ORDER: readonly ReceiptKind[] = ["conversation turns", "memories", "sources", "other records"];

const count = (n: number) => (Number.isInteger(n) && n > 0 ? n : 0);

export function receiptFrom(payload: ForgetReceiptPayload): ReceiptProps {
  const totals = new Map<ReceiptKind, number>();
  for (const t of payload.touched) {
    const kind = Object.hasOwn(COLLECTION_KIND, t.collection) ? COLLECTION_KIND[t.collection] : "other records";
    totals.set(kind, (totals.get(kind) ?? 0) + count(t.count));
  }
  const kept = payload.retainedRuleIds.length;
  return {
    blocked: payload.blockedAt !== null && payload.blockedAt !== undefined,
    cleaned: payload.cleanupCompleteAt !== null && payload.cleanupCompleteAt !== undefined,
    kept: kept > 0 ? [{ kind: "safety rule", count: kept }] : [],
    touched: KIND_ORDER.filter((k) => (totals.get(k) ?? 0) > 0).map((kind) => ({ kind, count: totals.get(kind)! })),
  };
}
