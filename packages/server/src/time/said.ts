/**
 * The receipt route's seams for moments (brief 023 task 7; contracts §6 POST /api/receipt and `said`). Not called by
 * `routes/receipt.ts` yet (the writes lane owns it); the report names the exact calls.
 *
 *   `admitMoment`  on `kind:"admitted"` with the moment in `momentIds`: a leased moment becomes admitted on that
 *                  response, and the day's proactive count rises in `core/counters`. In the same transaction it
 *                  rereads the source with the tick's verdict and checks that the receipt's notes name the moment's
 *                  current lease and generation (brief 036 finding 1; contracts "Commit checks
 *                  epoch/policy/source/lease/generation/eligibility").
 *   `recordSaid`   on `kind:"transcript"`: sets `saidAt` only for a moment admitted on that response whose
 *                  transcript matches, and writes the ledger `delivery` row in the same transaction. No row, no claim.
 */
import { type CoreCounters, type Hasher, type ID, type Ledger, type Memory, type Moment, type PermitKind, type SaidReceipt, civilDateAt, countDelivery, isHeavy, msFromTs, saidTargetOf, saidUpdate, tsFromMs } from "@franki/core";
import { ownerClock, readCoreDocs } from "../core-docs";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { ClockPort } from "@franki/core";
import type { Tx } from "../store/port";
import { momentNoteId, momentVerdict } from "./verdict";

export const deliveryEntryId = (hasher: { id(parts: unknown): string }, momentId: string, responseId: string): ID => hasher.id(["delivery", momentId, responseId]) as ID;

/** The receipt's admission: its response and the note IDs it names (the permit's). */
export interface MomentAdmission {
  responseId: string;
  noteIds: readonly string[];
}

/**
 * Admits a leased moment on `admission.responseId`. Returns false, and writes nothing, unless the moment is leased
 * under a lease that still holds, the receipt names the note issued for that lease and generation, and a reread of
 * the source says `ok`.
 */
export async function admitMoment(tx: Tx, uid: string, momentId: ID, admission: MomentAdmission, deps: { clock: ClockPort; hasher: Hasher }): Promise<boolean> {
  const { clock } = deps;
  const doc = await tx.get<Moment>(paths.moment(uid, momentId));
  if (doc === null || doc.data.status !== "leased") return false;
  const core = await readCoreDocs(tx, uid);
  if (core.epoch.data.barrier !== null) return false;
  const pair = ownerClock(core.state.data, clock);
  const ops = pair.opsClock.now;
  if (doc.data.leaseUntil === null || msFromTs(doc.data.leaseUntil) <= ops) return false;
  if (!admission.noteIds.includes(momentNoteId(deps.hasher, momentId, doc.data))) return false;
  if ((await momentVerdict(tx, uid, doc.data, core, clock, { rollupLive: null })) !== "ok") return false;
  const responseId = admission.responseId;
  const source = doc.data.memoryId === null ? null : await tx.get<Memory>(paths.memory(uid, doc.data.memoryId));
  const heavy = isHeavy(doc.data.kind, source?.data.gravity ?? 0);
  tx.update(doc.path, { ...doc.data, status: "admitted", admittedAt: tsFromMs(ops), responseId, leaseToken: null, leaseUntil: null, updatedAt: tsFromMs(ops) });
  const counters: CoreCounters = countDelivery(core.counters.data, civilDateAt(pair.worldClock.now, pair.worldClock.zone), heavy);
  tx.update(paths.core(uid, "counters"), { ...counters, updatedAt: tsFromMs(ops) });
  return true;
}

/**
 * Records a transcript receipt against one moment. Returns the match when `saidAt` was set; null otherwise (saidAt
 * stays null). The moment and its ledger `delivery` row are written together.
 */
export async function recordSaid(
  tx: Tx,
  uid: string,
  momentId: ID,
  receipt: SaidReceipt,
  permitKind: PermitKind,
  clock: ClockPort,
  hasher: { id(parts: unknown): string },
): Promise<Moment["saidMatch"] | null> {
  const doc = await tx.get<Moment>(paths.moment(uid, momentId));
  if (doc === null) return null;
  const ops = clock.read().opsClock.now;
  const said = saidUpdate(doc.data, receipt, saidTargetOf(momentId, doc.data), ops);
  if (said === null) return null;
  const core = await readCoreDocs(tx, uid);
  const now = tsFromMs(ops);
  const entryId = deliveryEntryId(hasher, momentId, receipt.responseId);
  const entry: Extract<Ledger, { kind: "delivery" }> = {
    ...cFields(uid, now, core.epoch.data.epoch, core.epoch.data.policyRev),
    kind: "delivery",
    state: "complete",
    at: now,
    retainUntil: null,
    payload: { momentId, responseId: receipt.responseId, admittedAt: doc.data.admittedAt!, playbackAt: doc.data.playbackAt, permitKind, match: said.saidMatch },
  };
  if ((await tx.get(paths.ledger(uid, entryId))) === null) tx.create(paths.ledger(uid, entryId), entry);
  tx.update(doc.path, { ...doc.data, status: "delivered", saidAt: tsFromMs(said.saidAt), saidMatch: said.saidMatch, updatedAt: now });
  return said.saidMatch;
}
