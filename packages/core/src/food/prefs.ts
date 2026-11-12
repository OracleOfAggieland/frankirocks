/**
 * Diets and dislikes in `suggest(food)` (brief 039; spec §12 "Food", Friend Tests 2 and 11). Pure. They run after
 * the allergy filter, on what it kept, and never change what it removed: allergies stay hard rules for every
 * subject, failing closed (brief 037). A diet or a dislike is a preference:
 *   - A diet known by code (`DIETS`) removes every candidate holding an ingredient whose kinds it excludes, whose
 *     kinds are unknown, or whose makeup varies by brand. A diet code outside the list removes nothing; it asks.
 *   - A diet past its `validTo` that no later statement settles still filters (the dinners offered are right both
 *     ways) and asks first: "Still vegetarian, or was November it?". Time only asks; it never ends a belief.
 *   - A dislike that names an ingredient in the table removes every candidate holding it; one that names nothing
 *     in the table removes nothing.
 * Fewer than three left means fewer offered. A removed candidate is simply absent; its reason is a code only.
 */
import { resolvePeriod } from "../dates";
import { msFromTs } from "../schema/primitives";
import type { Memory } from "../schema/records";
import type { FoodCandidate } from "./catalog";
import { type FoodKind, INGREDIENTS, type Ingredient, ingredient } from "./ingredients";

/** The diets code knows, and the kinds each leaves out. */
export const DIETS = {
  vegetarian: ["meat", "poultry", "fish", "shellfish"],
  vegan: ["meat", "poultry", "fish", "shellfish", "dairy", "egg", "honey"],
  pescatarian: ["meat", "poultry"],
} as const satisfies Record<string, readonly FoodKind[]>;
export type DietCode = keyof typeof DIETS;
export const isDietCode = (code: string): code is DietCode => Object.prototype.hasOwnProperty.call(DIETS, code);

/** How a diet's period ended, for the question's words. */
export interface DietEnded {
  kind: "week" | "month" | "year" | "day";
  /** The month the period ended in (1 to 12), and its year, in the owner's zone. */
  month: number;
  year: number;
}

export interface FoodDiet {
  memoryId: string;
  memoryRev: number;
  subjectId: string;
  code: string;
  /** Null while the diet holds; set once its `validTo` has passed and nothing later settles it. */
  ended: DietEnded | null;
}

export interface FoodDislike {
  memoryId: string;
  subjectId: string;
  ingredientIds: readonly string[];
}

export interface FoodPrefs {
  diets: readonly FoodDiet[];
  dislikes: readonly FoodDislike[];
}

export const NO_PREFS: FoodPrefs = { diets: [], dislikes: [] };

export type PrefReason = "diet" | "dislike";

// ---------------------------------------------------------------------------------------------
// Reading Memories

const MONTH_WORDS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function localMonth(ms: number, zone: string): { month: number; year: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric" });
  const p = f.formatToParts(new Date(ms));
  return { month: Number(p.find((x) => x.type === "month")!.value), year: Number(p.find((x) => x.type === "year")!.value) };
}

const enumCode = (m: Memory): string | null => (m.value.kind === "enum" ? m.value.code : null);

/** A diet Memory: a food preference on the diet dimension, or one whose code is a diet. "none" states no diet. */
export function isDietMemory(m: Memory): boolean {
  if (m.predicate !== "preference.food") return false;
  const code = enumCode(m);
  if (code === null || code === "none") return false;
  return m.args.dimension === "diet" || isDietCode(code);
}

/** A dislike Memory: a stated food dislike or avoid, S0, in the owner's own words or confirmed (class U or C). */
export function isDislikeMemory(m: Memory): boolean {
  if (m.predicate !== "preference.food" || m.args.dimension === "diet") return false;
  const code = enumCode(m);
  return (code === "dislike" || code === "avoid") && m.sens === "S0" && (m.sourceClass === "U" || m.sourceClass === "C");
}

const forms = (word: string): string[] => {
  const w = word.toLowerCase();
  const out = new Set([w]);
  if (w.endsWith("oes")) out.add(w.slice(0, -2));
  if (w.endsWith("s")) out.add(w.slice(0, -1));
  else out.add(`${w}s`);
  return [...out];
};

/**
 * The ingredients the words name, by their labels and IDs (with plurals): "I hate mushrooms" names `mushroom`.
 * Whole words only; nothing outside the table.
 */
