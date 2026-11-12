/**
 * The receipt route's moment seams (brief 030 P1-6; brief 023 report, "Seams"). One call from `routes/receipt.ts`,
 * inside its transaction, after the stamp check:
 *
 *   - `admitted` under a `proactive` Permit: each leased moment it names is admitted on that response.
 *   - `playbackStarted` and `cancelled` (brief 036 finding 14): each admitted moment it names records its playback
 *     start, or is ended by a cancel before it was said.
 *   - `transcript`: each moment it names gets `saidAt` only if it was admitted on this response and the words match
 *     (`recordSaid`, with its ledger `delivery` row). No row, no claim.
 *   - `pendingRendered`: records nothing (brief 045 finding 12). Its pending ID is the client's word, so it is never
 *     a showing; the offer is shown only where the server's own render is played (below).
 *
 * Brief 045 finding 12: every receipt counts only for a moment rendered for this receipt's Session (`sentHere`,
 * from the Session ID the render recorded). Finding 7: a receipt from the screen (`SCREEN_RESPONSE_PREFIX`) admits
 * no moment that asks for an answer, so an offer shown on a typed open is not used up and stays for a call.
 *
 * Brief 030 part A adds what playback and a matched transcript mean for the moment's own record:
 *
 *   - a `celebrate` moment said moves its loop from `eligible` to `celebrated` (`markCelebrated`);
 *   - brief 042 item 5: a transcript of a response that admitted a moment's whisper writes its Gate `said` row
 *     (`writeSaid`, whose matcher decides; no match, no row; one row per turn and note, so never twice);
 *   - an offer whose playback ended uncut or whose transcript matched is shown (`recordShowing`, per Session; a cancel revokes it). The hero offer's pending ID is
 *     data for the server, never words for the model: it is recomputed from the rows now, and written only when the
 *     offer's line is still the one the moment rendered (fails closed: a changed offer is not shown);
 *
 * Ruling (fails closed): only a `proactive` Permit admits a moment, since moments travel only under one
 * (`time/proactive.ts`); the delivery row of a matched transcript names that kind.
 */
import { type GateResult, type ID, type Infer, type Memory, type Moment, type ReceiptRequest, type Session, falseGone, markCelebrated, tsFromMs } from "@franki/core";
import { gateAudience } from "../audience";
import { readCoreDocs } from "../core-docs";
import { writeSaid } from "../ledger/said";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { getMoment } from "../time/verdict";
import { asksForAnswer } from "../time/proactive";
import { heroOffer } from "./tool-food";
import type { RouteContext } from "./runtime";
import { recordShowing, revokeShowing } from "../time/reminder";
import { admitMoments, recordPlayback, recordSaid } from "../time/said";

export const MOMENT_PERMIT_KIND = "proactive" as const;
/**
 * Brief 045 finding 7: the response IDs a typed screen admits its lines on (`shown_<turnId>`, the browser's
 * `shownResponseId`). A call's responses are the voice model's (`resp_…`). Ruling: an admission on a screen response
 * never admits a line that asks for an answer, whatever the client shows.
 */
export const SCREEN_RESPONSE_PREFIX = "shown_";

