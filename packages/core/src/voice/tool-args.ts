/**
 * What a call sends to `/api/tool` for a function call the model made (brief 040, items 1 and 2). Pure.
 *
 * The six tools a call offers are dispatched under one rule (voice/machine.ts, dispatchTool): the model's arguments
 * must parse as JSON, or nothing is sent. What is sent differs by tool:
 *   recall, suggest, make_phone_call,  the model's arguments, as parsed (the route validates them; the phone call's
 *   read_money, start_errand           are empty, and the server reads the number from the owner's own turn; the
 *                                      money read's are only the question's shape, brief 046 part C; an errand's
 *                                      are only what it looks through, brief 049 part A).
 *   answer                             both IDs null, whatever the model wrote (H-186): the model never sees a pending
 *                                      ID or a choice ID, and code resolves the offer and the choice on the server.
 */
export const CALL_TOOL_NAMES = ["recall", "make_phone_call", "suggest", "answer", "read_money", "start_errand", "delegate_specialist", "read_phone_result", "search_web", "read_web_result"] as const;
export type CallToolName = (typeof CALL_TOOL_NAMES)[number];

export const isCallToolName = (name: string): name is CallToolName => (CALL_TOOL_NAMES as readonly string[]).includes(name);

/** The `answer` arguments a call always sends. */
export const CALL_ANSWER_ARGS = Object.freeze({ pendingId: null, choiceId: null });

/** The arguments to send for a model's function call, or null when its arguments don't parse (nothing is sent). */
export function callToolArgs(name: CallToolName, argumentsJson: string): { args: unknown } | null {
  let args: unknown;
  try {
    args = JSON.parse(argumentsJson);
  } catch {
    return null;
  }
  return { args: name === "answer" ? { ...CALL_ANSWER_ARGS } : args };
}
