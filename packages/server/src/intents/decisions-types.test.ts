// The TurnIntents request and response shapes, checked against the `openai` package's own types (R10.8). The
// assignments below are the check: `npm run typecheck` fails if the core shapes drift from DecisionCreateParams or
// if parseDecision can't read a Decision.
import { buildTurnIntents, parseDecision, turnIntentsQuestions } from "@franki/core";
import type { Decision, DecisionCreateParams } from "openai/resources/decisions";
import { describe, expect, it } from "vitest";

describe("TurnIntents against the openai package's Decisions types", () => {
  it("the built body is a DecisionCreateParams", () => {
    const r = buildTurnIntents({ utterance: "hello", lastQuestion: null, doors: [] }, "m");
    if (!r.ok) throw new Error("not built");
    const params: DecisionCreateParams = r.body;
    expect(params.questions).toHaveLength(14);
  });

  it("parseDecision reads a Decision", () => {
    const questions = turnIntentsQuestions([]);
    const decision: Decision = {
      model: "m",
      answers: questions.map((q) => ({ type: "predicate" as const, name: q.name, probability: 0.05 })),
      usage: { input_tokens: 1, input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 },
    };
    expect(parseDecision(decision, questions).ok).toBe(true);
    const refused: Decision = { ...decision, answers: [{ type: "refusal", name: "forget" }, ...decision.answers.slice(1)] };
    expect(parseDecision(refused, questions)).toMatchObject({ ok: false, why: "invalid", reason: "refusal" });
  });
});
