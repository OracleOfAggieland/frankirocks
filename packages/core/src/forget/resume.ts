/**
 * Resume's data, pure (spec §8 step 7; contracts §8 step 7; brief 047 rulings 6 and 8). Resume produces data, not
 * words: which line a fresh call owes the owner, and which turns it carries. Templates live with the fresh call
 * (brief 048); nothing here is copy.
 *
 *   - `ask`            the scope is pending (an ambiguous or vague cue): the fresh call asks, nothing was removed.
 *   - `goneExceptRule` a hard rule went pending: "Gone, except one safety rule. It's on your screen."
 *   - `offerRetell`    something that was not the target withdrew: the fresh call offers to hear it again.
 *   - `gone`           otherwise.
 * `askAllergies` is set when install cleared confirmed-none safety state ("Any allergies I should know?").
 */
import type { ID } from "../schema/primitives";
import type { Job } from "../schema/records";

export type ForgetAck = NonNullable<Extract<Job["payload"], { kind: "forget" }>["ack"]>;

/** The ask's reason when the job did not keep why its scope is pending: the wider of the two (fails closed). */
export const UNKNOWN_SCOPE_REASON = "ambiguous" as const;
/** Spec §8 step 7: a fresh call carries at most four eligible sanitized turns. */
export const CARRY_TURNS_MAX = 4;

export interface AckInput {
  scopePending: boolean;
  /** Rules this forget re-anchored that are now `pending`. */
  pendingRuleIds: readonly ID[];
  /** Derivatives that withdrew and were not the target. */
  withdrawnCount: number;
  /** Install cleared confirmed-none safety state (an uncommitted turn at the fence, no salvage in the floor). */
  noneCleared: boolean;
}

export function forgetAck(a: AckInput): ForgetAck {
  if (a.scopePending) return { kind: "ask", reason: UNKNOWN_SCOPE_REASON };
  if (a.pendingRuleIds.length > 0) return { kind: "goneExceptRule", ruleIds: [...a.pendingRuleIds].slice(0, 32), askAllergies: a.noneCleared };
  if (a.withdrawnCount > 0) return { kind: "offerRetell", withdrawnCount: a.withdrawnCount, askAllergies: a.noneCleared };
  return { kind: "gone", askAllergies: a.noneCleared };
}

/** Resume may clear this op's barrier (ruling 6). Every condition must hold; there is no timeout path. */
export interface ClearCheck {
  barrierIsThisOp: boolean;
  callsClosed: boolean;
  closureFinished: boolean;
  survivorsRestamped: boolean;
  queueEmpty: boolean;
}

export type ResumeDecision = { kind: "clear" } | { kind: "promote" } | { kind: "wait"; reason: "calls" | "closure" | "barrier" };

export function resumeDecision(c: ClearCheck): ResumeDecision {
  if (!c.barrierIsThisOp) return { kind: "wait", reason: "barrier" };
  if (!c.callsClosed) return { kind: "wait", reason: "calls" };
  if (!c.closureFinished || !c.survivorsRestamped) return { kind: "wait", reason: "closure" };
  return c.queueEmpty ? { kind: "clear" } : { kind: "promote" };
}
