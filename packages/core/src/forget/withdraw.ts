/**
 * What withdrawal keeps, pure (spec §8 lines 275 to 279; contracts §4 registry note, §8 step 6). Withdrawing a
 * row that was not the target retracts the effects it premised, and every exclude, quiet or care hold among them
 * survives as a content-free `withdrawnHold` on the same target and scope, with no premises, roots or
 * dependencies. A `wrong` Memory stays `wrong` (it is a negative). Render sensitivity never falls.
 *
 * Closure (spec §8 step 6) decides which rows withdraw; it is not built in this part, so nothing here calls this
 * function outside tests.
 */
import type { Hasher } from "../ids";
import type { ID, Ref, TS } from "../schema/primitives";
import type { Effect, Memory } from "../schema/records";
import type { Stamps } from "./fence";
import { NotBuilt } from "./not-built";

export interface WithdrawalInput {
  opId: ID;
  stamps: Stamps;
  now: TS;
  withdrawn: Ref;
  memory: Memory | null;
  effects: readonly { id: ID; effect: Effect }[];
  hasher: Hasher;
}

export interface WithdrawalPlan {
  /** The withdrawn Memory's next state (unchanged when it is `wrong`), or null when it is not a Memory. */
  memory: Memory | null;
  /** Effects premised on the withdrawn row, now `retracted`. */
  retracted: { id: ID; effect: Effect }[];
  /** The content-free holds that keep their restraint. */
  holds: { id: ID; effect: Effect }[];
}

export function planWithdrawal(_i: WithdrawalInput): WithdrawalPlan {
  throw new NotBuilt("planWithdrawal");
}
