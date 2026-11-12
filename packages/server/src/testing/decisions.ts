/**
 * Fake Decisions answers for tests: a well-formed `Decision` for the 14 TurnIntents questions, with chosen
 * probabilities. Plain helper module.
 */
import { INTENT_NAMES, type IntentName } from "@franki/core";

export function decisionAnswer(p: Partial<Record<IntentName, number>> = {}) {
  return {
    model: "test-bg-model",
    answers: INTENT_NAMES.map((name) => ({ type: "predicate", name, probability: p[name] ?? 0.01 })),
    usage: { input_tokens: 10, input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 11 },
  };
}
