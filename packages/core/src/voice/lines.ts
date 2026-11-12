/**
 * Every Fixed_Line: a reply whose exact text is a code constant, never model-worded (voice-control R12.3, R14.3,
 * R15.1, R15.9; design "Replies the code words", question 59). A Fixed_Line reaches the browser as one `W` note of
 * kind `ack`, sensitivity S0, under a Permit of scope `ack`, and is spoken verbatim with no tools.
 */
import type { ID, TS } from "../schema/primitives";
import type { W } from "../schema/wire";

/** The only line a `recoveryOnly` Permit covers. */
export const RECOVERY_LINE = "Sorry, say that again?";
/** A forget before forget exists: Franki can't claim anything is gone (brief 011 scope item 4). */
export const FORGET_NOT_YET = "I can't forget things yet.";
/** The first thing heard in the fresh call after company or quiet (wave B). */
export const COMPANY_LINE = "Got it. I'll keep things general for now.";
/** The reply to a parsed `alone` (wave B). */
export const ALONE_LINE = "Okay, just us again.";

export const FIXED_LINES = { RECOVERY_LINE, FORGET_NOT_YET, COMPANY_LINE, ALONE_LINE } as const;
export type FixedLine = (typeof FIXED_LINES)[keyof typeof FIXED_LINES];

export const isFixedLine = (text: string): text is FixedLine => (Object.values(FIXED_LINES) as string[]).includes(text);

/** The `ack` note that carries a Fixed_Line. */
export function ackNote(line: FixedLine, noteId: ID, expiresAt: TS): W {
  return { noteId, rev: 1, kind: "ack", text: line, rootKeys: [], dependsOn: [], sens: "S0", expiresAt, unprompted: false, momentId: null, tokens: [] };
}

/** The instructions that make the model say exactly one line. */
export const sayExactly = (text: string): string => `Say exactly this and nothing else: "${text}"`;
