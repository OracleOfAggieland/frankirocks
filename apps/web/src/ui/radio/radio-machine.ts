/**
 * @machine ui.radio
 *
 * The radio on the stage and its globe, as a pure machine (brief 047). It holds whether the radio is on, whether the
 * globe panel is open, which station is tuned, what the speaker is doing, the owner's volume and how far a call
 * ducks it. The player and the timers are outside it: `radioEffects` says what they must do after each step.
 *
 * Always: off means silent, no station and the panel closed; the station is null or one of the list's own; the
 * volume is 0 to 1; automatic hops never pass RADIO_MAX_HOPS. Every tune, and every switch off, raises `tune`, and a
 * player report naming any other tune is stale and changes nothing. Never: a clock read, a random source (the random
 * pick for `press`, `spin` and the rock phrase rides on the event as a number from 0 to 1), a write, or a throw.
 *
 * The list is the snapshot's order, west to east by longitude: "next" and the automatic hop go east.
 */
import type { RadioDuck } from "./gain";
import { RADIO_OFF_VIEW, type RadioPanelState, type RadioPower, type RadioSignal, type RadioView, type Station } from "./types";

export interface RadioState {
  readonly power: RadioPower;
  readonly panel: RadioPanelState;
  /** The tuned station's id; null exactly when off. */
  readonly stationId: string | null;
  readonly signal: RadioSignal;
  /** The owner's own volume, 0 to 1. */
  readonly volume: number;
  readonly duck: RadioDuck;
  /** Raised on every tune and every switch off. A player report naming another tune is stale. */
  readonly tune: number;
  /** Automatic hops since the owner last chose a station or one played. */
  readonly hops: number;
}

export const INITIAL_RADIO: RadioState = Object.freeze({
  power: "off",
  panel: "closed",
  stationId: null,
  signal: "silent",
  volume: RADIO_OFF_VIEW.volume,
  duck: "none",
  tune: 0,
  hops: 0,
});

/** Ruling 9: a dead stream hops at most this many times, then rests on "No signal". */
export const RADIO_MAX_HOPS = 3;
/** Ruling 9: a stream that has not started this long after its tune counts as failed. */
export const RADIO_START_LIMIT_MS = 10_000;

/** What the player reports, plus `timedOut` from the start limit's timer. */
export type RadioReport = "playing" | "waiting" | "failed" | "blocked" | "timedOut";

export type RadioEvent =
  /** The radio on the stage. Off: on, panel open, a rock station picked by `pick`. On: the panel opens or closes. */
  | { kind: "press"; pick: number }
  | { kind: "closePanel" }
  | { kind: "powerOff" }
  | { kind: "tune"; stationId: string }
  | { kind: "step"; direction: 1 | -1 }
  /** A different station, picked by `pick` (0 to 1). */
  | { kind: "spin"; pick: number }
  | { kind: "setVolume"; volume: number }
  /** The current station again, after "No signal" or "Tap to play". */
  | { kind: "retry" }
  /** "Franki, you rock": on, panel open, a rock station (the current one if it is rock and still live). */
  | { kind: "rockPhrase"; pick: number }
  /** "Radio off": off, only while on. */
  | { kind: "offPhrase" }
  /** The player's report for `tune`, or the start limit's timer. */
  | { kind: "player"; tune: number; report: RadioReport }
  /** The call's duck level. */
  | { kind: "duck"; level: RadioDuck };

/** A pick from 0 to 1 as an index below `n` (n > 0). Anything out of range lands on an end. */
export function pickIndex(pick: number, n: number): number {
  if (!Number.isFinite(pick) || pick <= 0) return 0;
  return Math.min(n - 1, Math.floor(pick * n));
}

const indexOf = (stations: readonly Station[], id: string | null) => (id === null ? -1 : stations.findIndex((x) => x.id === id));

/** The rock stations, or every station when none is rock. */
const rockPool = (stations: readonly Station[]) => {
  const rock = stations.filter((x) => x.rock);
  return rock.length > 0 ? rock : stations;
};

function tuneTo(s: RadioState, id: string, hops = 0): RadioState {
  return { ...s, power: "on", stationId: id, signal: "tuning", tune: s.tune + 1, hops };
}

function switchOff(s: RadioState): RadioState {
  if (s.power === "off") return s;
  return { ...INITIAL_RADIO, volume: s.volume, duck: s.duck, tune: s.tune + 1 };
}

function turnOnRock(s: RadioState, pick: number, stations: readonly Station[]): RadioState {
  const pool = rockPool(stations);
  if (pool.length === 0) return s;
  return { ...tuneTo(s, pool[pickIndex(pick, pool.length)]!.id), panel: "open" };
}

/** Ruling 9: the next station east of the same kind (rock stays rock while another exists), or null. */
export function hopTarget(stationId: string | null, stations: readonly Station[]): string | null {
  const i = indexOf(stations, stationId);
  if (i < 0) return null;
  const rock = stations[i]!.rock;
  const n = stations.length;
  // Going east from the current station, wrapping round: first one of the same kind, then any.
  const east = Array.from({ length: n - 1 }, (_, k) => stations[(i + 1 + k) % n]!);
  return (east.find((x) => x.rock === rock || !rock) ?? east[0])?.id ?? null;
}

function hop(s: RadioState, stations: readonly Station[]): RadioState {
  if (s.hops >= RADIO_MAX_HOPS) return s.signal === "noSignal" ? s : { ...s, signal: "noSignal" };
  const next = hopTarget(s.stationId, stations);
  if (next === null) return s.signal === "noSignal" ? s : { ...s, signal: "noSignal" };
  return tuneTo(s, next, s.hops + 1);
}

