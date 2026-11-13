/**
 * The radio's browser adapter (brief 047): one audio element behind a small port. It plays the stream it is given,
 * reports what the element does under the tune it was loaded with, and ramps the volume so ducking has no click.
 * It decides nothing: the machine in `ui/radio/radio-machine.ts` does.
 *
 * One element, made lazily on the first load: never at module scope and never during server render. `preload` is
 * "none" and `crossOrigin` is left unset, so a stream without CORS headers still plays. Nothing is stored.
 */
import type { RadioReport } from "../ui/radio/radio-machine";

/** What the element reports. The start limit's `timedOut` comes from the watch's timer, not from here. */
export type RadioPlayerReport = Exclude<RadioReport, "timedOut">;

export interface RadioTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RadioPlayerPort {
  /** Start `url`. Reports name `tune`, so the machine can drop those of an older tune. Call inside the press. */
  load(url: string, tune: number): void;
  /** Pause, drop the source and close the connection. Nothing more is reported until the next load. */
  stop(): void;
  /** The element's volume, 0 to 1, ramped over RADIO_RAMP_MS. */
  setGain(gain: number): void;
  /** Every report, as (tune, report). Returns the unsubscribe. */
  onReport(listener: (tune: number, report: RadioPlayerReport) => void): () => void;
  /** Stop and let go of the element's listeners. */
  dispose(): void;
}

/** The part of an HTMLAudioElement the player uses. */
export interface RadioAudioElement {
  src: string;
  preload: string;
  volume: number;
  play(): Promise<void> | undefined;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface RadioPlayerDeps {
  makeAudio: () => RadioAudioElement;
  timers: RadioTimers;
}

/** How long a volume change takes, and how many steps it takes in. */
export const RADIO_RAMP_MS = 200;
export const RADIO_RAMP_STEPS = 8;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** The element events and what each reports. */
const EVENTS: readonly (readonly [string, RadioPlayerReport])[] = [
  ["playing", "playing"],
  ["waiting", "waiting"],
  ["stalled", "waiting"],
  ["error", "failed"],
];

export function createRadioPlayer(deps: RadioPlayerDeps): RadioPlayerPort {
  let audio: RadioAudioElement | null = null;
  /** The tune now loaded; null while stopped, when nothing is reported. */
  let tune: number | null = null;
  let target = 1;
  let ramp: unknown = null;
  const listeners = new Set<(tune: number, report: RadioPlayerReport) => void>();
  const handlers: [string, () => void][] = [];

  const report = (t: number, r: RadioPlayerReport) => {
    for (const l of listeners) l(t, r);
  };

  const clearRamp = () => {
    if (ramp !== null) deps.timers.clearTimeout(ramp);
    ramp = null;
  };

  const element = (): RadioAudioElement => {
    if (audio !== null) return audio;
    const a = deps.makeAudio();
    a.preload = "none";
    a.volume = target;
    for (const [type, r] of EVENTS) {
      const h = () => {
        if (tune !== null) report(tune, r);
      };
      a.addEventListener(type, h);
      handlers.push([type, h]);
    }
    audio = a;
    return a;
  };

  const rampTo = (a: RadioAudioElement, to: number) => {
    clearRamp();
    const from = clamp01(a.volume);
    if (from === to) return;
    let i = 0;
    const tick = () => {
      i++;
      a.volume = i >= RADIO_RAMP_STEPS ? to : from + ((to - from) * i) / RADIO_RAMP_STEPS;
      ramp = i >= RADIO_RAMP_STEPS ? null : deps.timers.setTimeout(tick, RADIO_RAMP_MS / RADIO_RAMP_STEPS);
    };
    ramp = deps.timers.setTimeout(tick, RADIO_RAMP_MS / RADIO_RAMP_STEPS);
  };

  const stop = () => {
    clearRamp();
    tune = null;
    if (audio === null) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  };

  return {
    load(url, t) {
      const a = element();
      clearRamp();
      a.volume = target;
      tune = t;
      a.src = url;
      let started: Promise<void> | undefined;
      try {
        started = a.play();
      } catch (e) {
        report(t, (e as { name?: unknown } | null)?.name === "NotAllowedError" ? "blocked" : "failed");
        return;
      }
      started?.catch((e: unknown) => {
        const name = (e as { name?: unknown } | null)?.name;
        // A later load or stop interrupts this play(): that is not a failure of the stream.
        if (name === "AbortError" || tune !== t) return;
        report(t, name === "NotAllowedError" ? "blocked" : "failed");
      });
    },
    stop,
    setGain(gain) {
      target = clamp01(gain);
      if (audio === null) return;
      if (tune === null) {
        clearRamp();
        audio.volume = target;
        return;
      }
      rampTo(audio, target);
    },
    onReport(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      stop();
      if (audio !== null) for (const [type, h] of handlers) audio.removeEventListener(type, h);
      handlers.length = 0;
      audio = null;
      listeners.clear();
    },
  };
}

/** The live player: a real `Audio` element, made on the first load. The caller passes the live timers. */
export function browserRadioPlayer(timers: RadioTimers): RadioPlayerPort {
  return createRadioPlayer({ makeAudio: () => new Audio(), timers });
}
