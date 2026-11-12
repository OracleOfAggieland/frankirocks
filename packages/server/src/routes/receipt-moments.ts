/**
 * The receipt route's moment seams (brief 030 P1-6; brief 023 report, "Seams"). One call from `routes/receipt.ts`,
 * inside its transaction, after the stamp check:
 *
 *   - `admitted` under a `proactive` Permit: each leased moment it names is admitted on that response.
 *   - `transcript`: each moment it names gets `saidAt` only if it was admitted on this response and the words match
 *     (`recordSaid`, with its ledger `delivery` row). No row, no claim.
 *   - `pendingRendered`: the offer is recorded as shown, so a later yes may act on it.
 *
 * Ruling (fails closed): only a `proactive` Permit admits a moment, since moments travel only under one
 * (`time/proactive.ts`); the delivery row of a matched transcript names that kind.
 */
import { type ClockPort, type Hasher, type ID, type Infer, type ReceiptRequest, falseGone } from "@franki/core";
import type { Tx } from "../store/port";
import { recordPendingRendered } from "../time/reminder";
import { admitMoments, recordSaid } from "../time/said";

export const MOMENT_PERMIT_KIND = "proactive" as const;

export async function receiptMoments(tx: Tx, uid: string, req: Infer<typeof ReceiptRequest>, opsNow: number, deps: { clock: ClockPort; hasher: Hasher }): Promise<void> {
  const ids = req.momentIds as ID[];
  if (req.kind === "admitted" && req.permitKind === MOMENT_PERMIT_KIND) await admitMoments(tx, uid, ids, { responseId: req.responseId, noteIds: req.noteIds }, deps);
  else if (req.kind === "transcript") {
    const receipt = { kind: req.kind, responseId: req.responseId, momentIds: req.momentIds, noteIds: req.noteIds, text: req.text };
    for (const id of new Set(ids)) await recordSaid(tx, uid, id, receipt, MOMENT_PERMIT_KIND, deps.clock, deps.hasher);
  } else if (req.kind === "pendingRendered" && req.pendingId !== null) await recordPendingRendered(tx, uid, req.pendingId as ID, opsNow, deps.hasher);
}

/**
 * Brief 030 P1-7 (brief 020, the false "gone" check on spoken words): an assistant transcript that claims something
 * is gone, forgotten, deleted or removed, with no forget receipt behind it, answers `controlCheck: "pending"`, and
 * the browser asks "Did you want that deleted?". No route writes a forget receipt yet (forget is unwired), so
 * every such claim asks: it fails closed.
 */
export const SPOKEN_FORGET_RECEIPT: string | null = null;

export function goneCheck(req: Infer<typeof ReceiptRequest>): "pending" | "none" {
  return req.kind === "transcript" && req.text !== null && falseGone([req.text], SPOKEN_FORGET_RECEIPT) ? "pending" : "none";
}
