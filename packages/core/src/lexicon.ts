/**
 * Code floors from closed word lists (contracts §2 Sens; R20.4, R22.11). Models may propose a higher
 * Sensitivity or gravity; code never stores lower than these floors.
 *
 * S2 (contracts §2): human health, debt/balances, sexuality, religion, immigration, others' secrets, life/care.
 * S1: other personal, work, bank/receipt totals, told relations/breakups, pet health, allergies.
 * Anything else floors at S0. The lists are matched against `tokenize` output (NFKC, lowercase).
 */
import type { Sens } from "./schema/primitives";
import { tokenize } from "./text";

export const S2_WORDS: ReadonlySet<string> = new Set([
  // human health
  "cancer", "chemo", "chemotherapy", "diagnosis", "diagnosed", "surgery", "hospital", "hospitalized", "illness",
  "disease", "depression", "anxiety", "therapy", "therapist", "medication", "pregnant", "pregnancy", "miscarriage",
  "hiv", "diabetes", "stroke", "tumor", "tumour", "psychiatrist", "rehab", "overdose", "suicide", "suicidal",
  // debt and balances
  "debt", "debts", "overdraft", "bankrupt", "bankruptcy", "loan", "loans", "mortgage", "balance", "owe", "owed",
  // sexuality and religion
  "gay", "lesbian", "bisexual", "transgender", "queer", "sexuality", "religion", "religious", "church", "mosque",
  "synagogue", "temple", "pray", "prayer",
  // immigration
  "visa", "immigration", "deported", "deportation", "asylum", "undocumented", "citizenship", "greencard",
  // others' secrets, life and care
  "secret", "confidential", "died", "dead", "death", "dying", "funeral", "grief", "grieving", "passed", "hospice",
  "caregiver", "caring",
]);

export const S1_WORDS: ReadonlySet<string> = new Set([
  // work
  "work", "job", "boss", "manager", "colleague", "coworker", "salary", "raise", "promotion", "fired", "interview",
  "office", "meeting", "client",
  // money
  "bank", "paid", "pay", "spent", "spend", "budget", "rent", "bill", "bills", "receipt",
  // relations and breakups
  "wife", "husband", "partner", "girlfriend", "boyfriend", "divorce", "divorced", "breakup", "broke", "ex",
  "mom", "dad", "mother", "father", "sister", "brother", "son", "daughter", "family",
  // pet health and allergies
  "vet", "allergy", "allergic", "allergies",
]);

/** Gravity floor 3 (loss, crisis) and 2 (serious life events). */
export const GRAVITY_3_WORDS: ReadonlySet<string> = new Set(["died", "death", "funeral", "suicide", "suicidal", "overdose", "hospice", "dying"]);
export const GRAVITY_2_WORDS: ReadonlySet<string> = new Set([
  "cancer", "surgery", "hospital", "hospitalized", "divorce", "divorced", "breakup", "fired", "miscarriage",
  "diagnosis", "diagnosed", "deported", "bankrupt", "bankruptcy", "stroke",
]);

const SENS_ORDER: Record<Sens, number> = { S0: 0, S1: 1, S2: 2 };

/** The higher of two Sensitivities (S0 < S1 < S2). */
export function maxSens(a: Sens, b: Sens): Sens {
  return SENS_ORDER[a] >= SENS_ORDER[b] ? a : b;
}

/** Code Sensitivity floor of a text. */
export function sensFloor(text: string): Sens {
  let floor: Sens = "S0";
  for (const t of tokenize(text)) {
    if (S2_WORDS.has(t)) return "S2";
    if (S1_WORDS.has(t)) floor = "S1";
  }
  return floor;
}

/** Code gravity floor of a text (0–3). */
export function gravityFloor(text: string): 0 | 1 | 2 | 3 {
  let floor: 0 | 2 = 0;
  for (const t of tokenize(text)) {
    if (GRAVITY_3_WORDS.has(t)) return 3;
    if (GRAVITY_2_WORDS.has(t)) floor = 2;
  }
  return floor;
}
