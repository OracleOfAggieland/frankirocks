import { getAuth } from "firebase-admin/auth";
import { adminApp } from "../config/admin";
import type { Env } from "../config/env";
import type { TokenVerifier } from "./guard";

/** The claims of a verified ID token this module reads. `firebase` is set by Firebase Auth on every token it mints. */
export interface VerifiedClaims {
  uid: string;
  firebase?: { sign_in_provider?: unknown };
}

/**
 * Brief 054 (R4.1, R4.5): the tenant and whether it signed in anonymously, read from claims the Admin SDK has
 * already verified. No `firebase` claim, or any other provider (`custom`, `google.com`, `password`), is false.
 */
export function verifiedIdentity(decoded: VerifiedClaims): { uid: string; anonymous: boolean } {
  return { uid: decoded.uid, anonymous: decoded.firebase?.sign_in_provider === "anonymous" };
}

/** The live TokenVerifier: Admin SDK `verifyIdToken` with `checkRevoked: true` (R10.1). */
export function adminTokenVerifier(env: Env = process.env): TokenVerifier {
  return {
    async verify(idToken) {
      // The provider claim is part of the token this call has just verified, revocation check included (R4.2).
      const decoded = await getAuth(adminApp(env)).verifyIdToken(idToken, true);
      return verifiedIdentity(decoded);
    },
  };
}