export function namedIngredientIds(words: string, table: readonly Ingredient[] = INGREDIENTS): string[] {
  const text = ` ${words.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const out: string[] = [];
  for (const ing of table) {
    const names = new Set([...forms(ing.label), ...forms(ing.id.replace(/_/g, " "))]);
    if ([...names].some((n) => text.includes(` ${n} `))) out.push(ing.id);
  }
  return out.sort();
}

export interface PrefsReadInput {
  memories: readonly { id: string; memory: Memory }[];
  /** World time, UTC ms. */
  at: number;
  zone: string;
  /** Whose diets and dislikes apply: the owner always, another person only when named (brief 039 ruling). */
  applies: (subjectId: string) => boolean;
  /** The owner's own words a Memory rests on (its root Slices' text). */
  wordsOf: (m: Memory) => string;
}

/** The diets and dislikes in force at `at` for the people `applies` names. */
export function foodPrefsOf(input: PrefsReadInput): FoodPrefs {
  const diets: FoodDiet[] = [];
  const dislikes: FoodDislike[] = [];
  for (const { id, memory: m } of input.memories) {
    if (m.status !== "active" || !input.applies(m.subjectId)) continue;
    if (m.validFrom !== null && input.at < msFromTs(m.validFrom)) continue;
    if (isDietMemory(m)) {
      const validTo = m.validTo === null ? null : msFromTs(m.validTo);
      let ended: DietEnded | null = null;
      if (validTo !== null && input.at >= validTo) {
        const spoken = m.when.kind === "spoken" ? m.when.spoken : null;
        const said = msFromTs(m.validFrom ?? m.assertedAt);
        const kind = (spoken === null ? null : resolvePeriod(spoken, said, input.zone)?.kind) ?? "day";
        ended = { kind, ...localMonth(validTo - 1, input.zone) };
      }
      diets.push({ memoryId: id, memoryRev: m.rev, subjectId: m.subjectId, code: enumCode(m)!, ended });
    } else if (isDislikeMemory(m)) {
      const ids = namedIngredientIds(input.wordsOf(m));
      if (ids.length > 0) dislikes.push({ memoryId: id, subjectId: m.subjectId, ingredientIds: ids });
    }
  }
  diets.sort((a, b) => (a.memoryId < b.memoryId ? -1 : 1));
  dislikes.sort((a, b) => (a.memoryId < b.memoryId ? -1 : 1));
  return { diets, dislikes };
}

// ---------------------------------------------------------------------------------------------
// Filtering

/** Whether an ingredient keeps a diet: its kinds are known, it isn't `varies`, and the diet excludes none of them. */
export function keepsDiet(code: DietCode, ing: Ingredient | null): boolean {
  if (ing === null || !ing.known || ing.profile === "varies" || ing.kinds === null || ing.kinds === undefined) return false;
  const out: readonly FoodKind[] = DIETS[code];
  return !ing.kinds.some((k) => out.includes(k));
}

export interface PrefFilterResult {
  kept: FoodCandidate[];
  removed: { id: string; reason: PrefReason }[];
}

/** Removes what breaks a known diet (ended ones too) or holds a disliked ingredient. */
export function filterPrefs(candidates: readonly FoodCandidate[], prefs: FoodPrefs, table: (id: string) => Ingredient | null = ingredient): PrefFilterResult {
  const diets = prefs.diets.map((d) => d.code).filter(isDietCode);
  const disliked = new Set(prefs.dislikes.flatMap((d) => d.ingredientIds));
  const kept: FoodCandidate[] = [];
  const removed: PrefFilterResult["removed"] = [];
  for (const c of candidates) {
    const manifest = c.manifestVersion !== null && c.ingredientIds.length > 0;
    if (diets.length > 0 && (!manifest || diets.some((d) => c.ingredientIds.some((id) => !keepsDiet(d, table(id)))))) {
      removed.push({ id: c.id, reason: "diet" });
      continue;
    }
    if (c.ingredientIds.some((id) => disliked.has(id))) {
      removed.push({ id: c.id, reason: "dislike" });
      continue;
    }
    kept.push(c);
  }
  return { kept, removed };
}

// ---------------------------------------------------------------------------------------------
// The question

/** "Still vegetarian, or was November it?", from the stored diet and the period it ended. */
export function dietEndedLine(code: string, ended: DietEnded): string {
  const when = ended.kind === "month" ? MONTH_WORDS[ended.month - 1]! : ended.kind === "year" ? String(ended.year) : "that";
  return `Still ${code}, or was ${when} it?`;
}

/** The line when a stored diet isn't one code knows: nothing is guessed, so Franki asks. */
export const UNKNOWN_DIET_LINE = "What does your diet leave out?";

/**
 * The owner's open question about a diet, or null: an ended diet first (the lowest Memory ID), then a diet code
 * doesn't know. Only the owner's own diets are asked about, so no question names anyone else.
 */
export function dietQuestion(prefs: FoodPrefs): { line: string; diet: FoodDiet; kind: "ended" | "unknown" } | null {
  const own = prefs.diets.filter((d) => d.subjectId === "self");
  const ended = own.find((d) => d.ended !== null && isDietCode(d.code));
  if (ended !== undefined) return { line: dietEndedLine(ended.code, ended.ended!), diet: ended, kind: "ended" };
  const unknown = own.find((d) => !isDietCode(d.code));
  return unknown === undefined ? null : { line: UNKNOWN_DIET_LINE, diet: unknown, kind: "unknown" };
}

// ---------------------------------------------------------------------------------------------
// The answer, read by code from a closed list

export type DietAnswer = "still" | "ended" | "unclear";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The owner's answer to "Still vegetarian, or was November it?", from a closed list of whole utterances. A bare
 * "yes" or "no" is unclear (it could answer either half), so Franki may ask again.
 */
export function readDietAnswer(text: string, code: string, ended: DietEnded): DietAnswer {
  const t = norm(text);
  const when = norm(ended.kind === "month" ? MONTH_WORDS[ended.month - 1]! : ended.kind === "year" ? String(ended.year) : "that");
  const c = norm(code);
  const lead = ["", "yes ", "yeah ", "yep ", "yup "];
  const still = [`still`, `still ${c}`, `im still ${c}`, `i am still ${c}`, `still am`, `i still am`, `im still`, `still ${c} yes`];
  if (lead.some((l) => still.some((s) => t === `${l}${s}`))) return "still";
  const no = ["", "no ", "nope ", "nah "];
  const ended1 = [`that was ${when}`, `that was it`, `${when} was it`, `it was just ${when}`, `just ${when}`, `not anymore`, `not any more`, `no longer`, `that was just ${when}`];
  if (no.some((l) => ended1.some((s) => t === `${l}${s}`))) return "ended";
  return "unclear";
}
