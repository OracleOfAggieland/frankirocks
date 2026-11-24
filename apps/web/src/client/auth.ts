/**
 * Sign-in (R9.1, R9.2, R9.6, R9.7). Google is the only provider for an owner. Firebase keeps the user in browser
 * storage, so a reload restores the signed-in state without a prompt; until Firebase reports, the state is `loading`.
 * Brief 054: the Kiroween Demo signs in anonymously, with no popup and no form; each press is a Firebase user of its
 * own. `anonymous` is for what the screen shows and offers only; the server reads it from the verified token.
 */
import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import { type Auth, GoogleAuthProvider, type User, getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, signOut } from "firebase/auth";
import { COPY } from "../ui/copy";
import type { FirebaseWebConfig } from "./firebase-config";

/** Which of the three R9.6 causes made a sign-in attempt fail. */
export type SignInFailure = "popupClosed" | "popupBlocked" | "providerError";

export const SIGN_IN_MESSAGES: Record<SignInFailure, string> = {
  popupClosed: "Sign-in was cancelled: the sign-in window was closed.",
  popupBlocked: "Sign-in was blocked: the browser blocked the sign-in window. Allow pop-ups for this site and try again.",
  providerError: "Sign-in failed: Google or Firebase returned an error.",
};

/** Pure: maps a Firebase Auth error code to its R9.6 cause. Unknown codes, including unauthorized-domain, are provider errors. */
export function signInFailure(code: unknown): SignInFailure {
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request" || code === "auth/user-cancelled") return "popupClosed";
  if (code === "auth/popup-blocked") return "popupBlocked";
  return "providerError";
}

/** Extra detail for a provider error. Only the error code is shown, never a token or a config value. */
export function providerDetail(code: unknown): string | null {
  if (code === "auth/unauthorized-domain") return "This domain is not an authorized domain for Firebase sign-in.";
  return typeof code === "string" && /^auth\/[a-z-]+$/.test(code) ? `Error code: ${code}.` : null;
}

export type AuthState =
  | { kind: "loading" }
  | { kind: "signedOut"; error: { cause: SignInFailure; message: string } | null }
  /** `anonymous`: a demo visit (brief 054); `email` then holds the persona's name, never "(no email)". */
  | { kind: "signedIn"; email: string; uid: string; anonymous?: true };

/** Brief 054: the plain line when the demo's anonymous sign-in fails. */
export const DEMO_SIGN_IN_FAILED = COPY.demo.signInFailed;

export interface AuthClient {
  /** Calls `listener` with each Firebase user change; returns the unsubscribe function. */
  subscribe(listener: (user: User | null) => void): () => void;
  /** Opens the Google popup. Resolves with null on success, or the R9.6 failure. */
  signIn(): Promise<{ cause: SignInFailure; message: string } | null>;
  /** Brief 054: signs in as a new anonymous user. Resolves with null on success, or a provider error in plain words. */
  signInAnonymously(): Promise<{ cause: SignInFailure; message: string } | null>;
  signOut(): Promise<void>;
  /** The current user's ID token, or null while signed out. */
  idToken(): Promise<string | null>;
}

function appFor(config: FirebaseWebConfig): FirebaseApp {
  return getApps()[0] ?? initializeApp(config);
}

export function createAuthClient(config: FirebaseWebConfig): AuthClient {
  const auth: Auth = getAuth(appFor(config));
  return {
    subscribe: (listener) => onAuthStateChanged(auth, listener),
    async signIn() {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
        return null;
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        const cause = signInFailure(code);
        const detail = cause === "providerError" ? providerDetail(code) : null;
        return { cause, message: detail === null ? SIGN_IN_MESSAGES[cause] : `${SIGN_IN_MESSAGES[cause]} ${detail}` };
      }
    },
    async signInAnonymously() {
      try {
        await signInAnonymously(auth);
        return null;
      } catch (err) {
        // Only the error code is shown, never a token or a config value (R2.4).
        const detail = providerDetail((err as { code?: unknown } | null)?.code);
        return { cause: "providerError" as const, message: detail === null ? DEMO_SIGN_IN_FAILED : `${DEMO_SIGN_IN_FAILED} ${detail}` };
      }
    },
    signOut: () => signOut(auth),
    async idToken() {
      const user = auth.currentUser;
      return user === null ? null : user.getIdToken();
    },
  };
}
