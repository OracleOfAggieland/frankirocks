/**
 * The live AccountPort: Firestore's own recursive delete of `users/{uid}` (every collection under it, including any
 * no code here names), and the Admin SDK's user delete. Tests use a fake (`testing/fake-account.ts`).
 */
import { getAuth } from "firebase-admin/auth";
import { adminApp, adminFirestore } from "../config/admin";
import type { Env } from "../config/env";
import { tenantRoot } from "../store/paths";

export interface AccountPort {
  /** Deletes the tenant root document and everything under it. An empty tenant is not an error. */
  deleteTenant(uid: string): Promise<void>;
  /** Deletes the Firebase Auth user. A user already gone is not an error. */
  deleteUser(uid: string): Promise<void>;
}

export function liveAccount(env: Env): AccountPort {
  return {
    async deleteTenant(uid) {
      const db = adminFirestore(env);
      await db.recursiveDelete(db.doc(tenantRoot(uid)));
    },
    async deleteUser(uid) {
      try {
        await getAuth(adminApp(env)).deleteUser(uid);
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === "auth/user-not-found") return;
        throw error;
      }
    },
  };
}
