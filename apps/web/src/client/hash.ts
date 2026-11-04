/**
 * Browser hashing (design "Module layout": core builds canonical bytes, the browser hashes with crypto.subtle).
 * The Voice_Client recomputes a Permit's `approvedPayloadHash` from the payload it is about to send (R17.2).
 */
import { type PayloadInput, admissionPayload, canonicalBytes } from "@franki/core";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex of canonicalJSON(admissionPayload(p)), the same bytes the server's devAdmit hashes. */
export function permitPayloadHash(p: PayloadInput): Promise<string> {
  return sha256Hex(canonicalBytes(admissionPayload(p)));
}
