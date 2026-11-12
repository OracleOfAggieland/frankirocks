/**
 * A Proactive shown on the screen (brief 030 part A). With no call open, the line a typed session's open returns is
 * shown as text, and the browser says so with two receipts under its Permit: `admitted` (the line went out) and
 * `pendingRendered` naming its moment (the line is on the screen). The server records an offer as shown only from
 * these, never from its own choice, so a later yes can act on the offer the owner saw. Each receipt is sent once;
 * a failed send leaves the offer unshown, and a yes to it is asked again (fails closed).
 */
import type { Proactive } from "@franki/core";
import type { ApiClient } from "./api";

export const SHOWN_RECEIPT_TIMEOUT_MS = 5_000;

/** The response ID a shown line is admitted on: one per Proactive turn. */
export const shownResponseId = (p: Proactive): string => `shown_${p.turnId}`;

export async function confirmShown(api: ApiClient, p: Proactive, newId: () => string): Promise<boolean> {
  const base = { stamp: p.permit.stamp, responseId: shownResponseId(p), momentIds: p.permit.momentIds, noteIds: p.permit.noteIds, pendingId: null, text: null };
  const admitted = await api.call<unknown>("/api/receipt", { body: { ...base, requestId: newId(), kind: "admitted", permitKind: p.permit.kind }, timeoutMs: SHOWN_RECEIPT_TIMEOUT_MS });
  if (!admitted.ok) return false;
  const shown = await api.call<unknown>("/api/receipt", { body: { ...base, requestId: newId(), kind: "pendingRendered", permitKind: null }, timeoutMs: SHOWN_RECEIPT_TIMEOUT_MS });
  return shown.ok;
}
