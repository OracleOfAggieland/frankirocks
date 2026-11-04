/**
 * Firebase Admin initialization (R30.11; design "Admin SDK project"). One app per process, initialized with the
 * explicit project ID from FRANKI_FIREBASE_PROJECT_ID, because Application Default Credentials from a user account
 * do not reliably supply one. A missing variable is ConfigError naming it, before the SDK is touched.
 */
import { type App, getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { type Env, firebaseProjectId } from "./env";

export interface AdminSdk {
  getApps: () => App[];
  initializeApp: (options: { projectId: string }) => App;
}

const realSdk: AdminSdk = { getApps, initializeApp: (options) => initializeApp(options) };

/** Returns the default Admin app, initializing it once with the configured project ID. */
export function adminApp(env: Env = process.env, sdk: AdminSdk = realSdk): App {
  const projectId = firebaseProjectId(env);
  const existing = sdk.getApps()[0];
  return existing ?? sdk.initializeApp({ projectId });
}

/** Firestore for the default Admin app. */
export function adminFirestore(env: Env = process.env): Firestore {
  return getFirestore(adminApp(env));
}