export async function receiptMoments(tx: Tx, ctx: RouteContext, req: Infer<typeof ReceiptRequest>, opsNow: number): Promise<void> {
  const { uid, deps } = ctx;
  const ids = req.momentIds as ID[];
  // Brief 042 item 1: each offer is recorded as shown at most once per receipt, per Session. Brief 045 finding 6: an
  // offer is shown when its playback ended uncut or its transcript matched (once per response), and a cancel
  // revokes its latest showing in this Session.
  const shown = new Set<ID>();
  const show = async (pendingId: ID): Promise<void> => {
    if (shown.has(pendingId)) return;
    shown.add(pendingId);
    await recordShowing(tx, uid, pendingId, req.stamp.sessionId, opsNow, deps.hasher, req.responseId);
  };
  const revoke = async (pendingId: ID): Promise<void> => {
    if (shown.has(pendingId)) return;
    shown.add(pendingId);
    await revokeShowing(tx, uid, pendingId, req.stamp.sessionId, opsNow, deps.hasher);
  };
  // Brief 045 finding 12: every receipt below counts only for a moment rendered for this Session.
  const sent = async (id: ID) => {
    const doc = await getMoment(tx, paths.moment(uid, id));
    return doc !== null && sentHere(doc.data, req.stamp.sessionId) ? doc : null;
  };
  if (req.kind === "admitted" && req.permitKind === MOMENT_PERMIT_KIND) {
    // Brief 045 finding 7: the screen's receipt admits no line that asks for an answer; it stays for a call.
    const screen = req.responseId.startsWith(SCREEN_RESPONSE_PREFIX);
    const admissible: ID[] = [];
    for (const id of new Set(ids)) {
      const doc = await sent(id);
      if (doc !== null && !(screen && asksForAnswer(doc.data))) admissible.push(id);
    }
    await admitMoments(tx, uid, admissible, { responseId: req.responseId, noteIds: req.noteIds }, deps);
  }
  // Brief 036 finding 14: a playback start is recorded, and a cancel before the line was said ends the moment.
  else if (req.kind === "playbackStarted" || req.kind === "cancelled") {
    for (const id of new Set(ids)) {
      const here = await sent(id);
      if (here === null) continue;
      const before = req.kind === "cancelled" ? here : null;
      // The moment as it stood before the cancel, for the offer it carried.
      const pendingId = before === null ? null : await shownPendingId(ctx, before.data);
      await recordPlayback(tx, uid, id, { kind: req.kind, responseId: req.responseId }, deps.clock);
      if (pendingId !== null && before!.data.responseId === req.responseId) await revoke(pendingId);
    }
  } else if (req.kind === "playbackEnded") {
    // Brief 045 finding 6: played to the end, uncut, on this response.
    for (const id of new Set(ids)) {
      const doc = await sent(id);
      if (doc === null || doc.data.responseId !== req.responseId || doc.data.playbackAt === null) continue;
      if (doc.data.status === "admitted" || doc.data.status === "delivered") await offerShown(ctx, doc.data, show);
    }
  } else if (req.kind === "transcript") {
    const receipt = { kind: req.kind, responseId: req.responseId, momentIds: req.momentIds, noteIds: req.noteIds, text: req.text };
    for (const id of new Set(ids)) {
      const before = await sent(id);
      if (before === null) continue;
      const pendingId = await shownPendingId(ctx, before.data);
      const match = await recordSaid(tx, uid, id, receipt, MOMENT_PERMIT_KIND, deps.clock, deps.hasher);
      if (before !== null) await saidRow(tx, ctx, req, id, before.data, opsNow);
      if (match !== null && before !== null) await celebrated(tx, uid, before.data, opsNow);
      if (match !== null && pendingId !== null) await show(pendingId);
    }
  }
  // Brief 045 findings 7 and 12: a `pendingRendered` receipt (a line on the screen) is never a showing. A screen shows
  // no line that asks for an answer, and a client-sent pending ID names nothing the server sent. An offer is shown
  // only by its playback ending uncut or its transcript matching, in a call.
}

/** Brief 045 finding 12: the moment was rendered for this Session, so a Permit issued to it carried the moment. */
export const sentHere = (m: Moment, sessionId: string): boolean => m.rendered !== null && "sessionId" in m.rendered && m.rendered.sessionId === sessionId;

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

/**
 * Brief 042 item 5: the `said` row for a moment's whisper heard on the response that admitted it. The Gate result is
 * the one delivery acted on: the line went out under a `proactive` Permit only after a `say` (`chooseNow`), so it is
 * recorded as that `say` (ruling: no stored result is read back). The row's turn is the line's own (the Permit's).
 */
async function saidRow(tx: Tx, ctx: RouteContext, req: Infer<typeof ReceiptRequest>, momentId: ID, m: Moment, opsNow: number): Promise<void> {
  if (req.kind !== "transcript" || m.rendered === null || m.responseId !== req.responseId || m.admittedAt === null) return;
  if (!req.noteIds.includes(m.rendered.noteId)) return;
  const { uid, deps } = ctx;
  const core = await readCoreDocs(tx, uid);
  const session = await tx.get<Session>(paths.session(uid, req.stamp.sessionId));
  const audience = session === null ? "unknown" : gateAudience(session.data, opsNow).audience;
  const said: GateResult = { verdict: "say", form: null, render: "free", carveOut: null, mustSay: null, fixedLine: null, reasons: ["ok"], candidateId: momentId, sens: null };
  const at = { uid, now: tsFromMs(opsNow), epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev };
  const row = { candidateId: momentId, refs: [{ type: "moment" as const, id: momentId, rev: m.rev }], noteIds: [m.rendered.noteId as ID], momentId, sessionId: req.stamp.sessionId as ID, turnId: req.stamp.turnId as ID, audience, permitKind: MOMENT_PERMIT_KIND };
  const receipt = { kind: req.kind, responseId: req.responseId, momentIds: req.momentIds, noteIds: req.noteIds, text: req.text };
  await writeSaid(tx, deps.hasher, at, said, row, { receipt, note: { noteId: m.rendered.noteId as ID, text: m.rendered.text, momentId } });
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
