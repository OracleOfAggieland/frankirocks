/**
 * The food filter (spec §10, KJ01; design note 022 §4). Pure. Order:
 *   1. No rules document: everything is removed (hard rules fail closed).
 *   2. Unknown allergen status removes the candidate: an ingredient outside the table, one of unknown status, or a
 *      place with no manifest. Nothing claims a venue is safe.
 *   3. Every rule that could cover an attendee filters, whatever its state: a rule on an attendee, and every rule
 *      with no subject. `pending` filters as if it were `active`.
 *   4. A rule's code reaches its own code and every code under it in the gazetteer's `includes`; an ingredient
 *      conflicts when its code is reached, or when the rule's code is under the ingredient's code. A covering rule
 *      whose code isn't a known allergen (`unresolved`, an off-table word, the `none` pseudo code) removes
 *      everything. A known code outside the food domain removes nothing.
 *   5. Excluded candidate IDs are removed.
 */
import type { Infer } from "../schema/v";
import type { AllergyRule as AllergyRuleSchema } from "../schema/records";
import { gazetteerEntry } from "../writes/gazetteer";
import { type FoodCandidate, allergenFlags } from "./catalog";
import { type Ingredient, ingredient } from "./ingredients";

export type FoodRule = Infer<typeof AllergyRuleSchema>;

export type RemoveReason = "rulesUnavailable" | "unknownAllergen" | "unknownRule" | "rule" | "excluded";

export interface FilterInput {
  candidates: readonly FoodCandidate[];
  /** `core/rules.allergies`, or null when the rules document can't be read. */
  rules: readonly FoodRule[] | null;
  /** Everyone eating, the owner (`self`) included by the caller. */
  attendeeIds: readonly string[];
  excludeIds: readonly string[];
  table?: (id: string) => Ingredient | null;
}

export interface FilterResult {
  kept: FoodCandidate[];
  removed: { id: string; reason: RemoveReason; ruleId: string | null }[];
}

/** The code and every code under it, through the gazetteer's `includes`. */
export function codesBelow(code: string): Set<string> {
  const out = new Set<string>([code]);
  const stack = [code];
  while (stack.length > 0) {
    for (const k of gazetteerEntry(stack.pop()!)?.includes ?? []) {
      if (!out.has(k)) {
        out.add(k);
        stack.push(k);
      }
    }
  }
  return out;
}

/** True when a rule on `ruleCode` keeps away an ingredient flagged `ingredientCode`. */
export const codesConflict = (ruleCode: string, ingredientCode: string): boolean =>
  codesBelow(ruleCode).has(ingredientCode) || codesBelow(ingredientCode).has(ruleCode);

type RuleKind = "food" | "other" | "unknown";
function ruleKind(code: string): RuleKind {
  const e = gazetteerEntry(code);
  if (e === null || e.domain === "pseudo") return "unknown";
  return e.domain === "food" ? "food" : "other";
}

/** The rules that could cover someone eating: on an attendee, or with no subject (anonymous or unresolved). */
export function coveringRules(rules: readonly FoodRule[], attendeeIds: readonly string[]): FoodRule[] {
  const present = new Set(attendeeIds);
  return rules.filter((r) => r.subjectId === null || present.has(r.subjectId));
}

export function filterFood(input: FilterInput): FilterResult {
  const table = input.table ?? ingredient;
  const removed: FilterResult["removed"] = [];
  if (input.rules === null) {
    return { kept: [], removed: input.candidates.map((c) => ({ id: c.id, reason: "rulesUnavailable", ruleId: null })) };
  }
  const covering = coveringRules(input.rules, input.attendeeIds);
  const unknownRule = covering.find((r) => ruleKind(r.code) === "unknown") ?? null;
  const foodRules = covering.filter((r) => ruleKind(r.code) === "food");
  const excluded = new Set(input.excludeIds);
  const kept: FoodCandidate[] = [];
  for (const c of input.candidates) {
    const flags = allergenFlags(c, table);
    if (flags.some((f) => f.status !== "contains")) {
      removed.push({ id: c.id, reason: "unknownAllergen", ruleId: null });
      continue;
    }
    if (unknownRule !== null) {
      removed.push({ id: c.id, reason: "unknownRule", ruleId: unknownRule.id });
      continue;
    }
    const hit = foodRules.find((r) => flags.some((f) => codesConflict(r.code, f.code))) ?? null;
    if (hit !== null) {
      removed.push({ id: c.id, reason: "rule", ruleId: hit.id });
      continue;
    }
    if (excluded.has(c.id)) {
      removed.push({ id: c.id, reason: "excluded", ruleId: null });
      continue;
    }
    kept.push(c);
  }
  return { kept, removed };
}
