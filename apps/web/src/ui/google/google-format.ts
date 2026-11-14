// The Google sheet's words for what the server answered (brief 049 part B). Pure: formats the supplied instant in the
// supplied zone; never reads the clock.
import type { GoogleView } from "@franki/core";
import { bankTime } from "../bank/bank-format";
import { COPY } from "../copy";

/** The two lines for what can be read: Gmail's and Calendar's states. */
export function googleParts(g: GoogleView): string[] {
  return [COPY.google.part.mail[g.mail], COPY.google.part.calendar[g.calendar]];
}

/** One line under the address: a new sign-in needed, or when it was connected. */
export function googleLine(g: GoogleView, zone: string): string | null {
  if (g.needsReconnect) return COPY.google.needsReconnect;
  const when = g.connectedAt === null ? null : bankTime(g.connectedAt, zone);
  return when === null ? null : COPY.google.connectedSince(when);
}
