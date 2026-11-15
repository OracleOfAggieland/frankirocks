/**
 * Brief 050 part B: the development-only live test recorder, started once per page load. App.tsx imports this
 * folder only by `import()` behind `process.env.NEXT_PUBLIC_FRANKI_LIVE_TEST === "1"`, so a production bundle never
 * holds it. Everything here only reads; nothing changes what the app does.
 */
import type { VoiceState } from "@franki/core";
import type { ApiObserve } from "../api";
import { createBrowserClock } from "../clock";
import { randomId } from "../ids";
import type { VoiceObserver } from "../voice-client";
import { Recorder, exitPost, fetchPost } from "./recorder";
import { createLinkWatch, sampleFrames, sampleLongTasks, watchPage } from "./samplers";
import { currentStepId } from "./step-key";
import { type CardLike, changes, createApiTap, createCardTap, createLatencyTap, createVoiceTap, phoneFields, radioFields, type RadioLike } from "./taps";

interface Store<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

export interface LiveTest {
  /** For `createApiClient({ observe })`. */
  api: ApiObserve;
  /** For `VoiceClient.observe`. */
  voice: VoiceObserver;
  /** Follows the voice state for latency rows; returns the unsubscribe. */
  watchVoice(store: Store<VoiceState>): () => void;
  watchPhone(store: Store<{ phase: string; reason: string | null }>): () => void;
  watchRadio(store: Store<RadioLike>): () => void;
  /** The signed-in user's ID, or null; written when it changes. */
  user(uid: string | null): void;
  /** A typed line as sent (`inCall` when it went into a live call). */
  typed(text: string, inCall: boolean): void;
  /** Wraps the dock's cards so an approval's Yes and Not now are recorded. */
  wrapCards<C extends CardLike>(cards: C[]): C[];
  /** The cards on screen now (shown and closed by ID). */
  seenCards(cards: readonly CardLike[]): void;
}

let started: LiveTest | null = null;

/** Starts the recorder for this page load, or returns the one already started. Never throws. */
export function startLiveTest(): LiveTest {
  if (started !== null) return started;
  const clock = createBrowserClock();
  const rec = new Recorder({
    clock: { mono: () => clock.mono(), epoch: () => clock.read().opsClock.now - clock.offsetMs() },
    pageId: randomId().slice(0, 12),
    post: fetchPost((input, init) => fetch(input, init)),
    postOnExit: exitPost((input, init) => fetch(input, init), typeof navigator.sendBeacon === "function" ? (u, d) => navigator.sendBeacon(u, d) : null),
    step: currentStepId,
  });
  const now = () => clock.mono();
  rec.start();
  rec.emit("page.load", { path: window.location.pathname, ua: navigator.userAgent });
  window.addEventListener("pagehide", () => rec.flushOnExit());

  const links = createLinkWatch(rec, { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) });
  const voice = createVoiceTap({ sink: rec, now, onLink: (peer, channel) => links.link(peer, channel) });
  try {
    sampleFrames(rec, {
      requestAnimationFrame: (fn) => window.requestAnimationFrame(fn),
      cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
      visible: () => document.visibilityState === "visible",
    });
    sampleLongTasks(rec);
    watchPage(rec, window, document);
  } catch {
    // a sampler that cannot start is skipped
  }

  const cards = createCardTap(rec);
  const latency = createLatencyTap(rec);
  let uid: string | null | undefined;
  const follow = <T>(store: Store<T>, onView: (v: T) => void) => {
    const read = () => {
      try {
        onView(store.getSnapshot());
      } catch {
        // never into the app
      }
    };
    read();
    return store.subscribe(read);
  };

  started = {
    api: createApiTap(rec, now),
    voice,
    // One latency tap for the page, so a second subscription (StrictMode, a new voice client) never repeats a row.
    watchVoice: (store) => follow(store, (v) => latency.onVoice(v)),
    watchPhone: (store) => follow(store, changes(rec, "phone", phoneFields)),
    watchRadio: (store) => follow(store, changes(rec, "radio", radioFields)),
    user(next) {
      if (next === uid) return;
      uid = next;
      rec.emit("user", next === null ? { signedIn: false } : { uid: next, signedIn: true });
    },
    typed(text, inCall) {
      rec.words("words.typed", text, { inCall });
    },
    wrapCards: (list) => {
      try {
        return cards.wrap(list);
      } catch {
        return list;
      }
    },
    seenCards: (list) => {
      try {
        cards.seen(list);
      } catch {
        // never into the app
      }
    },
  };
  return started;
}
