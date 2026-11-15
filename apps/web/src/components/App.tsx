"use client";

import { type VoiceState, initialVoiceState } from "@franki/core";
import { AnimatePresence, MotionConfig } from "motion/react";
import { createContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createApiClient } from "../client/api";
import { type AuthClient, type AuthState, createAuthClient } from "../client/auth";
import { type BrowserClock, createBrowserClock } from "../client/clock";
import { DEBUG_POLL_MS, type DebugPanelModel } from "../client/debug-panel";
import { publicEnv, readFirebaseConfig } from "../client/firebase-config";
import type { LiveTest } from "../client/live-test";
import type { TypedState, TypedTurns } from "../client/typed-turns";
import { type AudioLike, type PeerLike, SIGN_OUT_LIMIT_MS } from "../client/voice-client";
import { TRANSCRIBE_VAR, transcribeModel } from "../client/voice-config";
import type { MemoryState } from "../client/memory-model";
import { COPY } from "../ui/copy";
import { NO_SURFACES, goneAskCard, readoutCard } from "../ui/memory-screen";
import { sharedAudio } from "../ui/audio/context";
import { debugVisible } from "../ui/debug-flag";
import { browserScheduler } from "../ui/hooks/frame-loop";
import { browserVisibility } from "../ui/hooks/page-visible";
import { browserWatcher } from "../ui/hooks/reduced-motion";
import { ABSENT_PHONE, type PhoneView } from "../ui/phone/phone-call";
import { ScreenController, type ScreenSnapshot } from "../ui/hooks/screen-controller";
import { createLevelMeter } from "../ui/levels/level-meter";
import { createSoundEngine } from "../ui/sound/engine";
import { EMPTY_COPIES, type SignedInControllers, createSignedInControllers, onForgetComplete } from "./app-controllers";
import { AuthPanel } from "./AuthPanel";
import { Avatar } from "./avatar/Avatar";
import { AvatarAudioContext } from "./avatar/avatar-audio";
import { Stage } from "./avatar/Stage";
import { CALL_ERRORS, CallScreen } from "./CallScreen";
import { DebugPanel } from "./DebugPanel";
import { LiveRegion } from "./LiveRegion";
import { PhoneOnStage } from "./phone/PhoneOnStage";
import { ReplyLine } from "./ReplyLine";
import { MainScreen } from "./screen/MainScreen";
import { SoundToggle, soundPreference } from "./SoundToggle";
import { TypedLine } from "./TypedLine";
import { Jar } from "./surfaces/Jar";
import { Lab } from "./surfaces/Lab";
import { Receipt } from "./surfaces/Receipt";
import { Strip } from "./surfaces/Strip";
import { TimeBadge } from "./surfaces/TimeBadge";
import { VisitBar } from "./surfaces/VisitBar";
import { WhatIKnowSheet } from "./surfaces/WhatIKnowSheet";
import { CLOSED_SHEET, type SheetState } from "../client/sheet-model";
import { INITIAL_VISIT, type VisitState, badgeFor, boltEnabled, inputAllowed } from "../ui/visit/visit-machine";
import { boltTargets } from "../ui/visit/bolt-targets";
import { proactiveCards, replyEntries, type ShownProactive } from "../ui/visit/proactive-view";
import { type ShownCallCards, callCardProps } from "../ui/call-cards";
import { NO_ERRANDS_SHOWN, type ShownErrands, errandCardProps, errandWord } from "../ui/errands/errand-view";
import { ErrandWord } from "./errands/ErrandWord";
// Brief 046 part B.
import { INITIAL_BANK, type BankState } from "../ui/bank/bank-machine";
import { BankLinkHost } from "./bank/BankLinkHost";
import { BankSheet } from "./bank/BankSheet";
import { BankWayIn } from "./bank/BankWayIn";
import { INITIAL_GOOGLE, type GoogleState } from "../ui/google/google-machine";
import { GoogleSheet } from "./google/GoogleSheet";
import { GoogleWayIn } from "./google/GoogleWayIn";
// Brief 047 part D: the radio and its globe.
import { createLiveRadio, createRadioHost, feedRadioVoice, radioHears } from "../client/radio-live";
import type { RadioWatch } from "../client/radio-watch";
import { STATIONS } from "../ui/radio/stations";
import { RADIO_OFF_VIEW, type RadioView, radioPropView } from "../ui/radio/types";
import { RadioOnStage } from "./radio/RadioOnStage";
import { RadioPanel } from "./radio/RadioPanel";

