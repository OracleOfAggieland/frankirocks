"use client";

import { type VoiceState, initialVoiceState } from "@franki/core";
import { MotionConfig } from "motion/react";
import { createContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createApiClient } from "../client/api";
import { type AuthClient, type AuthState, createAuthClient } from "../client/auth";
import { createBrowserClock } from "../client/clock";
import { DEBUG_POLL_MS, type DebugPanelModel } from "../client/debug-panel";
import { publicEnv, readFirebaseConfig } from "../client/firebase-config";
import type { TypedTurns } from "../client/typed-turns";
import { type AudioLike, type PeerLike, SIGN_OUT_LIMIT_MS } from "../client/voice-client";
import { TRANSCRIBE_VAR, transcribeModel } from "../client/voice-config";
import { sharedAudio } from "../ui/audio/context";
import { debugVisible } from "../ui/debug-flag";
import { browserScheduler } from "../ui/hooks/frame-loop";
import { browserVisibility } from "../ui/hooks/page-visible";
import { browserWatcher } from "../ui/hooks/reduced-motion";
import { ScreenController, type ScreenSnapshot } from "../ui/hooks/screen-controller";
import { createLevelMeter } from "../ui/levels/level-meter";
import { createSoundEngine } from "../ui/sound/engine";
import { EMPTY_COPIES, type SignedInControllers, createSignedInControllers, onForgetComplete } from "./app-controllers";
import { AuthPanel } from "./AuthPanel";
import { Avatar } from "./avatar/Avatar";
import { Stage } from "./avatar/Stage";
import { CALL_ERRORS, CallScreen } from "./CallScreen";
import { DebugPanel } from "./DebugPanel";
import { LiveRegion } from "./LiveRegion";
import { ReplyLine } from "./ReplyLine";
import { MainScreen } from "./screen/MainScreen";
import { SoundToggle, soundPreference } from "./SoundToggle";
import { TypedLine } from "./TypedLine";

const SIGNED_OUT_VOICE = initialVoiceState({ transcribeModel: "" });
const noop = () => {};
const noSubscribe = () => noop;

/** The output audio element: muted until a verified Permit unmutes it (KV02). */
function outputAudio(): AudioLike {
  const el = new Audio();
  el.autoplay = true;
  el.muted = true;
  return el as unknown as AudioLike;
}

/** Called when a forget completes (R17.5). No forget result reaches the browser in this slice. */
export const ForgetCompleteContext = createContext<() => void>(noop);

function createScreen(meter: ReturnType<typeof createLevelMeter>): ScreenController {
  const context = () => sharedAudio()?.getContext() ?? null;
  return new ScreenController({
    scheduler: browserScheduler(),
    meter,
    visibility: browserVisibility(),
    reduced: browserWatcher(),
    gestured: () => sharedAudio()?.hasGesture() ?? false,
    soundOn: () => soundPreference().getSnapshot(),
    sound: createSoundEngine(context),
    callErrors: CALL_ERRORS,
  });
}

/**
 * The Browser_Client shell. Owns the Firebase auth state and, while signed in, the controllers.
 * FSC R9.4: nothing here calls an /api/ route while signed out; the controllers exist only while signed in.
 * The screen shows only today's sources (lab-ui-foundation R14.1).
 */
export function App() {
  const config = useMemo(() => readFirebaseConfig(publicEnv()), []);
  // Created in the browser only (in the effect), never during the server render.
  const authRef = useRef<AuthClient | null>(null);
  const [state, setState] = useState<AuthState>({ kind: "loading" });
  /** The signed-in user's ID token source, set with the auth state; null while signed out. */
  const [tokens, setTokens] = useState<{ idToken: () => Promise<string> } | null>(null);
  const [busy, setBusy] = useState(false);
  // R21: read once on the client; the server snapshot is false, so the panel never renders on the server.
  const debugOn = useSyncExternalStore(noSubscribe, () => debugVisible(process.env.NODE_ENV, window.location.search), () => false);
  const [meter] = useState(() => createLevelMeter(() => sharedAudio()?.getContext() ?? null));
  const [screen] = useState(() => createScreen(meter));
  const [, setCopies] = useState(EMPTY_COPIES);

  useEffect(() => {
    if (!config.ok) return;
    const client = createAuthClient(config.config);
    authRef.current = client;
    return client.subscribe((user) => {
      setState(user === null ? { kind: "signedOut", error: null } : { kind: "signedIn", email: user.email ?? "(no email)", uid: user.uid });
      setTokens(user === null ? null : { idToken: () => user.getIdToken() });
    });
  }, [config]);

  useEffect(() => {
    sharedAudio(); // listens for the Visit's first gesture (R11.7, R19.2)
    screen.start();
    return () => screen.stop();
  }, [screen]);

  // One set of controllers per signed-in user; a new sign-in starts with no Session and clientSeq 0.
  const signedIn = useMemo<SignedInControllers | null>(() => {
    if (tokens === null) return null;
    const api = createApiClient({ getToken: () => tokens.idToken(), fetch: (input, init) => fetch(input, init) });
    return createSignedInControllers({
      api,
      clock: createBrowserClock(),
      transcribeModel: transcribeModel(),
      debug: debugOn,
      audio: outputAudio,
      createPeer: () => new RTCPeerConnection() as unknown as PeerLike,
      getMicrophone: () => navigator.mediaDevices.getUserMedia({ audio: true }),
      onStreams: (s) => meter.setStreams({ mic: s.mic as unknown as MediaStream | null, output: s.output as MediaStream | null }),
      inputLevel: () => meter.rawInput(),
    });
  }, [tokens, debugOn, meter]);

  useEffect(() => {
    screen.setSources(signedIn !== null, signedIn?.voice ?? null);
  }, [screen, signedIn]);

  const snap = useSyncExternalStore(screen.subscribe, screen.getSnapshot, screen.getSnapshot);
  const forget = () => setCopies((c) => onForgetComplete(signedIn?.typed ?? null, c));

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

  const auth = (
    <AuthPanel state={state} busy={busy} configMissing={config.ok ? null : config.missing} onSignIn={() => void signIn()} onSignOut={() => void signOut()} />
  );

  return (
    <MotionConfig reducedMotion={snap.input.reducedMotion ? "always" : "never"}>
      <ForgetCompleteContext.Provider value={forget}>
        {signedIn === null ? <SignedOutScreen snap={snap} auth={auth} /> : <SignedInScreen snap={snap} auth={auth} controllers={signedIn} />}
      </ForgetCompleteContext.Provider>
    </MotionConfig>
  );
}

