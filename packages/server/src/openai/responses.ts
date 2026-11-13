/**
 * The normalized result of one Responses API call, as returned through `OpenAIPort.call("responses.create", ...)`.
 * The live adapter maps the SDK response to this shape; Fake_OpenAI scripts it directly.
 */
export interface ResponsesResult {
  /** True only for a complete, argument-free phone tool call. */
  phoneCallRequested?: boolean;
  /** Brief 046 part C: the arguments of a complete `read_money` call, as the model wrote them (unparsed). */
  moneyCallArguments?: string;
  status: "completed" | "incomplete" | "failed";
  /** The concatenated output text, or null when there is none. */
  outputText: string | null;
  /** The refusal text when the model refused, else null. */
  refusal: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

export function completed(outputText: string, usage = { inputTokens: 0, outputTokens: 0 }): ResponsesResult {
  return { status: "completed", outputText, refusal: null, usage };
}
