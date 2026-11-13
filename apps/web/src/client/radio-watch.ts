/**
 * The radio's store (brief 047), in the shape of `phone-watch.ts`: the screen subscribes, reads a `RadioView` and
 * calls `controls`. Every change is `radioStep`; what the player and the start timer must do is `radioEffects`.
 *
 * Only the owner's own words reach the phrase: the transcript of each completed spoken item in the voice state, and
 * each typed line the screen passes to `onTypedLine` when it is sent. Each utterance fires at most once. Mail, tool
 * results, card text, pasted text and Franki's own speech are never read. Nothing is stored: a reload starts off.
 */
import type { VoiceItem, VoiceState } from "@franki/core";
import { radioDuck, radioGain } from "../ui/radio/gain";
import { radioPhrase } from "../ui/radio/phrase";
import {
  INITIAL_RADIO,
  RADIO_START_LIMIT_MS,
  type RadioEvent,
  type RadioState,
  radioEffects,
  radioStep,
  radioView,
} from "../ui/radio/radio-machine";
import type { RadioControls, RadioView, Station } from "../ui/radio/types";
import type { RadioPlayerPort, RadioTimers } from "./radio-player";

/** The most spoken item IDs remembered as fired. Older ones are long gone from the voice state. */
export const RADIO_FIRED_LIMIT = 64;

export interface RadioWatchDeps {
  player: RadioPlayerPort;
  timers: RadioTimers;
  /** A number from 0 to 1 for each random pick. Part D passes the live source. */
  random: () => number;
  stations: readonly Station[];
  /** The rock phrase matched: the celebration. */
  onRock?: () => void;
}

/** Every completed spoken item of the owner the voice state holds: the current Turn, a held-back one, and missing ones. */
export function ownerSpokenItems(v: VoiceState): VoiceItem[] {
  const out: VoiceItem[] = [];
  const add = (items: readonly VoiceItem[] | undefined) => {
    for (const i of items ?? []) if (i.transcript !== null && i.transcript.trim() !== "") out.push(i);
  };
  // Only ASR Turns carry the owner's spoken items; a typed or pasted Turn reaches the radio through onTypedLine or not at all.
  if (v.turn?.source === "asr") add(v.turn.items);
  if (v.heldBack?.source === "asr") add(v.heldBack.items);
  for (const m of v.missing) add(m.items);
  return out;
}

export class RadioWatch {
  private state: RadioState = INITIAL_RADIO;
  private view: RadioView;
  private readonly listeners = new Set<() => void>();
  private readonly fired: string[] = [];
  private startTimer: unknown = null;
  private readonly unsubscribe: () => void;
  private disposed = false;
  /** Events raised while a step's effects run (a player that reports at once) wait their turn here. */
  private readonly queue: RadioEvent[] = [];
  private running = false;

  constructor(private readonly deps: RadioWatchDeps) {
    this.view = radioView(this.state, deps.stations);
    this.unsubscribe = deps.player.onReport((tune, report) => this.send({ kind: "player", tune, report }));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RadioView => this.view;

  readonly controls: RadioControls = {
    press: () => this.send({ kind: "press", pick: this.pick() }),
    closePanel: () => this.send({ kind: "closePanel" }),
    powerOff: () => this.send({ kind: "powerOff" }),
    tune: (stationId) => this.send({ kind: "tune", stationId }),
    step: (direction) => this.send({ kind: "step", direction }),
    spin: () => this.send({ kind: "spin", pick: this.pick() }),
    setVolume: (volume) => this.send({ kind: "setVolume", volume }),
    retry: () => this.send({ kind: "retry" }),
  };

  /** Every voice snapshot: the duck level, and the phrase in each newly completed spoken item. */
  onVoice(v: VoiceState): void {
    this.send({ kind: "duck", level: radioDuck(v) });
    for (const item of ownerSpokenItems(v)) {
      if (this.fired.includes(item.itemId)) continue;
      this.fired.push(item.itemId);
      if (this.fired.length > RADIO_FIRED_LIMIT) this.fired.splice(0, this.fired.length - RADIO_FIRED_LIMIT);
      this.hear(item.transcript ?? "");
    }
  }

  /** A typed line, when it is sent. Each call is one utterance. */
  onTypedLine(text: string): void {
    this.hear(text);
  }

  /** The page is going away: sound stops and nothing more is reported. */
  dispose(): void {
    if (this.disposed) return;
    this.send({ kind: "powerOff" });
    this.disposed = true;
    this.clearStart();
    this.unsubscribe();
    this.deps.player.dispose();
    this.listeners.clear();
  }

  private pick(): number {
    const r = this.deps.random();
    return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
  }

  private hear(text: string): void {
    if (this.disposed) return;
    const phrase = radioPhrase(text);
    if (phrase === "rock") {
      this.send({ kind: "rockPhrase", pick: this.pick() });
      this.deps.onRock?.();
    } else if (phrase === "off") this.send({ kind: "offPhrase" });
  }

  private send(e: RadioEvent): void {
    if (this.disposed) return;
    this.queue.push(e);
    if (this.running) return;
    this.running = true;
    try {
      for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) this.apply(next);
    } finally {
      this.running = false;
    }
  }

  private apply(e: RadioEvent): void {
    if (this.disposed) return;
    const before = this.state;
    const after = radioStep(before, e, this.deps.stations);
    if (after === before) return;
    this.state = after;
    for (const fx of radioEffects(before, after, this.deps.stations)) {
      switch (fx.kind) {
        case "load":
          this.deps.player.load(fx.url, fx.tune);
          break;
        case "stop":
          this.deps.player.stop();
          break;
        case "gain":
          this.deps.player.setGain(radioGain(fx.volume, fx.duck));
          break;
        case "armStart":
          this.clearStart();
          this.startTimer = this.deps.timers.setTimeout(() => {
            this.startTimer = null;
            this.send({ kind: "player", tune: fx.tune, report: "timedOut" });
          }, RADIO_START_LIMIT_MS);
          break;
        case "clearStart":
          this.clearStart();
          break;
        default:
          fx satisfies never;
      }
    }
    this.publish();
  }

  private clearStart(): void {
    if (this.startTimer !== null) this.deps.timers.clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private publish(): void {
    const next = radioView(this.state, this.deps.stations);
    const v = this.view;
    if (next.power === v.power && next.panel === v.panel && next.station === v.station && next.signal === v.signal && next.volume === v.volume) return;
    this.view = next;
    for (const l of this.listeners) l();
  }
}
