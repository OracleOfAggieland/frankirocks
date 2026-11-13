/**
 * The lab's live radio (brief 047 part D): the watch with the browser's audio element, its timers, its random source
 * and the bundled stations, plus the two small seams the screen feeds it through. Nothing here runs at module scope
 * or during the server render: the screen calls `createLiveRadio` inside an effect.
 */
import { type VoiceState, initialVoiceState } from "@franki/core";
import { STATIONS } from "../ui/radio/stations";
import { browserRadioPlayer, type RadioTimers } from "./radio-player";
import { RadioWatch } from "./radio-watch";

/** The browser's own timers, behind the radio's timer port. */
function browserTimers(): RadioTimers {
  return {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}

/** One radio for the app's life. `onRock` is the celebration the rock phrase asks for. */
export function createLiveRadio(onRock: () => void): RadioWatch {
  const timers = browserTimers();
  return new RadioWatch({ player: browserRadioPlayer(timers), timers, random: Math.random, stations: STATIONS, onRock });
}

/** Holds the screen's one radio: made on `start`, disposed for good on `stop`; a later `start` makes a new one. */
export interface RadioHost {
  start(): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
  /** The radio while started; null before the first start and after a stop. */
  getSnapshot(): RadioWatch | null;
}

/**
 * The screen's radio holder. Cheap to make during render (it touches no browser API until `start`), so the screen
 * keeps it in state and starts it in an effect. Under StrictMode the effect runs twice, and since `dispose()` is
 * final, each start makes its own watch.
 */
export function createRadioHost(make: () => RadioWatch): RadioHost {
  let watch: RadioWatch | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  return {
    start() {
      if (watch !== null) return;
      watch = make();
      notify();
    },
    stop() {
      if (watch === null) return;
      watch.dispose();
      watch = null;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => watch,
  };
}

/**
 * The words of a sent line the radio may hear: the owner's own typed words, never a pasted line, and never an empty
 * one. Null when the radio hears nothing.
 */
export function radioHears(text: string, pasted: boolean): string | null {
  if (pasted) return null;
  return text.trim() === "" ? null : text;
}

/** A closed call: what the radio is fed when it stops reading a voice client, so its duck level goes back to "none". */
export const RADIO_CLOSED_VOICE: VoiceState = initialVoiceState({ transcribeModel: "" });

/** A voice client as the radio reads it. */
export interface RadioVoiceSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): VoiceState;
}

/**
 * Feeds every voice snapshot to the radio until the returned function is called. Ending the feed (sign-out, or the
 * voice client replaced) feeds one closed call, so the radio stops ducking.
 */
export function feedRadioVoice(radio: Pick<RadioWatch, "onVoice">, voice: RadioVoiceSource): () => void {
  const off = voice.subscribe(() => radio.onVoice(voice.getSnapshot()));
  return () => {
    off();
    radio.onVoice(RADIO_CLOSED_VOICE);
  };
}
