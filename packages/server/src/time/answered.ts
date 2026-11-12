/**
 * Brief 042 item 2 (finding 2): an answered offer is closed. An offer answered yes or no, whether or not its line was
 * recorded as said, is not offered again: delivery skips it, and the tick cancels it with the answer as the reason
 * (`closed` for a yes, `declined` for a no).
 *
 * The answers read: a reminder offer's `makeReminder` action or its declined row (`time/reminder.ts`), the hero
 * offer's `makeList` action, and the hero's declined row, written here by the tool route when the owner says no.
 * The hero's pending ID is recomputed by the caller (`heroOffer`); when it can't be, a pattern moment reads as
 * unanswered, as it did before.
 */
import { type ID, type Ledger, type Moment, tsFromMs } from "@franki/core";
import { readCoreDocs } from "../core-docs";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { StoredDoc, Tx } from "../store/port";
import { declinedEntryId, reminderActionId } from "./reminder";

type Hasher = { id(parts: unknown): string };
type Get = (path: string) => Promise<StoredDoc<Ledger> | null>;

export type OfferAnswer = "closed" | "declined";

export const heroActionId = (hasher: Hasher, pendingId: string): ID => hasher.id(["heroAction", pendingId]) as ID;
export const heroDeclinedId = (hasher: Hasher, pendingId: string): ID => hasher.id(["heroDeclined", pendingId]) as ID;

/** The pending ID a moment offers: its own for an offer or an ask, the hero's for the hero pattern. */
export function offeredPendingId(m: Moment, heroPendingId: string | null): string | null {
  if (m.payload.kind === "offer" || m.payload.kind === "ask") return m.payload.pendingId;
  if (m.payload.kind === "pattern") return heroPendingId;
  return null;
}

/** How the offer this moment carries was answered, or null when it wasn't (or carries none). */
export async function offerAnswer(get: Get, uid: string, m: Moment, hasher: Hasher, heroPendingId: string | null): Promise<OfferAnswer | null> {
  const pendingId = offeredPendingId(m, heroPendingId);
  if (pendingId === null) return null;
  // A pattern moment carries the hero offer, answered by the hero's rows; an offer or an ask, by the reminder's. Two
  // reads a moment, read together (the life check's cost, W-229: the seeded persona's pass is 38 calls with this).
  const hero = m.payload.kind === "pattern";
  const [yes, no] = await Promise.all([
    get(paths.ledger(uid, hero ? heroActionId(hasher, pendingId) : reminderActionId(hasher, pendingId))),
    get(paths.ledger(uid, hero ? heroDeclinedId(hasher, pendingId) : declinedEntryId(hasher, pendingId))),
  ]);
  if (yes !== null && yes.data.kind === "action") return "closed";
  if (no !== null) return "declined";
  return null;
}

/** The owner said no to the hero offer: one declined decision row for its pending ID, idempotent. */
export async function recordHeroDeclined(tx: Tx, uid: string, pendingId: string, opsNow: number, hasher: Hasher): Promise<void> {
  const id = heroDeclinedId(hasher, pendingId);
  if ((await tx.get(paths.ledger(uid, id))) !== null) return;
  const core = await readCoreDocs(tx, uid);
  const now = tsFromMs(opsNow);
  const entry: Extract<Ledger, { kind: "decision" }> = {
    ...cFields(uid, now, core.epoch.data.epoch, core.epoch.data.policyRev),
    kind: "decision",
    state: "complete",
    at: now,
    retainUntil: null,
    payload: { purpose: "proactive", acceptedRefs: [], heldRefs: [{ type: "pending", id: pendingId as ID, rev: 1 }], reasonCodes: [], audience: core.state.data.audience },
  };
  tx.create(paths.ledger(uid, id), entry);
}
