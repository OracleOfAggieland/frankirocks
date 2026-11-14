/**
 * Brief 049 part A, review fixes V2 and V11: what the receipt route does with an Errand's line. One call from
 * `routes/receipt.ts`, inside its transaction, after the stamp check and before the transcript's Turn is written.
 *
 *   - V2: a receipt that names an offer of a waiting Errand of this Session (any attempt so far, by its note ID) and
 *     says the line went out (`admitted`, `playbackStarted`, `playbackEnded` or `transcript`) moves it to
 *     `delivered`, once, and records the response. A `cancelled` receipt delivers nothing, so the result is offered
 *     again after its offer expires.
 *   - V11: a transcript of that response is the line heard: its assistant Turn takes the offered line's own class
 *     and sensitivity (so a third party's line never becomes one of the Deck's safe turns), and its `said` row is
 *     written by the matcher (no match, no row).
 */
import { type Class, type Errand, type GateResult, type ID, type Infer, type ReceiptRequest, type Sens, type Session, errandWaiting, nextErrandStatus, tsFromMs } from "@franki/core";
import { gateAudience } from "../audience";
import { writeSaid } from "../ledger/said";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { errandOfferNoteId } from "./deliver";

type Receipt = Infer<typeof ReceiptRequest>;

/** The kinds that show the line went out to the owner. */
const SENT_KINDS: readonly Receipt["kind"][] = ["admitted", "playbackStarted", "playbackEnded", "transcript"];

/** An Errand line a transcript receipt heard: what its Turn and its said row take. */
export interface ErrandHeard {
  errandId: ID;
  rev: number;
  noteId: ID;
  text: string;
  cls: Class;
  sens: Sens;
}

/** Delivers an Errand whose offer this receipt names, and returns the line a transcript heard, or null. */
export async function errandReceipt(tx: Tx, ctx: RouteContext, req: Receipt, opsNow: number): Promise<ErrandHeard | null> {
  const { uid, deps } = ctx;
  let heard: ErrandHeard | null = null;
  for (const id of new Set(req.momentIds)) {
    const doc = await tx.get<Errand>(paths.errand(uid, id));
    if (doc === null || doc.data.sessionId !== req.stamp.sessionId || doc.data.offer === null) continue;
    const e = doc.data;
    const offer = e.offer!;
    const noteId = Array.from({ length: offer.attempt }, (_, k) => errandOfferNoteId(deps.hasher, id, k + 1)).find((n) => req.noteIds.includes(n));
    if (noteId === undefined) continue;
    let written = e;
    if (errandWaiting(e.status) && SENT_KINDS.includes(req.kind)) {
      const next = nextErrandStatus(e.status, "delivered");
      if (next !== null) {
        const now = tsFromMs(opsNow);
        written = { ...e, status: next, saidResponseId: req.responseId, endedAt: now, updatedAt: now };
        tx.update(doc.path, written);
      }
    }
    if (req.kind === "transcript" && written.status === "delivered" && written.saidResponseId === req.responseId && written.offer !== null) {
      heard = { errandId: id as ID, rev: doc.data.rev, noteId, text: written.offer.text, cls: written.offer.cls, sens: written.offer.sens };
    }
  }
  return heard;
}

/** V11: the `said` row for an Errand's line heard in a transcript. The matcher decides; no match, no row. */
export async function errandSaidRow(tx: Tx, ctx: RouteContext, req: Receipt, heard: ErrandHeard, core: { epoch: number; policyRev: number }, opsNow: number): Promise<void> {
  if (req.kind !== "transcript") return;
  const { uid, deps } = ctx;
  const session = await tx.get<Session>(paths.session(uid, req.stamp.sessionId));
  const audience = session === null ? "unknown" : gateAudience(session.data, opsNow).audience;
  const said: GateResult = { verdict: "say", form: null, render: "free", carveOut: null, mustSay: null, fixedLine: null, reasons: ["ok"], candidateId: heard.errandId, sens: null };
  const at = { uid, now: tsFromMs(opsNow), epoch: core.epoch, policyRev: core.policyRev };
  const row = { candidateId: heard.errandId, refs: [{ type: "job" as const, id: heard.errandId, rev: 1 }], noteIds: [heard.noteId], momentId: heard.errandId, sessionId: req.stamp.sessionId as ID, turnId: req.stamp.turnId as ID, audience, permitKind: "proactive" as const };
  const receipt = { kind: req.kind, responseId: req.responseId, momentIds: req.momentIds, noteIds: req.noteIds, text: req.text };
  await writeSaid(tx, deps.hasher, at, said, row, { receipt, note: { noteId: heard.noteId, text: heard.text, momentId: heard.errandId } });
}
