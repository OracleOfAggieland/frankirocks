"use client";

import { initialVoiceState } from "@franki/core";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createApiClient } from "../client/api";
import { type AuthClient, type AuthState, createAuthClient } from "../client/auth";
import { createBrowserClock } from "../client/clock";
import { publicEnv, readFirebaseConfig } from "../client/firebase-config";
import { DEBUG_POLL_MS, DebugPanelModel } from "../client/debug-panel";
import { TypedTurns } from "../client/typed-turns";
import { type AudioLike, type PeerLike, SIGN_OUT_LIMIT_MS, VoiceClient } from "../client/voice-client";
import { TRANSCRIBE_VAR, transcribeModel } from "../client/voice-config";
import { AuthPanel } from "./AuthPanel";
import { CallScreen } from "./CallScreen";
import { DebugPanel } from "./DebugPanel";
import { ReplyLine } from "./ReplyLine";
import { TypedLine } from "./TypedLine";

const SIGNED_OUT_VOICE = initialVoiceState({ transcribeModel: "" });

/** The output audio element: muted until a verified Permit unmutes it (KV02). */
function outputAudio(): AudioLike {
  const el = new Audio();
  el.autoplay = true;
  el.muted = true;
  return el as unknown as AudioLike;
}

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

  // One set of controllers per signed-in user; a new sign-in starts with no Session and clientSeq 0.
  const signedIn = useMemo(() => {
    if (tokens === null) return null;
    const api = createApiClient({ getToken: () => tokens.idToken(), fetch: (input, init) => fetch(input, init) });
    const clock = createBrowserClock();
    const model = transcribeModel();
    const voice =
      model === null
        ? null
        : new VoiceClient({
            api,
            clock,
            transcribeModel: model,
            audio: outputAudio(),
            createPeer: () => new RTCPeerConnection() as unknown as PeerLike,
            getMicrophone: () => navigator.mediaDevices.getUserMedia({ audio: true }),
          });
    return { typed: new TypedTurns({ api, clock }), debug: new DebugPanelModel({ api, clock }), voice };
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
    // R9.5, R9.8: close any open Session (call or typed) and wait at most 5 s; the microphone and peer
    // connection are released locally at once. Then clear the Firebase user whatever the server answered.
    if (signedIn !== null) {
      const limit = new Promise<void>((resolve) => setTimeout(resolve, SIGN_OUT_LIMIT_MS));
      await Promise.race([Promise.all([signedIn.voice?.signOut(), signedIn.typed.closeSession(SIGN_OUT_LIMIT_MS)]), limit]);
    }
    await auth.signOut();
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-night-0 px-6 py-10 text-center text-ink">
      <h1 className="text-5xl font-semibold tracking-tight">Franki</h1>
      <AuthPanel
        state={state}
        busy={busy}
        configMissing={config.ok ? null : config.missing}
        onSignIn={() => void signIn()}
        onSignOut={() => void signOut()}
      />
      {/* Signed out, the typed input shows disabled and the Debug_Panel is hidden (R9.4). */}
      {signedIn === null ? <SignedOutArea /> : <SignedInArea typed={signedIn.typed} debug={signedIn.debug} voice={signedIn.voice} />}
    </main>
  );
}

const noop = () => {};

function SignedInArea({ typed, debug, voice }: { typed: TypedTurns; debug: DebugPanelModel; voice: VoiceClient | null }) {
  const t = useSyncExternalStore(typed.subscribe, typed.getSnapshot, typed.getSnapshot);
  const d = useSyncExternalStore(debug.subscribe, debug.getSnapshot, debug.getSnapshot);
  const subscribeVoice = voice?.subscribe ?? (() => noop);
  const getVoice = voice?.getSnapshot ?? (() => SIGNED_OUT_VOICE);
  const v = useSyncExternalStore(subscribeVoice, getVoice, getVoice);
  const [selected, setSelected] = useState<string | null>(null);
  const inCall = v.phase !== "CLOSED";
  // Polls at most every 5 s while a Session is open (R29.7): the typed Session or a call.
  const live = t.sessionId !== null || inCall;
  const turnsAcked = t.entries.length;

  useEffect(() => {
    void debug.refresh();
  }, [debug, turnsAcked, v.nextClientSeq]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void debug.refresh(), DEBUG_POLL_MS);
    return () => clearInterval(timer);
  }, [debug, live]);

  const call = () => {
    // A call open closes the typed Session on the server (KV09); the next typed line outside a call opens a new one.
    typed.dropSession();
    voice?.call();
  };

  return (
    <>
      <CallScreen
        voice={v}
        enabled={voice !== null}
        configMissing={voice === null ? TRANSCRIBE_VAR : null}
        onCall={call}
        onHangUp={() => voice?.hangUp()}
        onToggleMute={() => voice?.toggleMute()}
        onRetry={() => voice?.retry()}
      />
      <TypedArea typed={typed} voice={inCall ? voice : null} listening={v.phase === "LISTENING"} />
      <DebugPanel state={d} selectedMemoryId={selected} onSelectMemory={setSelected} onRefresh={() => void debug.refresh()} />
    </>
  );
}

/** Signed out or loading: the call button and typed input show but are disabled (R9.4, R9.7). */
function SignedOutArea() {
  return (
    <>
      <CallScreen voice={SIGNED_OUT_VOICE} enabled={false} onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />
      <TypedLine text="" enabled={false} sending={false} canSend={false} error={null} onChange={noop} onSubmit={noop} />
    </>
  );
}

/**
 * Typed input. With no call, lines go through `TypedTurns` (own Session, text reply). During a call they go to
 * the Voice_Client, which sends them while it is listening and plays the reply (design "One typed turn" step 4).
 */
function TypedArea({ typed, voice, listening }: { typed: TypedTurns; voice: VoiceClient | null; listening: boolean }) {
  const s = useSyncExternalStore(typed.subscribe, typed.getSnapshot, typed.getSnapshot);
  const submit = () => {
    if (voice === null) return void typed.submit();
    if (voice.sendTyped(s.text)) typed.setText("");
  };
  return (
    <>
      {voice === null ? <ReplyLine entries={s.entries} /> : null}
      <TypedLine
        text={s.text}
        enabled
        sending={s.sending}
        canSend={typed.canSend() && (voice === null || listening)}
        error={s.error}
        onChange={(t) => typed.setText(t)}
        onSubmit={submit}
      />
    </>
  );
}
