import { createHash, timingSafeEqual } from "node:crypto";

const PREFIX = "Bearer ";

/** True only for `Authorization: Bearer <token>` carrying exactly the configured smoke token. */
export function isSmokeAuthorized(header: string | null | undefined, token: string | undefined): boolean {
  if (!header || !token || !header.startsWith(PREFIX)) return false;
  // Hash both sides so the comparison is constant-time even when lengths differ.
  const given = createHash("sha256").update(header.slice(PREFIX.length)).digest();
  const expected = createHash("sha256").update(token).digest();
  return timingSafeEqual(given, expected);
}
