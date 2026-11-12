/**
 * The open allergy question after Franki speaks (brief 012 design 6.4, CQ 126; task B7). Pure.
 *
 * - A planned question becomes `asked` only when the spoken transcript still holds a question (`QUESTION_MARK`): a
 *   reply cut by a barge-in before its question never asks it.
 * - With nothing open, Franki asking about allergies on its own (an RX4 word in a spoken sentence that is a
 *   question) opens `asked` with no rule, so the owner's next line is read as an answer.
 * - A question asked in another Session is closed first.
 */
import { type CoreRules, NO_ASK, REGEX_TABLE, normalizeForRegex, pendingNext } from "@franki/core";

const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;
/** How a spoken transcript shows it asked something: a sentence ending in "?". A ruling (task B7). */
export const QUESTION_MARK = /\?/;

const questionSentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/).filter((s) => QUESTION_MARK.test(s));

/** The next `core/rules.ask` after an assistant transcript in `sessionId`, or null when it is unchanged. */
export function askAfterSpoken(rules: CoreRules, sessionId: string, seq: number, text: string): CoreRules["ask"] | null {
  const prior = rules.ask ?? NO_ASK;
  let q = prior.sessionId === sessionId || prior.q.kind === "none" ? prior.q : pendingNext(prior.q, { kind: "sessionClosed" });
  const asks = questionSentences(text);
  if (q.kind === "planned") q = pendingNext(q, { kind: "spoken", seq, question: asks.length > 0 });
  else if (q.kind === "none" && asks.some((s) => RX4.test(normalizeForRegex(s)))) q = pendingNext(q, { kind: "frankiAsked", seq });
  const next = q.kind === "none" ? NO_ASK : { sessionId, q };
  return JSON.stringify(next) === JSON.stringify(prior) ? null : next;
}

/** True while an allergy question is asked in this Session: the state route sends no ack, so the answer is held. */
export const askOpen = (rules: CoreRules, sessionId: string): boolean => rules.ask?.sessionId === sessionId && rules.ask.q.kind === "asked";
