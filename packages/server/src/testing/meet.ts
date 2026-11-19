/**
 * Brief 052: an account whose first meeting is already over, for tests about some other opening line (a delivery
 * Moment, the hero offer, a held reminder) on a live account or a sample visit. Writes any missing meet row `met`, as
 * an open that found an owner name does (`closeMeet`), so no open of the test says a meet line in place of the line
 * under test. The rows carry the account's current epoch and policy revision when its core documents exist.
 */
import type { CoreEpoch, Hasher } from "@franki/core";
import { MEET_OFFERS, closeMeet, meetRowId, readMeetRows } from "../meet";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";

export async function meetAlreadyHappened(store: StorePort, uid: string, hasher: Pick<Hasher, "id">, opsNow = Date.UTC(2026, 10, 3, 12)): Promise<void> {
  await store.transaction(uid, async (tx) => {
    const [epoch, rows] = await Promise.all([tx.get<CoreEpoch>(paths.core(uid, "epoch")), readMeetRows(tx, uid, hasher)]);
    const core = epoch === null ? { epoch: 1, policyRev: 1 } : { epoch: epoch.data.epoch, policyRev: epoch.data.policyRev };
    closeMeet(tx, uid, rows, { opsNow, core }, hasher);
  });
}

/** The two meet rows' IDs, for tests that count the other decision rows. */
export const meetRowIds = (hasher: Pick<Hasher, "id">): string[] => MEET_OFFERS.map((n) => meetRowId(n, hasher));