const SIGNED_OUT_VOICE = initialVoiceState({ transcribeModel: "" });
const noop = () => {};
const noSubscribe = () => noop;
const signedOutVoice = () => SIGNED_OUT_VOICE;
/** The typed snapshot while signed out: there is no typed Session to read. */
const noTyped = (): TypedState | null => null;
/** The phone while signed out: nothing hangs on the wall. */
const noPhone = (): PhoneView => ABSENT_PHONE;
/** Memory while signed out: nothing is read, so nothing shows. */
const NO_MEMORY: MemoryState = { surfaces: NO_SURFACES, readout: null, goneAsk: false };
const noMemory = (): MemoryState => NO_MEMORY;
/** Brief 027: the visit, the sheet and the proactive line while signed out: none. */
const noVisit = (): VisitState => INITIAL_VISIT;
const noSheet = (): SheetState => CLOSED_SHEET;
const noShown = (): ShownProactive | null => null;
const noCallCards = (): ShownCallCards | null => null;
const noErrands = (): ShownErrands => NO_ERRANDS_SHOWN;
/** Brief 046 part B: the bank sheet while signed out: closed, nothing known. */
const noBank = (): BankState => INITIAL_BANK;
/** Brief 049 part B: the Google sheet while signed out: closed, nothing known. */
const noGoogle = (): GoogleState => INITIAL_GOOGLE;
/** Brief 047: the radio before its watch exists (the server render and the first client render): off. */
const noRadio = (): RadioView => RADIO_OFF_VIEW;
/** Brief 047: no radio watch during the server render. */
const noWatch = (): RadioWatch | null => null;
/** Brief 047: closing the globe puts focus back on the radio on the stage. */
function focusRadioButton(): void {
  document.querySelector<HTMLElement>("[data-radio-button]")?.focus();
}

/** The browser's localStorage, or null where it cannot be reached (brief 027: the visit is kept there). */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The output audio element: muted until a verified Permit unmutes it (KV02). */
function outputAudio(): AudioLike {
  const el = new Audio();
  el.autoplay = true;
  el.muted = true;
  return el as unknown as AudioLike;
}

