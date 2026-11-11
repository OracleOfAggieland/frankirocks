/**
 * One rule slot (design 6.3): the only code that decides a slot's next state. Stub from wave A task A2; task A7
 * builds it.
 */
import type { HardRuleOutcome, RuleEvent, RuleSlot } from "./types";
import { NotBuilt } from "./types";

export function ruleTransition(_s: RuleSlot, _e: RuleEvent): { next: RuleSlot; outcome: HardRuleOutcome["kind"] } | { refused: "tapOnly" } {
  throw new NotBuilt("ruleTransition");
}
