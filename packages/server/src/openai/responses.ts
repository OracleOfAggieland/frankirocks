/**
 * The normalized result of one Responses API call, as returned through `OpenAIPort.call("responses.create", ...)`.
 * The live adapter maps the SDK response to this shape; Fake_OpenAI scripts it directly.
 */
export interface ResponsesResult {
  /** True only for a complete, argument-free phone tool call. */
  phoneCallRequested?: boolean;
  /** Brief 046 part C: the arguments of a complete `read_money` call, as the model wrote them (unparsed). */
  moneyCallArguments?: string;
  /**
   * Brief 049 part A, ruling 5: every complete function call that has a call ID, in order, with its arguments as the
   * model wrote them (unparsed). Present only when there is at least one.
   */
  functionCalls?: ResponsesFunctionCall[];
  /**
   * With `functionCalls`: the response's own output items (function calls and reasoning), bounded, for a loop that
   * keeps nothing at OpenAI (`store: false`) to send back with its tool outputs on the next call.
   */
  outputItems?: unknown[];
  status: "completed" | "incomplete" | "failed";
  /** The concatenated output text, or null when there is none. */
  outputText: string | null;
  /** The refusal text when the model refused, else null. */
  refusal: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ResponsesFunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

export function completed(outputText: string, usage = { inputTokens: 0, outputTokens: 0 }): ResponsesResult {
  return { status: "completed", outputText, refusal: null, usage };
}
