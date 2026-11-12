/**
 * `suggest(food)`, the pure half (spec §10, contracts `suggest`, KJ01): filter, then code picks. A model only words
 * the choice and its one reason; it never adds a candidate or reorders them.
 */
import type { FoodRule } from "./filter";
import { CATALOG, type FoodCandidate } from "./catalog";
import { type FilterResult, filterFood } from "./filter";
import { type Ingredient, ingredient } from "./ingredients";

/** The most candidates one `suggest` returns (contracts: candidateIds ID[0..3]). */
export const SUGGEST_MAX = 3;
/** A "quick" dinner takes at most this many minutes. */
export const QUICK_DINNER_MAX_MINUTES = 30;
/** The owner is always an attendee (contracts: attendees+=self). */
export const SELF = "self";
/** The fixed line when rule data can't be read (spec §6: hard rules fail closed). */
export const RULES_UNAVAILABLE_LINE = "allergy data unavailable, recommend no food";

export interface SuggestFoodInput {
  rules: readonly FoodRule[] | null;
  attendeeIds: readonly string[];
  excludeIds?: readonly string[];
  catalog?: readonly FoodCandidate[];
  table?: (id: string) => Ingredient | null;
  maxMinutes?: number;
}

export interface SuggestFoodResult {
  candidates: FoodCandidate[];
  selectedId: string | null;
  reason: { code: "fitsGap"; text: string } | null;
  question: string | null;
  filter: FilterResult;
  attendeeIds: string[];
}

export function suggestFood(input: SuggestFoodInput): SuggestFoodResult {
  const attendeeIds = [...new Set([SELF, ...input.attendeeIds])].sort();
  const table = input.table ?? ingredient;
  const filter = filterFood({ candidates: input.catalog ?? CATALOG, rules: input.rules, attendeeIds, excludeIds: input.excludeIds ?? [], table });
  const max = input.maxMinutes ?? QUICK_DINNER_MAX_MINUTES;
  const candidates = filter.kept
    .filter((c) => c.meal === "dinner" && c.minutes <= max)
    .sort((a, b) => a.minutes - b.minutes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, SUGGEST_MAX);
  const first = candidates[0] ?? null;
  return {
    candidates,
    selectedId: first?.id ?? null,
    reason: first === null ? null : { code: "fitsGap", text: `Ready in ${first.minutes} minutes` },
    question: input.rules === null ? RULES_UNAVAILABLE_LINE : null,
    filter,
    attendeeIds,
  };
}

/** The grocery list for the picked dinners: their ingredients' labels, once each, sorted. */
export function groceryItems(candidates: readonly FoodCandidate[], table: (id: string) => Ingredient | null = ingredient): string[] {
  const labels = new Set<string>();
  for (const c of candidates) for (const id of c.ingredientIds) labels.add(table(id)?.label ?? id);
  return [...labels].sort().slice(0, 128);
}
