import { isIdShape, tsFromMs } from "@franki/core";
import type { Firestore } from "firebase-admin/firestore";
import { createHasher } from "../crypto";
import { FirestoreStore } from "../store/firestore-store";
import { paths } from "../store/paths";
import { type CallStatus, twilioCallStatus } from "./carrier-read";
import { reconcilePhoneCall } from "./reconcile";

const PAGE = 40;
const CONCURRENCY = 4;

/** The global scan reads paths only. Each update then claims the exact row in its owner's scoped store. */
export async function reconcileDuePhoneCalls(
  db: Firestore, config: { account: string; token: string; hmacKey: string }, now: () => number, readStatus: CallStatus = twilioCallStatus,
) {
  const dueField = "payload.nextCarrierCheckAt";
  const due = await db.collectionGroup("ledger")
    .where(dueField, ">=", tsFromMs(0)).where(dueField, "<=", tsFromMs(now()))
    .orderBy(dueField).select().limit(PAGE).get();
  const store = new FirestoreStore(db, createHasher(config.hmacKey));
  const counts = { checked: 0, skipped: 0, unavailable: 0, failed: 0 };
  for (let i = 0; i < due.docs.length; i += CONCURRENCY) {
    await Promise.all(due.docs.slice(i, i + CONCURRENCY).map(async ({ ref }) => {
      const uid = ref.parent.parent?.id;
      if (!uid || !isIdShape(ref.id) || ref.path !== paths.ledger(uid, ref.id)) {
        counts.skipped++;
        return;
      }
      try {
        const result = await reconcilePhoneCall(store, uid, ref.id, now, (sid) => readStatus({ account: config.account, token: config.token }, sid));
        counts[result]++;
      } catch {
        counts.failed++;
      }
    }));
  }
  return counts;
}
