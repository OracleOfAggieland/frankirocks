/**
 * Where one outbound phone call stands, as the screen may show it. Closed: the server answers with one of these
 * words and the browser reads nothing else.
 *
 * none: this turn placed no call. dialing: the request is with the carrier. ringing: the recipient's phone rings,
 * or was just picked up and Franki is connecting. talking: Franki and the recipient are on the line. ended, busy,
 * noAnswer, failed: over. unknown: it could not be read just now.
 */
import { ID } from "./schema/primitives";
import { type Infer, bool, obj, oneOf, str } from "./schema/v";

export const PHONE_OUTCOMES = ["answered", "voicemail", "inconclusive"] as const;
export const PHONE_SUMMARY_CHARS = 400;
export const PhoneReport = obj({ outcome: oneOf(PHONE_OUTCOMES), summary: str(PHONE_SUMMARY_CHARS, { min: 1 }) });
export type PhoneReport = Infer<typeof PhoneReport>;

export const PHONE_CARRIER_STATUSES = ["queued", "initiated", "ringing", "in-progress", "completed", "busy", "no-answer", "failed", "canceled"] as const;
export type CarrierStatus = (typeof PHONE_CARRIER_STATUSES)[number];

/** The outcome of reconciling one dial with its own private specialist report. */
export const PHONE_COMPLETIONS = ["unknown", "active", "awaitingReport", "reported", "unconfirmed", "busy", "noAnswer", "failed"] as const;
export type PhoneCompletion = (typeof PHONE_COMPLETIONS)[number];

const CALL_STATUSES = ["dialing", "ringing", "talking", "ended", "busy", "noAnswer", "failed", "unknown"] as const;
export const PHONE_STATUSES = ["none", ...CALL_STATUSES] as const;
export type PhoneStatus = (typeof PHONE_STATUSES)[number];

export function isPhoneStatus(value: unknown): value is PhoneStatus {
  return typeof value === "string" && (PHONE_STATUSES as readonly string[]).includes(value);
}

/** Status-only context for the next owner turn. Identifiers select the original call in the report tool. */
export const PhoneActivity = obj({ dialId: ID, turnId: ID, status: oneOf(CALL_STATUSES), completion: oneOf(PHONE_COMPLETIONS), hasReport: bool });
export type PhoneActivity = Infer<typeof PhoneActivity>;

export function phoneActivityInstruction(calls: readonly PhoneActivity[], turns: readonly { turnId: string; role: string }[]): string {
  if (!calls.length) return "";
  const lines = calls.map(({ dialId, turnId, status, completion, hasReport }) => {
    const index = turns.findIndex((turn) => turn.role === "user" && turn.turnId === turnId);
    const origin = index < 0 ? "" : ` (requested in input message ${index + 1})`;
    return `call ${dialId}${origin}: ${status}, ${completion}, specialist report ${hasReport ? "available" : "not available"}`;
  });
  return "\n\nRecently updated background phone calls in this conversation, newest dial first:\n" + lines.join("\n") +
    "\nContinue answering the owner's current question. Discuss a call when relevant to what the owner asks. " +
    "A connected or ended call alone confirms no findings. When asked what happened, use read_phone_result with the matching dialId. " +
    "Ask which call they mean if ambiguous. Never speak the IDs.";
}
