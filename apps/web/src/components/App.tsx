"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createApiClient } from "../client/api";
import { type AuthClient, type AuthState, createAuthClient } from "../client/auth";
import { createBrowserClock } from "../client/clock";
import { publicEnv, readFirebaseConfig } from "../client/firebase-config";
import { TypedTurns } from "../client/typed-turns";
import { AuthPanel } from "./AuthPanel";
import { ConversationView, TypedInput } from "./TypedInput";

/**
 * The Browser_Client shell. Owns the Firebase auth state and, while signed in, the typed-turn controller.
 * R9.4: nothing here calls an /api/ route while signed out; the controller exists only while signed in.
 */
export function App() {
  const config = useMemo(() => readFirebaseConfig(publicEnv()), []);
  // Created in the browser only (in the effect), never during the server render.
  const authRef = useRef<AuthClient | null>(null);
  const [state, setState] = useState<AuthState>({ kind: "loading" });
  /** The signed-in user's ID token source, set with the auth state; null while signed out. */
  const [tokens, setTokens] = useState<{ idToken: () => Promise<string> } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config.ok) return;
    const client = createAuthClient(config.config);
    authRef.current = client;
    return client.subscribe((user) => {
      setState(user === null ? { kind: "signedOut", error: null } : { kind: "signedIn", email: user.email ?? "(no email)", uid: user.uid });
      setTokens(user === null ? null : { idToken: () => user.getIdToken() });
    });
  }, [config]);

  // One controller per signed-in user; a new sign-in starts with no Session and clientSeq 0.
  const typed = useMemo(() => {
    if (tokens === null) return null;
    const api = createApiClient({ getToken: () => tokens.idToken(), fetch: (input, init) => fetch(input, init) });
    return new TypedTurns({ api, clock: createBrowserClock() });
  }, [tokens]);

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
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-950 px-6 py-10 text-center text-zinc-100">
      <h1 className="text-5xl font-semibold tracking-tight">Franki</h1>
      <AuthPanel
        state={state}
        busy={busy}
        configMissing={config.ok ? null : config.missing}
        onSignIn={() => void signIn()}
        onSignOut={() => void signOut()}
      />
      {typed === null ? <SignedOutTyped /> : <TypedArea typed={typed} />}
    </main>
  );
}

/** Signed out or loading: the typed input shows but is disabled (R9.4, R9.7). */
function SignedOutTyped() {
  return <TypedInput text="" enabled={false} sending={false} canSend={false} error={null} onChange={() => {}} onSubmit={() => {}} />;
}

function TypedArea({ typed }: { typed: TypedTurns }) {
  const s = useSyncExternalStore(typed.subscribe, typed.getSnapshot, typed.getSnapshot);
  return (
    <>
      <ConversationView entries={s.entries} />
      <TypedInput
        text={s.text}
        enabled
        sending={s.sending}
        canSend={typed.canSend()}
        error={s.error}
        onChange={(t) => typed.setText(t)}
        onSubmit={() => void typed.submit()}
      />
    </>
  );
}
