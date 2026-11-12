/**
 * Time can only ask (brief 023 task 3; spec §5 "Time can only ask"). Pure reads; nothing here returns or changes a
 * Memory. A passed bound is a question (derive's `expiryAsk`), never a quiet change of belief.
 */
import { msFromTs } from "../schema/primitives";
import type { Memory } from "../schema/records";

const RULE_LIKE = (m: Memory) => m.kind === "rule" || m.predicate === "allergy";

/**
 * Whether a current Memory applies at `at`: `[validFrom, validTo)`, end-exclusive. A rule or an allergy ignores
 * `validTo`: a bounded fact never applies to `core/rules`, and allergies never end by time (spec §5 "never for
 * allergies"). Only `active` rows apply.
 */
export function appliesAt(m: Memory, at: number): boolean {
  if (m.status !== "active") return false;
  if (m.validFrom !== null && at < msFromTs(m.validFrom)) return false;
  if (RULE_LIKE(m)) return true;
  return m.validTo === null || at < msFromTs(m.validTo);
}

/**
 * A soft preference's effect at `at`: `applies` while it applies, `neutral` once its bound has passed (its excludes
 * are gone, and nothing says the opposite until the owner answers). Anything that isn't a soft preference: `none`.
 */
export function softEffectAt(m: Memory, at: number): "applies" | "neutral" | "none" {
  if (m.kind !== "preference" || RULE_LIKE(m)) return "none";
  if (appliesAt(m, at)) return "applies";
  return m.validTo !== null && at >= msFromTs(m.validTo) ? "neutral" : "none";
}
