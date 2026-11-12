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
import { type CoreCounters, type Hasher, type ID, type Ledger, type Memory, type Moment, type PermitKind, type SaidReceipt, civilDateAt, capLimit, countDelivery, isHeavy, isMustSay, msFromTs, todayCounts, saidTargetOf, saidUpdate, tsFromMs } from "@franki/core";
import { ownerClock, readCoreDocs } from "../core-docs";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { ClockPort } from "@franki/core";
import type { Tx } from "../store/port";
import { getMoment, momentNoteId, momentVerdict } from "./verdict";

export const deliveryEntryId = (hasher: { id(parts: unknown): string }, momentId: string, responseId: string): ID => hasher.id(["delivery", momentId, responseId]) as ID;

/** The receipt's admission: its response and the note IDs it names (the permit's). */
export interface MomentAdmission {
  responseId: string;
  noteIds: readonly string[];
}

/**
 * Admits a leased moment on `admission.responseId`. Returns false, and writes nothing, unless the moment is leased
 * under a lease that still holds, the receipt names the note issued for that lease and generation, a reread of the
 * source says `ok`, and today's caps allow it. One rule with `admitMoments`, which it calls.
 */
export async function admitMoment(tx: Tx, uid: string, momentId: ID, admission: MomentAdmission, deps: { clock: ClockPort; hasher: Hasher }): Promise<boolean> {
  return (await admitMoments(tx, uid, [momentId], admission, deps)).length === 1;
}

/**
 * Brief 030 P1-6: admits every leased moment a receipt names, in one transaction, writing `core/counters` once (a
 * store refuses a record written twice in one transaction, and two `admitMoment` calls would each count from the
 * same stale counters). Returns the IDs admitted. Under a barrier nothing is admitted.
 *
 * Brief 036 findings 1, 2 and 5, for each moment, in this transaction: the lease still holds, the receipt names the
 * note issued for the current lease and generation (`momentNoteId`), the source rereads `ok` with the tick's verdict
 * (`momentVerdict`), and the day's caps, counted on from the moments admitted before it in this receipt, allow it
 * unless it is mustSay or carries a verified override (`capLimit`). A moment that fails any of these is skipped.
 */
export async function admitMoments(tx: Tx, uid: string, momentIds: readonly ID[], admission: MomentAdmission, deps: { clock: ClockPort; hasher: Hasher }): Promise<ID[]> {
  const { clock } = deps;
  const ids = [...new Set(momentIds)];
  if (ids.length === 0) return [];
  const core = await readCoreDocs(tx, uid);
  if (core.epoch.data.barrier !== null) return [];
  const pair = ownerClock(core.state.data, clock);
  const ops = pair.opsClock.now;
  const day = civilDateAt(pair.worldClock.now, pair.worldClock.zone);
  let counters: CoreCounters = core.counters.data;
  const admitted: ID[] = [];
  for (const momentId of ids) {
    const doc = await getMoment(tx, paths.moment(uid, momentId));
    if (doc === null || doc.data.status !== "leased") continue;
    const m = doc.data;
    if (m.leaseUntil === null || msFromTs(m.leaseUntil) <= ops) continue;
    if (!admission.noteIds.includes(momentNoteId(deps.hasher, momentId, m))) continue;
    if ((await momentVerdict(tx, uid, m, core, clock, { rollupLive: null })) !== "ok") continue;
    const source = m.memoryId === null ? null : await tx.get<Memory>(paths.memory(uid, m.memoryId));
    const heavy = isHeavy(m.kind, source?.data.gravity ?? 0);
    const override = m.deliveryOverride === null ? null : { quietHours: m.deliveryOverride.quietHours, caps: m.deliveryOverride.caps };
    const candidate = { heavy, mustSay: isMustSay(m.kind, msFromTs(m.dueAt), pair.worldClock.now), override };
    if (capLimit(candidate, todayCounts(counters, day)) !== null) continue;
    tx.update(doc.path, { ...m, status: "admitted", admittedAt: tsFromMs(ops), responseId: admission.responseId, leaseToken: null, leaseUntil: null, updatedAt: tsFromMs(ops) });
    counters = countDelivery(counters, day, heavy);
    admitted.push(momentId);
  }
  if (admitted.length > 0) tx.update(paths.core(uid, "counters"), { ...counters, updatedAt: tsFromMs(ops) });
  return admitted;
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
  const doc = await getMoment(tx, paths.moment(uid, momentId));
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

/**
 * The receipt seam for playback (brief 036 finding 14), inside the receipt's transaction, for each moment a
 * `playbackStarted` or `cancelled` receipt names. A moment admitted on that response and not yet said:
 *
 *   playbackStarted  records `playbackAt` (ops time), once;
 *   cancelled        ends it: `cancelled`, reason `closed`. Its line was cut before it was said, so nothing later
 *                    on that response can say it, and it is not offered again. A cancel naming a moment still
 *                    leased (it came before the admission) ends the lease instead.
 *
 * Returns true when it wrote. Anything else writes nothing.
 */
export async function recordPlayback(tx: Tx, uid: string, momentId: ID, receipt: Pick<SaidReceipt, "kind" | "responseId">, clock: ClockPort): Promise<boolean> {
  if (receipt.kind !== "playbackStarted" && receipt.kind !== "cancelled") return false;
  const doc = await getMoment(tx, paths.moment(uid, momentId));
  if (doc === null) return false;
  const m = doc.data;
  const now = tsFromMs(clock.read().opsClock.now);
  // A cancel that arrives before the admission: the lease ends, so the note put out under it never admits; the
  // tick may open the moment again under a new lease (fails closed: a cut line is never said).
  if (receipt.kind === "cancelled" && m.status === "leased") {
    tx.update(doc.path, { ...m, status: "pending", leaseToken: null, leaseUntil: null, rendered: null, attempts: m.attempts + 1, updatedAt: now });
    return true;
  }
  if (m.status !== "admitted" || m.responseId !== receipt.responseId || m.saidAt !== null) return false;
  if (receipt.kind === "playbackStarted") {
    if (m.playbackAt !== null) return false;
    tx.update(doc.path, { ...m, playbackAt: now, updatedAt: now });
    return true;
  }
  tx.update(doc.path, { ...m, status: "cancelled", cancelReason: "closed", updatedAt: now });
  return true;
}
