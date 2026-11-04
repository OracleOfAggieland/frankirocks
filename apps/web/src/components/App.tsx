"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type AuthClient, type AuthState, createAuthClient } from "../client/auth";
import { publicEnv, readFirebaseConfig } from "../client/firebase-config";
import { AuthPanel } from "./AuthPanel";

/**
 * The Browser_Client shell. Owns the Firebase auth state; signed-in controls arrive in later tasks.
 * R9.4: nothing here calls an /api/ route while signed out.
 */
export function App() {
  const config = useMemo(() => readFirebaseConfig(publicEnv()), []);
  // Created in the browser only (in the effect), never during the server render.
  const authRef = useRef<AuthClient | null>(null);
  const [state, setState] = useState<AuthState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config.ok) return;
    const client = createAuthClient(config.config);
    authRef.current = client;
    return client.subscribe((user) => {
      setState(user === null ? { kind: "signedOut", error: null } : { kind: "signedIn", email: user.email ?? "(no email)", uid: user.uid });
    });
  }, [config]);

  const signIn = async () => {
    const auth = authRef.current;
    if (auth === null || busy) return;
    setBusy(true);
    const failure = await auth.signIn();
    setBusy(false);
    // On success onAuthStateChanged reports the user. On failure stay signed out with the cause (R9.6).
    if (failure !== null) setState({ kind: "signedOut", error: failure });
  };

  const signOut = async () => {
    const auth = authRef.current;
    if (auth === null) return;
    await auth.signOut();
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-center text-zinc-100">
      <h1 className="text-5xl font-semibold tracking-tight">Franki</h1>
      <AuthPanel
        state={state}
        busy={busy}
        configMissing={config.ok ? null : config.missing}
        onSignIn={() => void signIn()}
        onSignOut={() => void signOut()}
      />
    </main>
  );
}
