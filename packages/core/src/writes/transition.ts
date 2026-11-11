/**
 * `applyTransition` (contracts §7; design 3.3's truth orders): returns a Plan and writes nothing. `rows` holds the
 * subject's rows on the kind's predicates as read in the transaction. Stub from wave A task A2; task A6 builds it.
 */
import type { ID } from "../schema/primitives";
import type { Memory } from "../schema/records";
import type { Plan, PlanEnv, TransitionVerdict } from "./types";
import { NotBuilt } from "./types";

export function applyTransition(_v: TransitionVerdict, _rows: ReadonlyMap<ID, Memory>, _env: PlanEnv): Plan {
  throw new NotBuilt("applyTransition");
}
