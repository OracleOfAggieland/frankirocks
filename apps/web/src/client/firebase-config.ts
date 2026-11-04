/**
 * Public Firebase web config (owner action 2). The values come from the NEXT_PUBLIC_FIREBASE_* entries in
 * apps/web/apphosting.yaml; Next inlines them into the browser bundle at build time. They are identifiers, not
 * secrets. Each `process.env.NEXT_PUBLIC_*` reference is written out in full, because Next only inlines literal
 * references.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export type ConfigResult = { ok: true; config: FirebaseWebConfig } | { ok: false; missing: string[] };

export interface PublicEnv {
  NEXT_PUBLIC_FIREBASE_API_KEY?: string;
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
  NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
  NEXT_PUBLIC_FIREBASE_APP_ID?: string;
}

/** The public env as inlined by Next. */
export function publicEnv(): PublicEnv {
  return {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

/** Pure: builds the config, or names (never prints) each missing variable. */
export function readFirebaseConfig(env: PublicEnv): ConfigResult {
  const pick = (name: keyof PublicEnv) => {
    const v = env[name];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  const entries = {
    apiKey: pick("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: pick("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    projectId: pick("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    appId: pick("NEXT_PUBLIC_FIREBASE_APP_ID"),
  };
  const names: Record<keyof typeof entries, keyof PublicEnv> = {
    apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
    authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
  };
  const missing = (Object.keys(entries) as (keyof typeof entries)[]).filter((k) => entries[k] === null).map((k) => names[k]);
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, config: entries as FirebaseWebConfig };
}