/** Brief 050: the live test recorder once loaded, for API clients made before it arrived. Null unless the dev flag is set. */
const liveTestNow: { current: LiveTest | null } = { current: null };

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
  const [tokens, setTokens] = useState<{ idToken: () => Promise<string>; uid: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // R21: read once on the client; the server snapshot is false, so the panel never renders on the server.
  const debugOn = useSyncExternalStore(noSubscribe, () => debugVisible(process.env.NODE_ENV, window.location.search), () => false);
  const [meter] = useState(() => createLevelMeter(() => sharedAudio()?.getContext() ?? null));
  const [screen] = useState(() => createScreen(meter));
  // One browser clock for the controllers and the Time_Badge's real-time reading (brief 027).
  const [clock] = useState(() => createBrowserClock());
  const [, setCopies] = useState(EMPTY_COPIES);
  // Brief 050: the development-only live test recorder, loaded only when the dev launcher set the flag at build.
  const [liveTest, setLiveTest] = useState<LiveTest | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_FRANKI_LIVE_TEST === "1") {
      void import("../client/live-test")
        .then((m) => {
          const lt = m.startLiveTest();
          liveTestNow.current = lt;
          setLiveTest(lt);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!config.ok) return;
    const client = createAuthClient(config.config);
    authRef.current = client;
    return client.subscribe((user) => {
      setState(user === null ? { kind: "signedOut", error: null } : { kind: "signedIn", email: user.email ?? "(no email)", uid: user.uid });
      setTokens(user === null ? null : { idToken: () => user.getIdToken(), uid: user.uid });
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
    const api = createApiClient({
      getToken: () => tokens.idToken(),
      fetch: (input, init) => fetch(input, init),
      ...(process.env.NEXT_PUBLIC_FRANKI_LIVE_TEST === "1" ? { observe: (route: string, method: string) => liveTestNow.current?.api(route, method) } : {}),
    });
    return createSignedInControllers({
      api,
      clock,
      transcribeModel: transcribeModel(),
      debug: debugOn,
      audio: outputAudio,
      createPeer: () => new RTCPeerConnection() as unknown as PeerLike,
      getMicrophone: () => navigator.mediaDevices.getUserMedia({ audio: true }),
      onStreams: (s) => meter.setStreams({ mic: s.mic as unknown as MediaStream | null, output: s.output as MediaStream | null }),
      inputLevel: () => meter.rawInput(),
      uid: tokens.uid,
      storage: browserStorage(),
    });
  }, [tokens, debugOn, meter, clock]);

  useEffect(() => {
    screen.setSources(signedIn !== null, signedIn?.voice ?? null);
  }, [screen, signedIn]);

  // The phone follows the voice reducer's tool calls; it stops reading when the user signs out.
  useEffect(() => {
    if (signedIn === null) return;
    const { voice, phone } = signedIn;
    phone.start();
    const off = voice === null ? noop : voice.subscribe(() => phone.onVoice(voice.getSnapshot()));
    return () => {
      off();
      phone.stop();
    };
  }, [signedIn]);

  // Brief 050: the recorder hears the user, the call, its latency rows and the phone. Nothing when it is off.
  useEffect(() => {
    if (liveTest === null || state.kind === "loading") return;
    liveTest.user(state.kind === "signedIn" ? state.uid : null);
  }, [liveTest, state]);
  useEffect(() => {
    if (liveTest === null || signedIn === null) return;
    const { voice, phone } = signedIn;
    voice?.observe(liveTest.voice);
    const offVoice = voice === null ? noop : liveTest.watchVoice(voice);
    const offPhone = liveTest.watchPhone(phone);
    return () => {
      voice?.observe(null);
      offVoice();
      offPhone();
    };
  }, [liveTest, signedIn]);

  // Brief 046 part B: the bank sheet sends nothing until it is opened, and drops everything on sign-out.
  useEffect(() => {
    if (signedIn === null) return;
    const { bank } = signedIn;
    bank.start();
    return () => bank.stop();
  }, [signedIn]);

  // Brief 049 part B: the Google sheet sends nothing until it is opened, and drops everything on sign-out.
  useEffect(() => {
    if (signedIn === null) return;
    const { google } = signedIn;
    google.start();
    return () => google.stop();
  }, [signedIn]);

  // The memory surfaces read once on sign-in, again after each answered typed line, and drop on sign-out (brief 020).
  useEffect(() => {
    if (signedIn === null) return;
    const { memory } = signedIn;
    void memory.refresh();
    return () => memory.clear();
  }, [signedIn]);

  // Brief 027: entering the lab signed in starts or resumes the visit; signing out stops it and closes the sheet.
  useEffect(() => {
    if (signedIn === null) return;
    const { visit, sheet, proactive } = signedIn;
    visit.enter();
    return () => {
      visit.stop();
      sheet.clear();
      proactive.clear();
      signedIn.callCards.clear();
      signedIn.company.clear();
    };
  }, [signedIn]);

  // Brief 047: one radio for the app's life, in both auth states. StrictMode runs this twice and dispose() is final,
  // so each run makes its own watch. "Franki, you rock" makes Franki celebrate.
  const [radioHost] = useState(() => createRadioHost(() => createLiveRadio(() => screen.celebrate())));
  useEffect(() => {
    radioHost.start();
    return () => radioHost.stop();
  }, [radioHost]);
  const radio = useSyncExternalStore(radioHost.subscribe, radioHost.getSnapshot, noWatch);
  useEffect(() => {
    if (liveTest === null || radio === null) return;
    return liveTest.watchRadio(radio);
  }, [liveTest, radio]);

  // Brief 047: the radio follows the call's voice (ducking, and the owner's spoken phrase); when the feed ends
  // (sign-out, or a new voice client) it is fed one closed call, so it stops ducking.
  useEffect(() => {
    const voice = signedIn?.voice ?? null;
    if (radio === null || voice === null) return;
    return feedRadioVoice(radio, voice);
  }, [radio, signedIn]);

  const snap = useSyncExternalStore(screen.subscribe, screen.getSnapshot, screen.getSnapshot);
  const forget = () => {
    setCopies((c) => onForgetComplete(signedIn?.typed ?? null, c));
    // A completed forget drops what the screen shows, then reads it again.
    signedIn?.memory.clear();
    void signedIn?.memory.refresh();
    signedIn?.sheet.clear();
    signedIn?.proactive.clear();
    signedIn?.callCards.clear();
    // Review fix V6: the errands' cards and word go too; the next poll shows what is left.
    signedIn?.errands.clear();
  };

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
        {/* The three.js ghost reads Franki's voice and the mic through the Level_Meter's second analysers (brief 013, D-1). */}
        <AvatarAudioContext.Provider value={meter.audio}>
          <Screen snap={snap} auth={auth} controllers={signedIn} clock={clock} radio={radio} liveTest={liveTest} />
        </AvatarAudioContext.Provider>
      </ForgetCompleteContext.Provider>
    </MotionConfig>
  );
}

