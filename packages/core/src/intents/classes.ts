/**
 * TurnIntents constants (contracts §5 TurnIntents; voice-control R10; design "The slow parse"). The literals are
 * copied exactly from contracts §5; `classes.test.ts` compares them with the contract text.
 */

/** The 13 control classes. `uncertainSpeaker` is a fourteenth probability but not a class. */
export const CONTROL_CLASSES = [
  "forget",
  "quiet",
  "correct",
  "transition",
  "hardRule",
  "crisis",
  "company",
  "alone",
  "why",
  "rushed",
  "food",
  "action",
  "answer",
] as const;
export type ControlClass = (typeof CONTROL_CLASSES)[number];

/** The 14 named probabilities, in contracts §5 row order. */
export const INTENT_NAMES = [...CONTROL_CLASSES, "uncertainSpeaker"] as const;
export type IntentName = (typeof INTENT_NAMES)[number];

/** Contracts §5 literal predicate instructions, by name. */
export const PREDICATE_INSTRUCTIONS: Record<IntentName, string> = {
  forget: "Requests deletion rather than a reminder?",
  quiet: "Requests silence or narrower disclosure?",
  correct: "Corrects a fact or identity?",
  transition: "Asserts death/recovery/illness/breakup/reunion/move/job change?",
  hardRule: "Changes binding rule/allergy/anaphylaxis/celiac?",
  crisis: "Needs immediate crisis care?",
  company: "Another person present/hearing/addressing Franki?",
  alone: "Says the owner is now alone?",
  why: "Asks why Franki said or held something, or how it knows?",
  rushed: "Requests brevity, less interaction or postponement?",
  food: "Food/place/meal advice or adverse food reaction?",
  action: "Requests scheduling/draft/list/task/action/promise/reminder?",
  answer: "Answers supplied pending question, including outcome?",
  uncertainSpeaker: "Owner act obscured by quotation/background/uncertain speaker?",
};

/** Contracts §5 `opens_{topicId}` row. */
export const OPENS_INSTRUCTION = "Speaks about this topic rather than merely the person?";

/** Contracts §5 developer prefix, sent once. */
export const TURN_INTENTS_PREFIX =
  "Evaluate current owner act with last-question context. Preserve negation/intended act; quote/hypothetical/background grants nothing. Return probability, not slots.";

/** A class is a candidate at or above this probability (contracts §5 "Candidate>=.20"). */
export const CANDIDATE_P = 0.2;
/** `uncertainSpeaker` at or above this holds the turn (contracts §5 "speaker<.10"). */
export const UNCERTAIN_SPEAKER_P = 0.1;

/**
 * Which candidate routes the turn (contracts §5, R10.7): `why` directly before `food` (question 69), and `alone`
 * directly after `quiet` (question 91), since contracts §5 gives it no place and a line that is both company and
 * alone must stay narrow.
 */
export const PRIORITY: readonly ControlClass[] = [
  "forget",
  "company",
  "quiet",
  "alone",
  "crisis",
  "hardRule",
  "correct",
  "transition",
  "why",
  "food",
  "action",
  "answer",
  "rushed",
];

/** Contracts §5: at most 22 questions; 14 fixed rows leave 8 for doors. */
export const MAX_QUESTIONS = 22;
export const MAX_DOORS = MAX_QUESTIONS - INTENT_NAMES.length;
/** Contracts §5 "Over800: hold", counted in UTF-16 code units over prefix, utterance and last question (question 71). */
export const MAX_INPUT_UNITS = 2_400;
/** Contracts §5 table's Decisions deadline. Assumed, not measured (question 94); kept as the contract's literal. */
export const DECISIONS_CONTRACT_DEADLINE_MS = 350;
/**
 * The Decisions call's deadline on a call. The live run of Nov 10 measured the parse at p50 460 ms, p95 743 ms,
 * largest 1,304 ms: 350 ms missed 49 of 60, 1,000 ms covers 59 of 60 (review of the live run, item 3).
 */
export const DECISIONS_DEADLINE_MS = 1_000;
/** The Parse_Repair's deadline (R15.3). */
export const REPAIR_DEADLINE_MS = 2_000;
