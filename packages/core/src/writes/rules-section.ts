/**
 * The Head's rules section (brief 012 design 2.8, G25, CQ 116). Not built yet (brief 018 task B1 stub; task B3).
 */
import type { Au } from "../schema/primitives";
import type { CoreRules } from "../schema/records";

/** The start of the fail-closed tail line that replaces whole subject lines past the bounds. */
export const RULES_TAIL_PREFIX = "…and ";

export interface RulesTriple {
  subject: string;
  code: string;
  state: "active" | "pending";
}

export function renderRulesSection(_rules: CoreRules, _audience: Au): string[] {
  throw new Error("renderRulesSection: not built");
}

export function readRulesSection(_text: string): RulesTriple[] {
  throw new Error("readRulesSection: not built");
}
