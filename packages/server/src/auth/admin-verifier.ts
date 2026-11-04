import { getAuth } from "firebase-admin/auth";
import { adminApp } from "../config/admin";
import type { Env } from "../config/env";
import type { TokenVerifier } from "./guard";

/** The live TokenVerifier: Admin SDK `verifyIdToken` with `checkRevoked: true` (R10.1). */
export function adminTokenVerifier(env: Env = process.env): TokenVerifier {
  return {
    async verify(idToken) {
      const decoded = await getAuth(adminApp(env)).verifyIdToken(idToken, true);
      return { uid: decoded.uid };
    },
  };
}
