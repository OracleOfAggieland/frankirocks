/**
 * `reanchorRule`, pure (contracts §7 lines 825 and 840; spec §8 "What survives"). Maps a hard rule's proof span
 * onto the sanitized revision of its Evidence, verifies the quote and the gazetteer entry, and swaps its roots to
 * the survivor's. With no disjoint span, a quote that no longer matches, a gazetteer miss, or a subject that is not
 * literal in the span, the rule goes `pending` and anonymous: food is filtered as if anyone attends, no name or
 * erased root stays on it, and a card asks. A forget never withdraws a hard rule.
 */
import type { Hasher } from "../ids";
import type { EID, ID } from "../schema/primitives";
import type { AllergyRule as AllergyRuleSchema, Evidence } from "../schema/records";
import type { Infer } from "../schema/v";
import { NotBuilt } from "./not-built";

export type AllergyRule = Infer<typeof AllergyRuleSchema>;
export type SanitizeMapEntry = Evidence["sanitizeMap"][number];

/** A roster entity and the words that name it literally (labels and aliases). */
export interface RosterEntry {
  id: EID;
  names: string[];
}

export interface Survivor {
  eid: ID;
  evidence: Evidence;
}

export type PendingWhy = "noSurvivor" | "noDisjointSpan" | "quote" | "gazetteer" | "subject" | "noProof";

export type RuleReanchor = { kind: "reanchored"; rule: AllergyRule } | { kind: "pending"; rule: AllergyRule; why: PendingWhy };

export function reanchorRule(_rule: AllergyRule, _map: readonly SanitizeMapEntry[], _survivor: Survivor | null, _roster: readonly RosterEntry[], _hasher: Hasher): RuleReanchor {
  throw new NotBuilt("reanchorRule");
}
