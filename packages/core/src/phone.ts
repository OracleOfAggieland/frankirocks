/**
 * Where one outbound phone call stands, as the screen may show it. Closed: the server answers with one of these
 * words and the browser reads nothing else.
 *
 * none: this turn placed no call. dialing: the request is with the carrier. ringing: the recipient's phone rings,
 * or was just picked up and Franki is connecting. talking: Franki and the recipient are on the line. ended, busy,
 * noAnswer, failed: over. unknown: it could not be read just now.
 */
import { type Infer, obj, oneOf, str } from "./schema/v";

export const PHONE_OUTCOMES = ["answered", "voicemail", "inconclusive"] as const;
export const PHONE_SUMMARY_CHARS = 400;
export const PhoneReport = obj({ outcome: oneOf(PHONE_OUTCOMES), summary: str(PHONE_SUMMARY_CHARS, { min: 1 }) });
export type PhoneReport = Infer<typeof PhoneReport>;

export const PHONE_CARRIER_STATUSES = ["queued", "initiated", "ringing", "in-progress", "completed", "busy", "no-answer", "failed", "canceled"] as const;
export type CarrierStatus = (typeof PHONE_CARRIER_STATUSES)[number];

/** The outcome of reconciling one dial with its own private specialist report. */
export const PHONE_COMPLETIONS = ["unknown", "active", "awaitingReport", "reported", "unconfirmed", "busy", "noAnswer", "failed"] as const;
export type PhoneCompletion = (typeof PHONE_COMPLETIONS)[number];

export const PHONE_STATUSES = ["none", "dialing", "ringing", "talking", "ended", "busy", "noAnswer", "failed", "unknown"] as const;
export type PhoneStatus = (typeof PHONE_STATUSES)[number];

export function isPhoneStatus(value: unknown): value is PhoneStatus {
  return typeof value === "string" && (PHONE_STATUSES as readonly string[]).includes(value);
}
