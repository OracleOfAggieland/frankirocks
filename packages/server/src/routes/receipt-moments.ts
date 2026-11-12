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
 *   - a `celebrate` moment said moves its loop from `eligible` to `celebrated` (`markCelebrated`);
 *   - an offer that starts playing, or a `pendingRendered` receipt naming its moment (shown on the screen), is shown (`pendingRendered` for its pending ID). The hero offer's pending ID is
 *     data for the server, never words for the model: it is recomputed from the rows now, and written only when the
 *     offer's line is still the one the moment rendered (fails closed: a changed offer is not shown);
 *
 * Ruling (fails closed): only a `proactive` Permit admits a moment, since moments travel only under one
 * (`time/proactive.ts`); the delivery row of a matched transcript names that kind.
 */
import { type ClockPort, type Hasher, type ID, type Infer, type Memory, type Moment, type ReceiptRequest, falseGone, markCelebrated, tsFromMs } from "@franki/core";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { getMoment } from "../time/verdict";
import { heroOffer } from "./tool-food";
import type { RouteContext } from "./runtime";
import { recordShowing } from "../time/reminder";
import { admitMoments, recordPlayback, recordSaid } from "../time/said";

export const MOMENT_PERMIT_KIND = "proactive" as const;

export async function receiptMoments(tx: Tx, ctx: RouteContext, req: Infer<typeof ReceiptRequest>, opsNow: number): Promise<void> {
  const { uid, deps } = ctx;
  const ids = req.momentIds as ID[];
  // Brief 042 item 1: each offer is recorded as shown at most once per receipt.
  const shown = new Set<ID>();
  const show = async (pendingId: ID): Promise<void> => {
    if (shown.has(pendingId)) return;
    shown.add(pendingId);
    await recordShowing(tx, uid, pendingId, req.stamp.sessionId, opsNow, deps.hasher);
  };
  if (req.kind === "admitted" && req.permitKind === MOMENT_PERMIT_KIND) await admitMoments(tx, uid, ids, { responseId: req.responseId, noteIds: req.noteIds }, deps);
  // Brief 036 finding 14: a playback start is recorded, and a cancel before the line was said ends the moment.
  else if (req.kind === "playbackStarted" || req.kind === "cancelled") {
    for (const id of new Set(ids)) {
      const before = req.kind === "playbackStarted" ? await getMoment(tx, paths.moment(uid, id)) : null;
      const played = await recordPlayback(tx, uid, id, { kind: req.kind, responseId: req.responseId }, deps.clock);
      if (played && before !== null) await offerShown(ctx, before.data, show);
    }
  } else if (req.kind === "transcript") {
    const receipt = { kind: req.kind, responseId: req.responseId, momentIds: req.momentIds, noteIds: req.noteIds, text: req.text };
    for (const id of new Set(ids)) {
      const before = await getMoment(tx, paths.moment(uid, id));
      const match = await recordSaid(tx, uid, id, receipt, MOMENT_PERMIT_KIND, deps.clock, deps.hasher);
      if (match !== null && before !== null) await celebrated(tx, uid, before.data, opsNow);
    }
  } else if (req.kind === "pendingRendered" && req.pendingId !== null) await show(req.pendingId as ID);
  else if (req.kind === "pendingRendered") {
    // Brief 030 part A: a line shown on the screen (a typed session's Proactive) names its moments, not a pending ID;
    // each one admitted on this response is shown, as a played one is.
    for (const id of new Set(ids)) {
      const doc = await getMoment(tx, paths.moment(uid, id));
      if (doc !== null && doc.data.status === "admitted" && doc.data.responseId === req.responseId) await offerShown(ctx, doc.data, show);
    }
  }
}

/** The pending ID of the offer a moment plays, or null. The hero's is recomputed and must match the rendered line. */
export async function shownPendingId(ctx: RouteContext, m: Moment): Promise<ID | null> {
  if (m.payload.kind === "offer" || m.payload.kind === "ask") return m.payload.pendingId as ID;
  if (m.payload.kind !== "pattern" || m.rendered === null) return null;
  const offer = await heroOffer(ctx, 0);
  return offer !== null && offer.line === m.rendered.text ? (offer.pendingId as ID) : null;
}

async function offerShown(ctx: RouteContext, m: Moment, show: (pendingId: ID) => Promise<void>): Promise<void> {
  const pendingId = await shownPendingId(ctx, m);
  if (pendingId !== null) await show(pendingId);
}

/** A `celebrate` moment said: its loop moves from `eligible` to `celebrated` (`markCelebrated`), in this transaction. */
async function celebrated(tx: Tx, uid: string, m: Moment, opsNow: number): Promise<void> {
  if (m.payload.kind !== "celebrate") return;
  const doc = await tx.get<Memory>(paths.memory(uid, m.payload.loopId));
  if (doc === null || doc.data.loop === null) return;
  const state = markCelebrated(doc.data.loop.state);
  if (state !== doc.data.loop.state) tx.update(doc.path, { ...doc.data, loop: { ...doc.data.loop, state }, updatedAt: tsFromMs(opsNow) });
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
