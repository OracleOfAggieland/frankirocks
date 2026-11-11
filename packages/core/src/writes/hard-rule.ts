/**
 * The hardRule planner (design 2.5, 2.6, 6.2): slots, cross-slot reach, coverage, the fallback and the bounds.
 * Pure; returns the next `core/rules` and writes nothing. Stub from wave A task A2; task A7 builds it.
 */
import type { CoreRules } from "../schema/records";
import type { HardRulePlan, HardRuleTurn, ItemVerdict } from "./types";
import { NotBuilt } from "./types";

export const RULE_SLOTS_PER_TURN = 32;
export const RULES_MAX = 256;

export function planHardRule(_rules: CoreRules, _verdicts: readonly ItemVerdict[], _turn: HardRuleTurn): HardRulePlan {
  throw new NotBuilt("planHardRule");
}
