/**
 * Every Fixed_Line: a reply whose exact text is a code constant, never model-worded (voice-control R12.3, R14.3,
 * R15.1, R15.9; design "Replies the code words", question 59). A Fixed_Line reaches the browser as one `W` note of
 * kind `ack`, sensitivity S0, under a Permit of scope `ack`, and is spoken verbatim with no tools.
 */
import type { ID, TS } from "../schema/primitives";
import type { W } from "../schema/wire";

/** The only line a `recoveryOnly` Permit covers. */
export const RECOVERY_LINE = "Sorry, say that again?";
/** The first thing heard in the fresh call after company or quiet (wave B). */
export const COMPANY_LINE = "Got it. I'll keep things general for now.";
/** The reply to a parsed `alone` (wave B). */
export const ALONE_LINE = "Okay, just us again.";

// A forget's acknowledgment (brief 048 rulings 7 and 9). Said only on a fresh call or in a typed answer, and only
// once the receipt's `blockedAt` is set. None of them names what was forgotten.
/** `gone`: the forget went through. */
export const GONE_LINE = "Gone.";
/** `goneExceptRule`: a safety rule that rested on it stays, and the screen shows which. */
export const GONE_EXCEPT_RULE_LINE = "Gone, except one safety rule. It's on your screen.";
/** `offerRetell`, after GONE_LINE: things that went with it are gone too, and the owner may say them again. */
export const RETELL_LINE = "A few things that went with it are gone too. Tell me again anytime.";
/** `ask` (ruling 9): the cue matched more than one thing, or nothing clearly. */
export const FORGET_ASK_LINE = "I'm not sure which one you mean. Can you say a bit more?";
/** `askAllergies`, after any line but the ask: the forget cleared a confirmed "no allergies". */
export const ASK_ALLERGIES_LINE = "Any allergies I should know?";

export const FIXED_LINES = { RECOVERY_LINE, COMPANY_LINE, ALONE_LINE, GONE_LINE, GONE_EXCEPT_RULE_LINE, RETELL_LINE, FORGET_ASK_LINE, ASK_ALLERGIES_LINE } as const;
export type FixedLine = (typeof FIXED_LINES)[keyof typeof FIXED_LINES];

/** The acknowledgment kinds, as the forget job stores them (`ForgetAck["kind"]`). */
export type ForgetAckKind = "gone" | "goneExceptRule" | "offerRetell" | "ask";

/** The Fixed_Lines of one acknowledgment, in the order they are said (ruling 7). The ask never adds the allergy line. */
export function forgetAckLines(kind: ForgetAckKind, askAllergies: boolean): FixedLine[] {
  const lead: FixedLine[] = kind === "gone" ? [GONE_LINE] : kind === "goneExceptRule" ? [GONE_EXCEPT_RULE_LINE] : kind === "offerRetell" ? [GONE_LINE, RETELL_LINE] : [FORGET_ASK_LINE];
  return kind !== "ask" && askAllergies ? [...lead, ASK_ALLERGIES_LINE] : lead;
}

/** A line code says exactly: one Fixed_Line, or an acknowledgment made of several joined with one space. */
export type AckText = FixedLine | (string & { readonly __ackText: true });

export const forgetAckText = (kind: ForgetAckKind, askAllergies: boolean): AckText => forgetAckLines(kind, askAllergies).join(" ") as AckText;

/** Every text an acknowledgment can have. A finite set, so a reader can tell code's words from the model's. */
export const FORGET_ACK_TEXTS: readonly AckText[] = [...new Set((["gone", "goneExceptRule", "offerRetell", "ask"] as const).flatMap((k) => [forgetAckText(k, false), forgetAckText(k, true)]))];

/** True for a Fixed_Line, or a forget acknowledgment made of them. */
export const isFixedLine = (text: string): text is AckText => (Object.values(FIXED_LINES) as string[]).includes(text) || (FORGET_ACK_TEXTS as readonly string[]).includes(text);

/** The `ack` note that carries a Fixed_Line or an acknowledgment. */
export function ackNote(line: AckText, noteId: ID, expiresAt: TS): W {
  return { noteId, rev: 1, kind: "ack", text: line, rootKeys: [], dependsOn: [], sens: "S0", expiresAt, unprompted: false, momentId: null, tokens: [] };
}

/** The instructions that make the model say exactly one line. */
export const sayExactly = (text: string): string => `Say exactly this and nothing else: "${text}"`;
