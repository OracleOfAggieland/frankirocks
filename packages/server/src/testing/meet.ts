/**
 * Brief 052: an account whose first meeting is already over, for tests about some other opening line (a delivery
 * Moment, the hero offer, a held reminder) on a live account. Writes both meet rows `met`, as an open that found an
 * owner name does (`closeMeet`), so no open of the test says a meet line in place of the line under test.
 */
import type { Hasher } from "@franki/core";
import { MEET_OFFERS, closeMeet, meetRowId } from "../meet";
import type { StorePort } from "../store/port";

export async function meetAlreadyHappened(store: StorePort, uid: string, hasher: Pick<Hasher, "id">, opsNow = Date.UTC(2026, 10, 3, 12)): Promise<void> {
  await store.transaction(uid, async (tx) => closeMeet(tx, uid, [null, null], { opsNow, core: { epoch: 1, policyRev: 1 } }, hasher));
}

/** The two meet rows' IDs, for tests that count the other decision rows. */
export const meetRowIds = (hasher: Pick<Hasher, "id">): string[] => MEET_OFFERS.map((n) => meetRowId(n, hasher));