function StageFor({ snap, phone, radio, onRadio, errandText }: { snap: ScreenSnapshot; phone: PhoneView; radio: RadioView; onRadio: () => void; errandText: string | null }) {
  // Brief 047: the radio stands on the floor beside the phone, in the stage's aside.
  const aside = (
    <>
      <PhoneOnStage view={phone} />
      <RadioOnStage view={radioPropView(radio)} onPress={onRadio} />
      {/* Brief 049 part A, ruling 12: a small word while an errand runs. */}
      <ErrandWord text={errandText} />
    </>
  );
  return (
    <Stage reduced={snap.input.reducedMotion} aside={aside}>
      <Avatar look={snap.look} input={snap.input} frameTime={snap.frameTime} />
    </Stage>
  );
}

/**
 * One screen component for both auth states, so `StageFor` keeps its place in the tree and the stage
 * (with its avatar engine) stays mounted across sign-in: it glides to its signed-in place instead of
 * being replaced. The hooks run in both states through the `noSubscribe` and `SIGNED_OUT_VOICE`
 * fallbacks; each state renders the same markup it did as its own component. Only the stage is shared: the
 * call and typed controls carry a per-state key, so they remount on an auth change as they did when each state
 * was its own component (a typed line opened before sign-out comes back collapsed).
 *
 * Signed out or loading (`controllers` null): Dormant, FRANKIROCKS, the sign-in button, and disabled
 * call and typed controls (R13).
 */
