/**
 * The TurnIntents request (contracts §5; R10.4, R10.5; design "The slow parse", question 72). Pure: the server
 * passes the model ID from Model_Config, and the Decisions_Port sends the body. The shape mirrors the `openai`
 * package's `DecisionCreateParams`; `packages/server/src/intents/decisions-types.test.ts` checks it against the
 * package's own types (core may not import `openai`).
 */
import { INTENT_NAMES, type IntentName, MAX_DOORS, MAX_INPUT_UNITS, OPENS_INSTRUCTION, PREDICATE_INSTRUCTIONS, TURN_INTENTS_PREFIX } from "./classes";

export interface Door {
  topicId: string;
  label: string;
  terms: readonly string[];
}

export interface TurnIntentsInput {
  utterance: string;
  /** The rendered pending question, or null; none exist in this slice. */
  lastQuestion: string | null;
  doors: readonly Door[];
}

export interface PredicateQuestion {
  type: "predicate";
  name: string;
  instructions: string;
}

export interface DecisionsBody {
  model: string;
  input: [{ role: "developer"; content: string }, { role: "user"; content: string }];
  questions: PredicateQuestion[];
}

export type BuildResult = { ok: true; body: DecisionsBody } | { ok: false; why: "oversize" | "invalidInput" };

/** The user message: the last question and the owner's words, both marked as data. */
export function turnIntentsUserText(utterance: string, lastQuestion: string | null): string {
  return `Last question (data): ${lastQuestion ?? "none"}\nOwner said (data): ${utterance}`;
}

/** The questions in contracts §5 row order, then one `opens_{topicId}` per door. */
export function turnIntentsQuestions(doors: readonly Door[], instructions: Readonly<Record<IntentName, string>> = PREDICATE_INSTRUCTIONS): PredicateQuestion[] {
  return [
    ...INTENT_NAMES.map((name) => ({ type: "predicate" as const, name, instructions: instructions[name] })),
    ...doors.map((d) => ({ type: "predicate" as const, name: `opens_${d.topicId}`, instructions: OPENS_INSTRUCTION })),
  ];
}

/** Builds the Decisions body, or refuses: no truncation (contracts §5 "Over800: hold, not truncate"). */
export function buildTurnIntents(input: TurnIntentsInput, model: string, instructions: Readonly<Record<IntentName, string>> = PREDICATE_INSTRUCTIONS): BuildResult {
  if (input.utterance.trim() === "" || model === "" || input.doors.length > MAX_DOORS) return { ok: false, why: "invalidInput" };
  const units = TURN_INTENTS_PREFIX.length + input.utterance.length + (input.lastQuestion?.length ?? 0);
  if (units > MAX_INPUT_UNITS) return { ok: false, why: "oversize" };
  return {
    ok: true,
    body: {
      model,
      input: [
        { role: "developer", content: TURN_INTENTS_PREFIX },
        { role: "user", content: turnIntentsUserText(input.utterance, input.lastQuestion) },
      ],
      questions: turnIntentsQuestions(input.doors, instructions),
    },
  };
}
