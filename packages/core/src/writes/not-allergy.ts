/**
 * Cue sentences and the `notAllergy` check (design 2.5, G3). Pure. Stub from wave A task A2; task A7 builds it.
 */
import type { FastSlotsOut, TurnEvidence } from "./types";
import { NotBuilt } from "./types";

/** The closed list of G3, used only by the `notAllergy` check. */
export const GENERIC_ALLERGY_OBJECTS = [
  "something", "anything", "it", "that", "this", "these", "those", "stuff", "food", "foods", "ingredient", "ingredients",
  "dish", "dishes", "meal", "meals", "sauce", "medicine", "medication", "medications", "meds", "pill", "pills", "drug",
  "drugs", "plant", "plants", "animal", "animals",
] as const;

/** Words that don't count when they directly follow "allergy" or "allergies". */
export const ALLERGY_COMPOUNDS = ["pill", "pills", "meds", "medicine", "medication", "shot", "shots", "tablet", "tablets", "spray"] as const;

/** The cue sentences' U ranges on the Evidence text, with verified subject mention spans left out. */
export function cueSentences(_e: TurnEvidence, _out: FastSlotsOut | null, _answering: boolean): { start: number; end: number }[] {
  throw new NotBuilt("cueSentences");
}

/** The code's half of the G3 check, over the cue sentences. The model's half is the caller's. */
export function notAllergyByCode(_e: TurnEvidence, _out: FastSlotsOut | null): boolean {
  throw new NotBuilt("notAllergyByCode");
}