function StageFor({ snap }: { snap: ScreenSnapshot }) {
  return (
    <Stage reduced={snap.input.reducedMotion}>
      <Avatar look={snap.look} input={snap.input} frameTime={snap.frameTime} />
    </Stage>
  );
}

/** Signed out or loading: Dormant, FRANKIROCKS, the sign-in button, and disabled call and typed controls (R13). */
function SignedOutScreen({ snap, auth }: { snap: ScreenSnapshot; auth: React.ReactNode }) {
  return (
    <MainScreen
      signedIn={false}
      reduced={snap.input.reducedMotion}
      paused={snap.paused}
      auth={auth}
      soundToggle={<SoundToggle />}
      stage={<StageFor snap={snap} />}
      controls={<CallScreen voice={SIGNED_OUT_VOICE} enabled={false} onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />}
      typed={<TypedLine text="" enabled={false} sending={false} canSend={false} error={null} onChange={noop} onSubmit={noop} />}
      live={<LiveRegion message={snap.live.message} seq={snap.live.seq} />}
    />
  );
}

function SignedInScreen({ snap, auth, controllers }: { snap: ScreenSnapshot; auth: React.ReactNode; controllers: SignedInControllers }) {
  const { typed, voice, debug } = controllers;
  const subscribeVoice = voice?.subscribe ?? noSubscribe;
  const getVoice = voice?.getSnapshot ?? (() => SIGNED_OUT_VOICE);
  const v = useSyncExternalStore(subscribeVoice, getVoice, getVoice);
  const t = useSyncExternalStore(typed.subscribe, typed.getSnapshot, typed.getSnapshot);
  const inCall = v.phase !== "CLOSED";

  const call = () => {
    // A call open closes the typed Session on the server (KV09); the next typed line outside a call opens a new one.
    typed.dropSession();
    voice?.call();
  };
  const submit = () => {
    if (!inCall || voice === null) return void typed.submit();
    if (voice.sendTyped(t.text)) typed.setText("");
  };

  return (
    <MainScreen
      signedIn
      reduced={snap.input.reducedMotion}
      paused={snap.paused}
      auth={auth}
      soundToggle={<SoundToggle />}
      stage={<StageFor snap={snap} />}
      controls={
        <CallScreen
          voice={v}
          enabled={voice !== null}
          configMissing={voice === null ? TRANSCRIBE_VAR : null}
          onCall={call}
          onHangUp={() => voice?.hangUp()}
          onToggleMute={() => voice?.toggleMute()}
          onRetry={() => voice?.retry()}
        />
      }
      typed={
        <TypedLine
          text={t.text}
          enabled
          sending={t.sending}
          canSend={typed.canSend() && (!inCall || v.phase === "LISTENING")}
          error={t.error}
          onChange={(text) => typed.setText(text)}
          onSubmit={submit}
        />
      }
      reply={inCall ? null : <ReplyLine entries={t.entries} />}
      debug={debug === null ? null : <DebugArea debug={debug} typed={typed} voice={v} />}
      live={<LiveRegion message={snap.live.message} seq={snap.live.seq} />}
    />
  );
}

/** The Debug_Panel, only behind ?debug=1 in development (R21). It loads at once and polls while live. */
function DebugArea({ debug, typed, voice }: { debug: DebugPanelModel; typed: TypedTurns; voice: VoiceState }) {
  const d = useSyncExternalStore(debug.subscribe, debug.getSnapshot, debug.getSnapshot);
  const t = useSyncExternalStore(typed.subscribe, typed.getSnapshot, typed.getSnapshot);
  const [selected, setSelected] = useState<string | null>(null);
  // Polls at most every 5 s while a Session is open (FSC R29.7): the typed Session or a call.
  const live = t.sessionId !== null || voice.phase !== "CLOSED";
  const turnsAcked = t.entries.length;

  useEffect(() => {
    void debug.refresh();
  }, [debug, turnsAcked, voice.nextClientSeq]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void debug.refresh(), DEBUG_POLL_MS);
    return () => clearInterval(timer);
  }, [debug, live]);

  return <DebugPanel state={d} selectedMemoryId={selected} onSelectMemory={setSelected} onRefresh={() => void debug.refresh()} latency={voice.latency.rows} realtimeErrors={voice.realtimeErrors} />;
}