function Screen({
  snap,
  auth,
  controllers,
  clock,
  radio,
  liveTest,
}: {
  snap: ScreenSnapshot;
  auth: React.ReactNode;
  controllers: SignedInControllers | null;
  clock: BrowserClock;
  radio: RadioWatch | null;
  liveTest: LiveTest | null;
}) {
  const typed = controllers?.typed ?? null;
  const voice = controllers?.voice ?? null;
  const debug = controllers?.debug ?? null;
  const subscribeVoice = voice?.subscribe ?? noSubscribe;
  const getVoice = voice?.getSnapshot ?? signedOutVoice;
  const v = useSyncExternalStore(subscribeVoice, getVoice, getVoice);
  const subscribeTyped = typed?.subscribe ?? noSubscribe;
  const getTyped = typed?.getSnapshot ?? noTyped;
  const t = useSyncExternalStore(subscribeTyped, getTyped, getTyped);
  const inCall = v.phase !== "CLOSED";
  const subscribePhone = controllers?.phone.subscribe ?? noSubscribe;
  const getPhone = controllers?.phone.getSnapshot ?? noPhone;
  const phone = useSyncExternalStore(subscribePhone, getPhone, getPhone);
  const subscribeMemory = controllers?.memory.subscribe ?? noSubscribe;
  const getMemory = controllers?.memory.getSnapshot ?? noMemory;
  const mem = useSyncExternalStore(subscribeMemory, getMemory, getMemory);
  // Brief 027: the visit, the sheet and the proactive line.
  const getVisit = controllers?.visit.getSnapshot ?? noVisit;
  const vis = useSyncExternalStore(controllers?.visit.subscribe ?? noSubscribe, getVisit, getVisit);
  const getSheet = controllers?.sheet.getSnapshot ?? noSheet;
  const sheetState = useSyncExternalStore(controllers?.sheet.subscribe ?? noSubscribe, getSheet, getSheet);
  const getShown = controllers?.proactive.getSnapshot ?? noShown;
  const shown = useSyncExternalStore(controllers?.proactive.subscribe ?? noSubscribe, getShown, getShown);
  // Brief 044, item 1: the cards the call's last tool answer brought.
  // Brief 049 part A: the errands' running word and cards.
  const getErrands = controllers?.errands.getSnapshot ?? noErrands;
  const errandsShown = useSyncExternalStore(controllers?.errands.subscribe ?? noSubscribe, getErrands, getErrands);
  const getCallCards = controllers?.callCards.getSnapshot ?? noCallCards;
  const called = useSyncExternalStore(controllers?.callCards.subscribe ?? noSubscribe, getCallCards, getCallCards);
  // Brief 046 part B: the bank sheet.
  const getBank = controllers?.bank.getSnapshot ?? noBank;
  const bankState = useSyncExternalStore(controllers?.bank.subscribe ?? noSubscribe, getBank, getBank);
  // Brief 049 part B: the Google sheet.
  const getGoogle = controllers?.google.getSnapshot ?? noGoogle;
  const googleState = useSyncExternalStore(controllers?.google.subscribe ?? noSubscribe, getGoogle, getGoogle);

  // Brief 047: the radio, its globe panel, and the owner's sent lines it hears.
  const radioView = useSyncExternalStore(radio?.subscribe ?? noSubscribe, radio?.getSnapshot ?? noRadio, noRadio);
  const pressRadio = () => radio?.controls.press();
  const radioLayer = (
    <AnimatePresence>
      {radio !== null && radioView.panel === "open" ? (
        <RadioPanel key="radio-panel" view={radioView} stations={STATIONS} controls={radio.controls} reduced={snap.input.reducedMotion} onClosed={focusRadioButton} />
      ) : null}
    </AnimatePresence>
  );
  const hear = (text: string, pasted: boolean) => {
    const words = radioHears(text, pasted);
    if (words !== null) radio?.onTypedLine(words);
  };

  const stage = <StageFor snap={snap} phone={phone} radio={radioView} onRadio={pressRadio} errandText={errandWord(errandsShown)} />;
  const live = <LiveRegion message={snap.live.message} seq={snap.live.seq} />;
  // Brief 038 finding 1, the input gate: no chip, typed line or new call until the server has said which account this is.
  const takesInput = inputAllowed(vis);

  if (controllers === null || typed === null || t === null) {
    return (
      <MainScreen
        signedIn={false}
        reduced={snap.input.reducedMotion}
        paused={snap.paused}
        auth={auth}
        soundToggle={<SoundToggle />}
        stage={stage}
        controls={<CallScreen key="call-signed-out" voice={SIGNED_OUT_VOICE} enabled={false} onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />}
        typed={<TypedLine key="typed-signed-out" text="" enabled={false} sending={false} canSend={false} error={null} onChange={noop} onSubmit={noop} />}
        live={live}
        sheet={radioLayer}
      />
    );
  }

  const call = () => {
    // A call open closes the typed Session on the server (KV09); the next typed line outside a call opens a new one.
    typed.dropSession();
    voice?.call();
  };
  const submit = () => {
    if (!inCall || voice === null) {
      // Brief 047: the radio hears the line the box will send (never a pasted one); it does not wait for the server.
      if (typed.canSend()) {
        hear(t.text, t.pasted);
        liveTest?.typed(t.text, false);
      }
      return void typed.submit();
    }
    // Brief 040, item 3 (replaces the hold of W-179): a pasted line goes into the call as pasted text.
    if (voice.sendTyped(t.text, t.pasted ? "pasted" : "typed")) {
      hear(t.text, t.pasted);
      liveTest?.typed(t.text, true);
      typed.setText("");
    }
  };

  // Nov 13, owner: the main screen shows no chips and no walked-in tap. The readout and company models stay.
  const memory = controllers.memory;
  // The card leaves with focus on its Close, so focus goes back to the chip that opened it.
  const closeReadout = () => {
    memory.closeReadout();
    document.querySelector<HTMLElement>("[data-chips] button")?.focus({ preventScroll: true });
  };
  const memoryCards = [
    ...(mem.goneAsk ? [goneAskCard((a) => memory.answerGone(a), noop)] : []),
    ...(mem.readout === null ? [] : [readoutCard(mem.readout, noop, closeReadout)]),
  ];
  const receipt = mem.surfaces.receipt === null ? null : <Receipt {...mem.surfaces.receipt} />;
  // Brief 027: the proactive line's cards join the dock; the badge reads the real clock through the clock port.
  const allCards = [...memoryCards, ...callCardProps(called), ...errandCardProps(errandsShown), ...proactiveCards(shown)];
  const pair = clock.read();
  // Brief 038 finding 5: no clock until the server has said which one the account runs on.
  const badge = badgeFor(vis, pair.opsClock.now, pair.worldClock.zone);
  const visitControls = controllers.visit;
  const sheetModel = controllers.sheet;
  const visitBar = (
    <VisitBar
      phase={vis.phase}
      failure={vis.failure}
      bolt={vis.bolt}
      boltFailed={vis.boltFailed}
      confirming={vis.confirming}
      endingCall={vis.endingCall}
      targets={vis.worldMs === null ? [] : boltTargets(vis.worldMs, pair.worldClock.zone)}
      boltEnabled={boltEnabled(vis)}
      onBolt={(to) => visitControls.press(to)}
      onRetry={() => visitControls.retry()}
      onStartOver={() => visitControls.askStartOver()}
      onConfirm={() => visitControls.confirmStartOver()}
      onCancel={() => visitControls.cancelStartOver()}
    />
  );
  // The sheet is read-only while no control route reaches the browser (brief 027 ruling SHEET_READ_ONLY).
  const sheetLayer = (
    <AnimatePresence>
      {sheetState.open && (sheetState.items.length > 0 || receipt !== null) ? (
        <WhatIKnowSheet
          key="sheet"
          presentation="sheet"
          items={sheetState.items}
          readOnly
          footer={receipt}
          onWrong={noop}
          onForget={noop}
          onQuiet={noop}
          onClose={() => sheetModel.close()}
        />
      ) : null}
    </AnimatePresence>
  );
  // Brief 046 part B: the bank sheet's layer, and Plaid Link while a Link session is out.
  const bankModel = controllers.bank;
  const bankLayer = (
    <>
      <AnimatePresence>
        {bankState.open ? (
          <BankSheet
            key="bank-sheet"
            presentation="sheet"
            state={bankState}
            zone={pair.worldClock.zone}
            onClose={() => bankModel.close()}
            onRetry={() => bankModel.retry()}
            onConnect={() => bankModel.connect()}
            onDisconnect={(id) => bankModel.askDisconnect(id)}
            onYes={() => bankModel.confirmDisconnect()}
            onNotNow={() => bankModel.notNow()}
          />
        ) : null}
      </AnimatePresence>
      <BankLinkHost
        link={bankState.phase === "linking" ? bankState.link : null}
        onOpened={(s) => bankModel.linkOpened(s)}
        onSuccess={(s, success) => bankModel.linkSuccess(s, success)}
        onExit={(s, error) => bankModel.linkExit(s, error)}
      />
    </>
  );
  // Brief 049 part B: the Google sheet's layer. Google's own window is opened by the watch, in the press.
  const googleModel = controllers.google;
  const googleLayer = (
    <AnimatePresence>
      {googleState.open ? (
        <GoogleSheet
          key="google-sheet"
          presentation="sheet"
          state={googleState}
          zone={pair.worldClock.zone}
          onClose={() => googleModel.close()}
          onRetry={() => googleModel.retry()}
          onConnect={() => googleModel.connect()}
          onStopWaiting={() => googleModel.stopWaiting()}
          onDisconnect={() => googleModel.askDisconnect()}
          onYes={() => googleModel.confirmDisconnect()}
          onNotNow={() => googleModel.notNow()}
        />
      ) : null}
    </AnimatePresence>
  );
  const sheetNote = sheetState.open && sheetState.items.length === 0 ? (sheetState.loading ? COPY.sheetData.loading : sheetState.failed ? COPY.sheetData.failed : COPY.memory.readout.empty) : null;

  return (
    <MainScreen
      signedIn
      reduced={snap.input.reducedMotion}
      paused={snap.paused}
      auth={auth}
      soundToggle={<SoundToggle />}
      stage={stage}
      controls={
        <CallScreen
          key="call-signed-in"
          voice={v}
          enabled={voice !== null && (takesInput || inCall)}
          configMissing={voice === null ? TRANSCRIBE_VAR : null}
          onCall={call}
          onHangUp={() => voice?.hangUp()}
          onToggleMute={() => voice?.toggleMute()}
          onRetry={() => voice?.retry()}
        />
      }
      typed={
        <TypedLine
          key="typed-signed-in"
          text={t.text}
          enabled={takesInput}
          sending={t.sending}
          canSend={takesInput && typed.canSend() && (!inCall || v.phase === "LISTENING")}
          error={t.error}
          onChange={(text) => typed.setText(text)}
          onPaste={() => typed.markPasted()}
          onSubmit={submit}
        />
      }
      reply={inCall ? null : <ReplyLine entries={replyEntries(t.entries, shown)} />}
      cards={liveTest === null ? allCards : liveTest.wrapCards(allCards)}
      strip={mem.surfaces.strip === null ? null : <Strip {...mem.surfaces.strip} />}
      jar={<Jar motes={mem.surfaces.jar} onOpen={() => (sheetState.open ? sheetModel.close() : void sheetModel.open())} />}
      lab={<Lab counters={mem.surfaces.lab?.counters ?? []} limits={mem.surfaces.lab?.limits ?? []} receipt={receipt} />}
      visit={
        <div className="flex flex-col items-center gap-2">
          {visitBar}
          {sheetNote === null ? null : (
            <p role="status" data-sheet-note="" className="text-xs text-ink-dim">
              {sheetNote}
            </p>
          )}
        </div>
      }
      timeBadge={badge === null ? null : <TimeBadge {...badge} />}
      sheet={
        <>
          {sheetLayer}
          {bankLayer}
          {googleLayer}
          {radioLayer}
        </>
      }
      bank={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <BankWayIn banks={bankState.banks} open={bankState.open} disabled={!takesInput} onOpen={() => bankModel.toggle()} />
          <GoogleWayIn google={googleState.google} open={googleState.open} disabled={!takesInput} onOpen={() => googleModel.toggle()} />
        </div>
      }
      debug={debug === null ? null : <DebugArea debug={debug} typed={typed} voice={v} />}
      live={
        liveTest === null ? (
          live
        ) : (
          <>
            {live}
            <CardWatch liveTest={liveTest} cards={allCards} />
          </>
        )
      }
    />
  );
}

/** Brief 050: tells the live test recorder which cards the dock holds. Draws nothing. */
function CardWatch({ liveTest, cards }: { liveTest: LiveTest; cards: readonly { id: string; kind: string }[] }) {
  const ids = cards.map((c) => `${c.kind}:${c.id}`).join("|");
  useEffect(() => {
    liveTest.seenCards(cards);
    // `ids` names the cards; a new array with the same cards is no change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTest, ids]);
  return null;
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