function onPlayer(s: RadioState, report: RadioReport, stations: readonly Station[]): RadioState {
  switch (report) {
    case "playing":
      return s.signal === "playing" && s.hops === 0 ? s : { ...s, signal: "playing", hops: 0 };
    case "waiting":
      // A stall while playing shows as tuning again; the start limit runs from there.
      return s.signal === "playing" ? { ...s, signal: "tuning" } : s;
    case "blocked":
      return s.signal === "tapToPlay" ? s : { ...s, signal: "tapToPlay" };
    case "failed":
      return s.signal === "noSignal" ? s : hop(s, stations);
    case "timedOut":
      return s.signal === "tuning" ? hop(s, stations) : s;
    default:
      report satisfies never;
      return s;
  }
}

/** Total: every event is defined in every state. Returns `s` itself when nothing changes. */
export function radioStep(s: RadioState, e: RadioEvent, stations: readonly Station[]): RadioState {
  // A station that left the list (a new snapshot) leaves nothing tuned to it.
  if (s.power === "on" && indexOf(stations, s.stationId) < 0) s = switchOff(s);
  const on = s.power === "on";
  switch (e.kind) {
    case "press":
      if (!on) return turnOnRock(s, e.pick, stations);
      return { ...s, panel: s.panel === "open" ? "closed" : "open" };
    case "rockPhrase": {
      if (!on) return turnOnRock(s, e.pick, stations);
      const current = stations.find((x) => x.id === s.stationId);
      const live = s.signal === "playing" || s.signal === "tuning";
      if (current?.rock === true && live) return s.panel === "open" ? s : { ...s, panel: "open" };
      return turnOnRock(s, e.pick, stations);
    }
    case "closePanel":
      return s.panel === "closed" ? s : { ...s, panel: "closed" };
    case "powerOff":
    case "offPhrase":
      return switchOff(s);
    case "tune": {
      if (!on || indexOf(stations, e.stationId) < 0) return s;
      // The same light while it plays or tunes changes nothing; after a failure it tries again.
      if (e.stationId === s.stationId && (s.signal === "playing" || s.signal === "tuning")) return s;
      return tuneTo(s, e.stationId);
    }
    case "step": {
      if (!on || stations.length < 2) return s;
      const i = indexOf(stations, s.stationId);
      const n = stations.length;
      return tuneTo(s, stations[(i + e.direction + n) % n]!.id);
    }
    case "spin": {
      if (!on || stations.length < 2) return s;
      const i = indexOf(stations, s.stationId);
      const j = pickIndex(e.pick, stations.length - 1);
      return tuneTo(s, stations[j >= i ? j + 1 : j]!.id);
    }
    case "setVolume": {
      if (!Number.isFinite(e.volume)) return s;
      const volume = Math.min(1, Math.max(0, e.volume));
      return volume === s.volume ? s : { ...s, volume };
    }
    case "retry":
      return on && s.stationId !== null ? tuneTo(s, s.stationId) : s;
    case "player":
      if (!on || e.tune !== s.tune) return s;
      return onPlayer(s, e.report, stations);
    case "duck":
      return e.level === s.duck ? s : { ...s, duck: e.level };
    default:
      e satisfies never;
      return s;
  }
}

/** What the screen draws. Off with the default volume is RADIO_OFF_VIEW itself. */
export function radioView(s: RadioState, stations: readonly Station[]): RadioView {
  if (s.power === "off") return s.volume === RADIO_OFF_VIEW.volume ? RADIO_OFF_VIEW : { ...RADIO_OFF_VIEW, volume: s.volume };
  return { power: s.power, panel: s.panel, station: stations.find((x) => x.id === s.stationId) ?? null, signal: s.signal, volume: s.volume };
}

/** What the player and the start timer must do after a step from `before` to `after`. */
export type RadioEffect =
  /** Start this stream for this tune. Run inside the press that caused it, so the browser lets sound start. */
  | { kind: "load"; url: string; tune: number }
  | { kind: "stop" }
  /** The element's volume, from radioGain. Sent when the volume or the duck level changes while on. */
  | { kind: "gain"; volume: number; duck: RadioDuck }
  /** Arm the start limit for this tune: after RADIO_START_LIMIT_MS, send `timedOut` naming it. */
  | { kind: "armStart"; tune: number }
  | { kind: "clearStart" };

export function radioEffects(before: RadioState, after: RadioState, stations: readonly Station[]): RadioEffect[] {
  if (before === after) return [];
  const out: RadioEffect[] = [];
  if (after.power === "off") {
    if (before.power === "on") out.push({ kind: "clearStart" }, { kind: "stop" });
    return out;
  }
  const retuned = after.tune !== before.tune;
  if (retuned || before.power === "off" || after.volume !== before.volume || after.duck !== before.duck) {
    out.push({ kind: "gain", volume: after.volume, duck: after.duck });
  }
  if (retuned) {
    const url = stations.find((x) => x.id === after.stationId)?.url;
    if (url !== undefined) out.push({ kind: "load", url, tune: after.tune });
  }
  const tuning = after.signal === "tuning";
  if (tuning && (retuned || before.signal !== "tuning")) out.push({ kind: "armStart", tune: after.tune });
  else if (!tuning && before.signal === "tuning") out.push({ kind: "clearStart" });
  return out;
}
