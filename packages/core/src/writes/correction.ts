/**
 * `applyCorrection` (contracts §7; design 2.4 rows C and R1, G24, G33, G35, G36): the target `wrong`, the successor
 * and its edge, or a rename, or a retraction. Returns a Plan and writes nothing. `rows` holds the targets and every
 * row on their keys as read in the transaction. Stub from wave A task A2; task A6 builds it.
 */
import type { ID } from "../schema/primitives";
import type { Memory } from "../schema/records";
import type { CorrectionVerdict, Plan, PlanEnv } from "./types";
import { NotBuilt } from "./types";

export function applyCorrection(_v: CorrectionVerdict, _rows: ReadonlyMap<ID, Memory>, _env: PlanEnv): Plan {
  throw new NotBuilt("applyCorrection");
}
