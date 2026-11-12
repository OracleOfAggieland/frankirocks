/**
 * The receipt route's moment seams (brief 030 P1-6; brief 023 report, "Seams"). One call from `routes/receipt.ts`,
 * inside its transaction, after the stamp check:
 *
 *   - `admitted` under a `proactive` Permit: each leased moment it names is admitted on that response.
 *   - `playbackStarted` and `cancelled` (brief 036 finding 14): each admitted moment it names records its playback
 *     start, or is ended by a cancel before it was said.
 *   - `transcript`: each moment it names gets `saidAt` only if it was admitted on this response and the words match
 *     (`recordSaid`, with its ledger `delivery` row). No row, no claim.
 *   - `pendingRendered`: the offer is recorded as shown, so a later yes may act on it.
 *
 * Brief 030 part A adds what playback and a matched transcript mean for the moment's own record:
 *
 *   - an offer that starts playing is shown (`pendingRendered` for its pending ID). The hero offer's pending ID is
 *     data for the server, never words for the model: it is recomputed from the rows now, and written only when the
 *     offer's line is still the one the moment rendered (fails closed: a changed offer is not shown);
 *
 * Ruling (fails closed): only a `proactive` Permit admits a moment, since moments travel only under one
 * (`time/proactive.ts`); the delivery row of a matched transcript names that kind.
 */
import { type ClockPort, type Hasher, type ID, type Infer, type Moment, type ReceiptRequest, falseGone } from "@franki/core";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { getMoment } from "../time/verdict";
import { heroOffer } from "./tool-food";
import type { RouteContext } from "./runtime";
import { recordPendingRendered } from "../time/reminder";
import { admitMoments, recordPlayback, recordSaid } from "../time/said";

export const MOMENT_PERMIT_KIND = "proactive" as const;

export async function receiptMoments(tx: Tx, ctx: RouteContext, req: Infer<typeof ReceiptRequest>, opsNow: number): Promise<void> {
  const { uid, deps } = ctx;
  const ids = req.momentIds as ID[];
  if (req.kind === "admitted" && req.permitKind === MOMENT_PERMIT_KIND) await admitMoments(tx, uid, ids, { responseId: req.responseId, noteIds: req.noteIds }, deps);
  // Brief 036 finding 14: a playback start is recorded, and a cancel before the line was said ends the moment.
  else if (req.kind === "playbackStarted" || req.kind === "cancelled") {
    for (const id of new Set(ids)) {
      const before = req.kind === "playbackStarted" ? await getMoment(tx, paths.moment(uid, id)) : null;
      const played = await recordPlayback(tx, uid, id, { kind: req.kind, responseId: req.responseId }, deps.clock);
      if (played && before !== null) await offerShown(tx, ctx, before.data, opsNow);
    }
  } else if (req.kind === "transcript") {
    const receipt = { kind: req.kind, responseId: req.responseId, momentIds: req.momentIds, noteIds: req.noteIds, text: req.text };
    for (const id of new Set(ids)) await recordSaid(tx, uid, id, receipt, MOMENT_PERMIT_KIND, deps.clock, deps.hasher);
  } else if (req.kind === "pendingRendered" && req.pendingId !== null) await recordPendingRendered(tx, uid, req.pendingId as ID, opsNow, deps.hasher);
}

/** The pending ID of the offer a moment plays, or null. The hero's is recomputed and must match the rendered line. */
export async function shownPendingId(ctx: RouteContext, m: Moment): Promise<ID | null> {
  if (m.payload.kind === "offer" || m.payload.kind === "ask") return m.payload.pendingId as ID;
  if (m.payload.kind !== "pattern" || m.rendered === null) return null;
  const offer = await heroOffer(ctx, 0);
  return offer !== null && offer.line === m.rendered.text ? (offer.pendingId as ID) : null;
}

async function offerShown(tx: Tx, ctx: RouteContext, m: Moment, opsNow: number): Promise<void> {
  const pendingId = await shownPendingId(ctx, m);
  if (pendingId !== null) await recordPendingRendered(tx, ctx.uid, pendingId, opsNow, ctx.deps.hasher);
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
