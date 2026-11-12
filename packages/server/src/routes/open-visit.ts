/**
 * The visit on open (brief 030 P1-8; brief 019; brief 027 question S-168; contracts §6 open `visitId:ID?`).
 *
 * A visitor's clone, fixture clock and rows live under their own uid (`core/state.visitId`), so an open already runs
 * on the clone. What the visit ID adds is a check. Ruling (fails closed): an open that names a visit runs only on
 * that visit's clone; a tab of an earlier visit, or one naming a visit on an account that is not a clone, is STALE
 * and opens nothing. A null visit is accepted, since the voice machine still sends null.
 */
import type { CoreState } from "@franki/core";
import { type RouteError, scopeError, staleError } from "./errors";

export function checkOpenVisit(state: CoreState, visitId: string | null): void {
  if (visitId === null) return;
  if (state.clockMode !== "fixture" || state.visitId !== visitId) throw staleError("visit");
}

/**
 * Brief 038 finding 4: a turn names no visit (the wire has no field for it, and the voice machine builds the turn),
 * only its Session. A reset deletes every Session of the visit before it, so on a clone a turn whose Session is gone
 * comes from a tab of an earlier visit: STALE, which tells that tab its visit is over. On a live account the answer
 * stays SCOPE.
 */
export function missingSessionError(state: CoreState): RouteError {
  return state.clockMode === "fixture" ? staleError("visit") : scopeError();
}
