/**
 * A Proactive shown on the screen (brief 030 part A). With no call open, the line a typed session's open returns is
 * shown as text, and the browser says so with two receipts under its Permit: `admitted` (the line went out) and
 * `pendingRendered` naming its moment (the line is on the screen). The server records an offer as shown only from
 * these, never from its own choice. Each receipt is sent once.
 *
 * Brief 045 finding 7: the screen has no way to answer a line, so it shows and admits only lines that need no
 * answer. A line that asks for one (`asks`, the hero offer or a question) is neither shown nor receipted, and stays
 * for a call; a line with no `asks` field is treated as asking (fails closed). The server never counts a screen's
 * `pendingRendered` as a showing either.
 */
import type { Proactive } from "@franki/core";
import type { ApiClient } from "./api";

export const SHOWN_RECEIPT_TIMEOUT_MS = 5_000;

/** The response ID a shown line is admitted on: one per Proactive turn. */
export const shownResponseId = (p: Proactive): string => `shown_${p.turnId}`;

/** Whether a typed open's line may go on the screen: only one that needs no answer. */
export const showsOnScreen = (p: Proactive): boolean => "asks" in p && p.asks === false;

export async function confirmShown(api: ApiClient, p: Proactive, newId: () => string): Promise<boolean> {
  const base = { stamp: p.permit.stamp, responseId: shownResponseId(p), momentIds: p.permit.momentIds, noteIds: p.permit.noteIds, pendingId: null, text: null };
  const admitted = await api.call<unknown>("/api/receipt", { body: { ...base, requestId: newId(), kind: "admitted", permitKind: p.permit.kind }, timeoutMs: SHOWN_RECEIPT_TIMEOUT_MS });
  if (!admitted.ok) return false;
  const shown = await api.call<unknown>("/api/receipt", { body: { ...base, requestId: newId(), kind: "pendingRendered", permitKind: null }, timeoutMs: SHOWN_RECEIPT_TIMEOUT_MS });
  return shown.ok;
}
