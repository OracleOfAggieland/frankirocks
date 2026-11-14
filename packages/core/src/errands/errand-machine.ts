/**
 * @machine server.errand
 *
 * Brief 049 part A: an Errand's stored status, one table (rulings 4, 7, 9, 13 and 14). Pure.
 *
 * Always: `running` ends once, as `ready` (a checked result), `failed` (a run that could not finish, said once) or
 * `dropped` (a forget); `ready` and `failed` wait to be said and end once, as `delivered` (the decision row that
 * claims the line was written), `cardOnly` (nobody heard it within `ERRAND_RESULT_TTL_MS`, or its Session closed) or
 * `dropped`; a forget drops every status but `dropped`. Never: leaves `delivered`, `cardOnly` or `dropped` except
 * to `dropped`, or returns to `running`.
 */
import type { ErrandStatus } from "../schema/records";

/** The stored statuses, written out for the machine index; `ErrandStatus` (the schema's) must equal it. */
export type ErrandState = "running" | "ready" | "failed" | "delivered" | "cardOnly" | "dropped";
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const ERRAND_STATES_MATCH: Same<ErrandState, ErrandStatus> = true;

export type ErrandEvent = "result" | "runFailed" | "delivered" | "expired" | "forget";

export const ERRAND_MOVES = {
  running: { result: "ready", runFailed: "failed", delivered: null, expired: null, forget: "dropped" },
  ready: { result: null, runFailed: null, delivered: "delivered", expired: "cardOnly", forget: "dropped" },
  failed: { result: null, runFailed: null, delivered: "delivered", expired: "cardOnly", forget: "dropped" },
  delivered: { result: null, runFailed: null, delivered: null, expired: null, forget: "dropped" },
  cardOnly: { result: null, runFailed: null, delivered: null, expired: null, forget: "dropped" },
  dropped: { result: null, runFailed: null, delivered: null, expired: null, forget: null },
} as const satisfies Record<ErrandStatus, Record<ErrandEvent, ErrandStatus | null>>;

/** The status after `event`, or null when the event does not apply (the caller then writes nothing). */
export function nextErrandStatus(status: ErrandStatus, event: ErrandEvent): ErrandStatus | null {
  return ERRAND_MOVES[status]?.[event] ?? null;
}

/** A result that waits to be said: ready or failed. */
export const errandWaiting = (status: ErrandStatus): boolean => status === "ready" || status === "failed";
