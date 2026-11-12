/**
 * The visit on open (brief 030 P1-8; brief 019; brief 027 question S-168; contracts §6 open `visitId:ID?`).
 *
 * A visitor's clone, fixture clock and rows live under their own uid (`core/state.visitId`), so an open already runs
 * on the clone. What the visit ID adds is a check. Ruling (fails closed): an open that names a visit runs only on
 * that visit's clone; a tab of an earlier visit, or one naming a visit on an account that is not a clone, is STALE
 * and opens nothing. A null visit is accepted, since the voice machine still sends null.
 */
import type { CoreState } from "@franki/core";
import { staleError } from "./errors";

export function checkOpenVisit(state: CoreState, visitId: string | null): void {
  if (visitId === null) return;
  if (state.clockMode !== "fixture" || state.visitId !== visitId) throw staleError("visit");
}
